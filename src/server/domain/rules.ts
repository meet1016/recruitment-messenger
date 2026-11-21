import crypto from 'node:crypto';
import path from 'node:path';
import {
  ALLOWED_UPLOAD_EXTENSIONS,
  ALLOWED_UPLOAD_MIME_TYPES,
  AuthActor,
  AvailabilityStatus,
  ComplaintAccessTarget,
  ConversationThreadType,
  DailyException,
  InterviewInterval,
  InterviewStatus,
  MAX_UPLOAD_BYTES,
  ResolvedDayAvailability,
  TimeSlot,
  UserRole,
  WeeklyRule,
} from './types';

// ============================================================================
// 1. Authorization & Role-Based Access Control (RBAC)
// ============================================================================

export function canAccessCandidate(
  actor: AuthActor,
  candidateId: string,
  activeAssignedRecruiterId: string | null
): boolean {
  if (!actor.isActive) return false;
  if (actor.role === UserRole.TeamLead) return true;
  if (actor.role === UserRole.Candidate) {
    return actor.id === candidateId;
  }
  if (actor.role === UserRole.Recruiter) {
    return activeAssignedRecruiterId !== null && activeAssignedRecruiterId === actor.id;
  }
  return false;
}

export function canAccessConversation(
  actor: AuthActor,
  conversation: { candidateId: string; recruiterId: string; threadType?: ConversationThreadType | string },
  activeAssignedRecruiterId: string | null
): boolean {
  if (!actor.isActive) return false;
  const threadType = (conversation.threadType || ConversationThreadType.CandidateRecruiter) as ConversationThreadType;

  // Team Lead can view & actively chat in Candidate<->Recruiter threads AND direct Team Lead chats
  if (actor.role === UserRole.TeamLead) {
    if (threadType === ConversationThreadType.TeamLeadCandidate) {
      return conversation.recruiterId === actor.id || actor.role === UserRole.TeamLead;
    }
    if (threadType === ConversationThreadType.TeamLeadRecruiter) {
      return conversation.candidateId === actor.id || actor.role === UserRole.TeamLead;
    }
    return true;
  }

  if (threadType === ConversationThreadType.TeamLeadCandidate) {
    // Strictly private between Team Lead and that Candidate (Recruiters blocked)
    return actor.role === UserRole.Candidate && actor.id === conversation.candidateId;
  }

  if (threadType === ConversationThreadType.TeamLeadRecruiter) {
    // Strictly private between Team Lead and that Recruiter (Candidates blocked)
    return actor.role === UserRole.Recruiter && actor.id === conversation.recruiterId;
  }

  // Standard Candidate <-> Assigned Recruiter thread
  if (actor.role === UserRole.Candidate) {
    return actor.id === conversation.candidateId;
  }
  if (actor.role === UserRole.Recruiter) {
    // Reassigned candidates immediately lose active access for previous recruiters
    return (
      activeAssignedRecruiterId === actor.id &&
      conversation.recruiterId === actor.id
    );
  }
  return false;
}

export function canStartDirectTeamLeadChat(actorRole: UserRole, targetRole: UserRole): boolean {
  if (actorRole === UserRole.TeamLead) {
    return targetRole === UserRole.Candidate || targetRole === UserRole.Recruiter;
  }
  if (actorRole === UserRole.Candidate || actorRole === UserRole.Recruiter) {
    return targetRole === UserRole.TeamLead;
  }
  return false;
}

export function canSubmitComplaint(actor: AuthActor): boolean {
  return actor.isActive && actor.role === UserRole.Candidate;
}

export function canAccessComplaint(actor: AuthActor, complaint: ComplaintAccessTarget): boolean {
  if (!actor.isActive) return false;
  if (actor.role === UserRole.TeamLead) return true;
  if (actor.role === UserRole.Candidate) {
    return actor.id === complaint.candidateId;
  }
  if (actor.role === UserRole.Recruiter) {
    // Complaints go directly to Team Lead and show ONLY to the assigned recruiter (never other recruiters)
    return (
      complaint.visibleToRecruiter &&
      complaint.recruiterId !== null &&
      complaint.recruiterId === actor.id
    );
  }
  return false;
}

export function canManageComplaint(actor: AuthActor): boolean {
  return actor.isActive && actor.role === UserRole.TeamLead;
}

export function canAccessInternalNotes(
  actor: AuthActor,
  activeAssignedRecruiterId: string | null
): boolean {
  if (!actor.isActive) return false;
  if (actor.role === UserRole.Candidate) return false;
  if (actor.role === UserRole.TeamLead) return true;
  if (actor.role === UserRole.Recruiter) {
    return activeAssignedRecruiterId !== null && activeAssignedRecruiterId === actor.id;
  }
  return false;
}

export function canDownloadAttachment(
  actor: AuthActor,
  attachment: { candidateId: string; uploadedBy: string },
  activeAssignedRecruiterId: string | null
): boolean {
  if (!actor.isActive) return false;
  if (actor.role === UserRole.TeamLead) return true;
  if (actor.id === attachment.uploadedBy) return true;
  if (actor.role === UserRole.Candidate) {
    return actor.id === attachment.candidateId;
  }
  if (actor.role === UserRole.Recruiter) {
    return (
      actor.id === attachment.candidateId ||
      (activeAssignedRecruiterId !== null && activeAssignedRecruiterId === actor.id)
    );
  }
  return false;
}

export function sanitizeConversationPayloadForRole<
  T extends { internalNotes?: unknown[]; messages: unknown[] }
>(actor: AuthActor, payload: T): T {
  if (actor.role === UserRole.Candidate) {
    const clone = { ...payload };
    delete clone.internalNotes;
    return clone;
  }
  return payload;
}

// ============================================================================
// 2. Availability Resolution & IANA Timezone Conversion (DST-Aware)
// ============================================================================

export function parseTimeToMinutes(hhmm: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!match) return -1;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 23 || m < 0 || m > 59) return -1;
  return h * 60 + m;
}

export function validateTimeSlots(slots: TimeSlot[]): { valid: boolean; error?: string } {
  const normalized = slots.map((s) => ({
    start: parseTimeToMinutes(s.start),
    end: parseTimeToMinutes(s.end),
  }));

  for (const s of normalized) {
    if (s.start < 0 || s.end < 0) {
      return { valid: false, error: 'Time slots must use HH:MM 24-hour format.' };
    }
    if (s.end <= s.start) {
      return { valid: false, error: 'End time must be after start time.' };
    }
  }

  const sorted = [...normalized].sort((a, b) => a.start - b.start);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].end) {
      return { valid: false, error: 'Time slots on the same day cannot overlap.' };
    }
  }

  return { valid: true };
}

export function getDayOfWeekForDateString(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function computeAvailabilityStatus(slots: TimeSlot[], isUnavailableFlag: boolean): AvailabilityStatus {
  if (isUnavailableFlag || slots.length === 0) {
    return AvailabilityStatus.Unavailable;
  }
  const totalMinutes = slots.reduce((sum, s) => {
    const start = parseTimeToMinutes(s.start);
    const end = parseTimeToMinutes(s.end);
    return sum + Math.max(0, end - start);
  }, 0);

  // >= 4 hours = Available, < 4 hours = Partially Available
  return totalMinutes >= 240
    ? AvailabilityStatus.Available
    : AvailabilityStatus.PartiallyAvailable;
}

export function resolveAvailabilityForDate(
  dateStr: string,
  candidateTimezone: string,
  weeklyRules: WeeklyRule[],
  dailyExceptions: DailyException[]
): ResolvedDayAvailability {
  // Business Rule: Daily custom availability overrides weekly recurring schedule for that date
  const exception = dailyExceptions.find((e) => e.date === dateStr);
  if (exception) {
    const slots = exception.isUnavailable ? [] : exception.slots;
    return {
      date: dateStr,
      timezone: candidateTimezone,
      source: 'custom_exception',
      status: computeAvailabilityStatus(slots, exception.isUnavailable),
      slots,
      note: exception.note,
    };
  }

  const dow = getDayOfWeekForDateString(dateStr);
  const rule = weeklyRules.find((r) => r.dayOfWeek === dow);
  if (!rule || !rule.isAvailable || rule.slots.length === 0) {
    return {
      date: dateStr,
      timezone: candidateTimezone,
      source: 'weekly_recurring',
      status: AvailabilityStatus.Unavailable,
      slots: [],
    };
  }

  return {
    date: dateStr,
    timezone: candidateTimezone,
    source: 'weekly_recurring',
    status: computeAvailabilityStatus(rule.slots, false),
    slots: rule.slots,
  };
}

/**
 * Converts a local date + HH:MM in an IANA timezone into a UTC Date (DST-safe).
 */
export function zonedTimeToUtc(dateStr: string, hhmm: string, timeZone: string): Date {
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hour, minute] = hhmm.split(':').map(Number);

  // Initial UTC guess
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0, 0);

  const getOffsetMs = (ts: number): number => {
    const d = new Date(ts);
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(d);

    const map: Record<string, number> = {};
    for (const p of parts) {
      if (p.type !== 'literal') map[p.type] = Number(p.value);
    }
    const asUtc = Date.UTC(
      map.year,
      map.month - 1,
      map.day,
      map.hour === 24 ? 0 : map.hour,
      map.minute,
      map.second
    );
    return asUtc - ts;
  };

  const offset1 = getOffsetMs(utcGuess);
  const adjusted = utcGuess - offset1;
  // Second pass handles DST transition boundaries cleanly
  const offset2 = getOffsetMs(adjusted);
  return new Date(utcGuess - offset2);
}

export function formatUtcInTimezone(
  utcDate: Date | string,
  targetTimezone: string
): { date: string; time24: string; time12: string; tzAbbr: string } {
  const d = typeof utcDate === 'string' ? new Date(utcDate) : utcDate;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: targetTimezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);

  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }

  const time12 = new Intl.DateTimeFormat('en-US', {
    timeZone: targetTimezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d);

  const tzParts = new Intl.DateTimeFormat('en-US', {
    timeZone: targetTimezone,
    timeZoneName: 'short',
  }).formatToParts(d);
  const tzAbbr = tzParts.find((p) => p.type === 'timeZoneName')?.value ?? targetTimezone;

  const hour24 = map.hour === '24' ? '00' : map.hour;
  return {
    date: `${map.year}-${map.month}-${map.day}`,
    time24: `${hour24}:${map.minute}`,
    time12,
    tzAbbr,
  };
}

export function convertSlotBetweenTimezones(
  dateStr: string,
  slot: TimeSlot,
  fromTimezone: string,
  toTimezone: string
): {
  startLabel: string;
  endLabel: string;
  startDate: string;
  endDate: string;
  tzAbbr: string;
  startUtc: string;
  endUtc: string;
} {
  const startUtcDate = zonedTimeToUtc(dateStr, slot.start, fromTimezone);
  const endUtcDate = zonedTimeToUtc(dateStr, slot.end, fromTimezone);
  const startTarget = formatUtcInTimezone(startUtcDate, toTimezone);
  const endTarget = formatUtcInTimezone(endUtcDate, toTimezone);

  return {
    startLabel: startTarget.time12,
    endLabel: endTarget.time12,
    startDate: startTarget.date,
    endDate: endTarget.date,
    tzAbbr: startTarget.tzAbbr,
    startUtc: startUtcDate.toISOString(),
    endUtc: endUtcDate.toISOString(),
  };
}

// ============================================================================
// 3. Interview Conflict Detection
// ============================================================================

const BLOCKING_INTERVIEW_STATUSES = new Set<InterviewStatus>([
  InterviewStatus.Confirmed,
  InterviewStatus.Requested,
  InterviewStatus.RescheduleRequested,
]);

export function hasInterviewConflict(
  existingInterviews: InterviewInterval[],
  candidateId: string,
  recruiterId: string,
  proposedStartUtc: string,
  proposedEndUtc: string,
  excludeInterviewId?: string
): { hasConflict: boolean; conflictingInterview?: InterviewInterval; reason?: string } {
  const newStart = Date.parse(proposedStartUtc);
  const newEnd = Date.parse(proposedEndUtc);

  if (Number.isNaN(newStart) || Number.isNaN(newEnd) || newEnd <= newStart) {
    return { hasConflict: true, reason: 'Invalid interview start or end time.' };
  }

  for (const iv of existingInterviews) {
    if (excludeInterviewId && iv.id === excludeInterviewId) continue;
    if (!BLOCKING_INTERVIEW_STATUSES.has(iv.status)) continue;

    const sameCandidate = iv.candidateId === candidateId;
    const sameRecruiter = iv.recruiterId === recruiterId;
    if (!sameCandidate && !sameRecruiter) continue;

    const existingStart = Date.parse(iv.startUtc);
    const existingEnd = Date.parse(iv.endUtc);

    // Overlap iff newStart < existingEnd && newEnd > existingStart
    if (newStart < existingEnd && newEnd > existingStart) {
      const who = sameCandidate ? 'Candidate' : 'Recruiter';
      return {
        hasConflict: true,
        conflictingInterview: iv,
        reason: `${who} already has a ${iv.status} interview overlapping this time window.`,
      };
    }
  }

  return { hasConflict: false };
}

// ============================================================================
// 4. Security Helpers (Password Hashing, Signed URLs, File Validation, Rate Limiter)
// ============================================================================

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 2) return false;
  const [salt, expectedHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export function hashSessionToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function signDownloadToken(
  payload: { attachmentId: string; userId: string; exp: number },
  secret: string
): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyDownloadToken(
  token: string,
  secret: string,
  nowMs = Date.now()
): { valid: boolean; payload?: { attachmentId: string; userId: string; exp: number }; error?: string } {
  const parts = token.split('.');
  if (parts.length !== 2) return { valid: false, error: 'Malformed download token' };
  const [encoded, sig] = parts;

  const expectedSig = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { valid: false, error: 'Invalid download signature' };
  }

  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as {
      attachmentId: string;
      userId: string;
      exp: number;
    };
    if (!parsed.attachmentId || !parsed.userId || typeof parsed.exp !== 'number') {
      return { valid: false, error: 'Incomplete token payload' };
    }
    if (parsed.exp < nowMs) {
      return { valid: false, error: 'Signed download link expired' };
    }
    return { valid: true, payload: parsed };
  } catch {
    return { valid: false, error: 'Unreadable token payload' };
  }
}

export function validateUploadedFile(file: {
  originalName: string;
  mimeType: string;
  sizeBytes: number;
}): { valid: boolean; safeName?: string; error?: string } {
  if (!file.originalName || file.originalName.trim().length === 0) {
    return { valid: false, error: 'Filename is required.' };
  }
  if (file.sizeBytes <= 0) {
    return { valid: false, error: 'File cannot be empty.' };
  }
  if (file.sizeBytes > MAX_UPLOAD_BYTES) {
    return { valid: false, error: 'File exceeds the 10 MB maximum upload limit.' };
  }

  const baseName = path.basename(file.originalName);
  const ext = path.extname(baseName).toLowerCase();
  if (!ALLOWED_UPLOAD_EXTENSIONS.has(ext)) {
    return { valid: false, error: `Unsupported file extension (${ext || 'none'}).` };
  }

  const cleanMime = file.mimeType.split(';')[0].trim().toLowerCase();
  if (!ALLOWED_UPLOAD_MIME_TYPES.has(cleanMime)) {
    return { valid: false, error: `Unsupported file type (${cleanMime}).` };
  }

  const safeName = baseName.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
  return { valid: true, safeName };
}

export function isValidHttpUrl(urlStr: string): boolean {
  if (!urlStr.trim()) return true;
  try {
    const parsed = new URL(urlStr);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

export function createRateLimiter(maxAttempts: number, windowMs: number) {
  const store = new Map<string, { count: number; resetAt: number }>();

  return {
    check(key: string, now = Date.now()): { allowed: boolean; remaining: number; retryAfterSec: number } {
      const entry = store.get(key);
      if (!entry || now >= entry.resetAt) {
        return { allowed: true, remaining: maxAttempts, retryAfterSec: 0 };
      }
      if (entry.count >= maxAttempts) {
        return {
          allowed: false,
          remaining: 0,
          retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
        };
      }
      return { allowed: true, remaining: maxAttempts - entry.count, retryAfterSec: 0 };
    },
    recordFailure(key: string, now = Date.now()): void {
      const entry = store.get(key);
      if (!entry || now >= entry.resetAt) {
        store.set(key, { count: 1, resetAt: now + windowMs });
      } else {
        entry.count += 1;
      }
    },
    reset(key: string): void {
      store.delete(key);
    },
  };
}
