import crypto from 'node:crypto';
import express, { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import {
  createNotification,
  getActiveAssignedRecruiterId,
  getDb,
  writeAuditLog,
} from '../db/database';
import {
  canAccessCandidate,
  canAccessComplaint,
  canAccessConversation,
  canAccessInternalNotes,
  canDownloadAttachment,
  canManageComplaint,
  canStartDirectTeamLeadChat,
  canSubmitComplaint,
  convertSlotBetweenTimezones,
  createRateLimiter,
  hasInterviewConflict,
  hashPassword,
  hashSessionToken,
  isValidHttpUrl,
  resolveAvailabilityForDate,
  validateTimeSlots,
  validateUploadedFile,
  verifyPassword,
  zonedTimeToUtc,
} from '../domain/rules';
import {
  AuthActor,
  CallStatus,
  CallType,
  ComplaintCategory,
  ComplaintPriority,
  ComplaintStatus,
  ConversationThreadType,
  DailyException,
  InterviewInterval,
  InterviewStatus,
  InterviewType,
  MAX_UPLOAD_BYTES,
  TimeSlot,
  UserRole,
  WeeklyRule,
} from '../domain/types';
import {
  createSignedDownloadUrl,
  getStorageStatus,
  readPrivateObject,
  storePrivateObject,
  verifySignedDownloadRequest,
} from '../storage/storageAdapter';
import { getCallingConfig } from '../calling/livekitAdapter';
import { realtimeHub } from '../ws/realtime';

interface AuthedRequest extends Request {
  actor?: AuthActor & { timezone: string; avatarUrl: string; phone: string };
  sessionTokenHash?: string;
}

const loginLimiter = createRateLimiter(6, 15 * 60 * 1000);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function getClientIp(req: Request): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string') return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || '';
}

function todayDateInTimezone(tz: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const map: Record<string, string> = {};
  for (const p of parts) {
    if (p.type !== 'literal') map[p.type] = p.value;
  }
  return `${map.year}-${map.month}-${map.day}`;
}

function createSessionForUser(userId: string, userAgent = ''): { token: string; expiresAt: string } {
  const db = getDb();
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashSessionToken(token);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  db.prepare(
    `INSERT INTO user_sessions (id, user_id, token_hash, expires_at, user_agent)
     VALUES (?, ?, ?, ?, ?)`
  ).run(newId('sess'), userId, tokenHash, expiresAt, userAgent.slice(0, 200));

  db.prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`).run(userId);
  return { token, expiresAt };
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }
  const token = authHeader.slice(7).trim();
  if (!token) {
    res.status(401).json({ error: 'Invalid session token' });
    return;
  }

  const db = getDb();
  const tokenHash = hashSessionToken(token);
  const row = db
    .prepare(
      `SELECT u.id, u.email, u.role, u.full_name, u.phone, u.avatar_url, u.timezone, u.is_active
       FROM user_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?
         AND s.revoked_at IS NULL
         AND s.expires_at > datetime('now')
       LIMIT 1`
    )
    .get(tokenHash) as
    | {
        id: string;
        email: string;
        role: UserRole;
        full_name: string;
        phone: string;
        avatar_url: string;
        timezone: string;
        is_active: number;
      }
    | undefined;

  if (!row || row.is_active !== 1) {
    res.status(401).json({ error: 'Session expired or account deactivated' });
    return;
  }

  req.actor = {
    id: row.id,
    email: row.email,
    role: row.role,
    fullName: row.full_name,
    phone: row.phone,
    avatarUrl: row.avatar_url,
    timezone: row.timezone,
    isActive: true,
  };
  req.sessionTokenHash = tokenHash;
  next();
}

function requireRole(...roles: UserRole[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.actor || !roles.includes(req.actor.role)) {
      res.status(403).json({ error: 'Forbidden: insufficient permissions for this action' });
      return;
    }
    next();
  };
}

function loadCandidateAvailability(candidateId: string, dateStr: string, viewerTimezone: string) {
  const db = getDb();
  const cand = db
    .prepare('SELECT timezone FROM users WHERE id = ?')
    .get(candidateId) as { timezone: string } | undefined;
  const candidateTz = cand?.timezone || 'America/New_York';

  const ruleRows = db
    .prepare('SELECT day_of_week, is_available, slots_json FROM availability_rules WHERE candidate_id = ?')
    .all(candidateId) as Array<{ day_of_week: number; is_available: number; slots_json: string }>;

  const excRows = db
    .prepare(
      'SELECT exception_date, is_unavailable, slots_json, note FROM availability_exceptions WHERE candidate_id = ?'
    )
    .all(candidateId) as Array<{
    exception_date: string;
    is_unavailable: number;
    slots_json: string;
    note: string;
  }>;

  const weeklyRules: WeeklyRule[] = ruleRows.map((r) => ({
    dayOfWeek: r.day_of_week,
    isAvailable: r.is_available === 1,
    slots: JSON.parse(r.slots_json) as TimeSlot[],
  }));

  const dailyExceptions: DailyException[] = excRows.map((e) => ({
    date: e.exception_date,
    isUnavailable: e.is_unavailable === 1,
    slots: JSON.parse(e.slots_json) as TimeSlot[],
    note: e.note,
  }));

  const resolved = resolveAvailabilityForDate(dateStr, candidateTz, weeklyRules, dailyExceptions);
  const convertedSlots = resolved.slots.map((slot) => ({
    original: slot,
    converted: convertSlotBetweenTimezones(dateStr, slot, candidateTz, viewerTimezone),
  }));

  return {
    candidateTimezone: candidateTz,
    viewerTimezone,
    resolved,
    convertedSlots,
    weeklyRules,
    dailyExceptions,
  };
}

export function createApiRouter() {
  const router = express.Router();

  // ==========================================================================
  // PUBLIC AUTH & SANDBOX PERSONA METADATA
  // ==========================================================================

  router.get('/auth/sandbox-personas', (_req, res) => {
    const allowSandbox = process.env.ENABLE_SANDBOX_LOGIN !== 'false';
    if (!allowSandbox) {
      res.json({ enabled: false, personas: [] });
      return;
    }

    const db = getDb();
    const rows = db
      .prepare(
        `SELECT u.id, u.email, u.role, u.full_name, u.avatar_url, u.timezone,
                cp.technology, rp.title
         FROM users u
         LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
         LEFT JOIN recruiter_profiles rp ON rp.user_id = u.id
         WHERE u.is_active = 1
         ORDER BY CASE u.role WHEN 'team_lead' THEN 1 WHEN 'recruiter' THEN 2 ELSE 3 END, u.created_at ASC
         LIMIT 6`
      )
      .all();

    res.json({ enabled: true, personas: rows });
  });

  router.post('/auth/login', (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    const ip = getClientIp(req);
    const limiterKey = `${ip}:${email}`;

    if (!email || !password) {
      res.status(400).json({ error: 'Email and password are required.' });
      return;
    }

    const rate = loginLimiter.check(limiterKey);
    if (!rate.allowed) {
      res.status(429).json({
        error: `Too many failed login attempts. Try again in ${rate.retryAfterSec} seconds.`,
      });
      return;
    }

    const db = getDb();
    const user = db
      .prepare(
        `SELECT id, email, password_hash, role, full_name, phone, avatar_url, timezone, is_active
         FROM users WHERE lower(email) = ? LIMIT 1`
      )
      .get(email) as
      | {
          id: string;
          email: string;
          password_hash: string;
          role: UserRole;
          full_name: string;
          phone: string;
          avatar_url: string;
          timezone: string;
          is_active: number;
        }
      | undefined;

    const envAdminOverride =
      user?.role === UserRole.TeamLead &&
      process.env.ADMIN_PASSCODE &&
      process.env.ADMIN_PASSCODE.trim().length > 0 &&
      password === process.env.ADMIN_PASSCODE.trim();

    if (!user || user.is_active !== 1 || (!envAdminOverride && !verifyPassword(password, user.password_hash))) {
      loginLimiter.recordFailure(limiterKey);
      writeAuditLog(db, user?.id ?? null, 'auth.login_failed', 'user', user?.id ?? email, { email }, ip);
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    loginLimiter.reset(limiterKey);
    const session = createSessionForUser(user.id, req.headers['user-agent'] || '');
    writeAuditLog(db, user.id, 'auth.login', 'user', user.id, { role: user.role }, ip);

    res.json({
      token: session.token,
      expiresAt: session.expiresAt,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        fullName: user.full_name,
        phone: user.phone,
        avatarUrl: user.avatar_url,
        timezone: user.timezone,
      },
    });
  });

  router.post('/auth/sandbox-signin', (req, res) => {
    if (process.env.ENABLE_SANDBOX_LOGIN === 'false') {
      res.status(403).json({ error: 'Sandbox quick sign-in is disabled in production.' });
      return;
    }

    const userId = String(req.body?.userId || '').trim();
    if (!userId) {
      res.status(400).json({ error: 'User ID is required.' });
      return;
    }

    const db = getDb();
    const user = db
      .prepare(
        `SELECT id, email, role, full_name, phone, avatar_url, timezone, is_active
         FROM users WHERE id = ? AND is_active = 1 LIMIT 1`
      )
      .get(userId) as
      | {
          id: string;
          email: string;
          role: UserRole;
          full_name: string;
          phone: string;
          avatar_url: string;
          timezone: string;
          is_active: number;
        }
      | undefined;

    if (!user) {
      res.status(404).json({ error: 'Active account not found.' });
      return;
    }

    const session = createSessionForUser(user.id, req.headers['user-agent'] || '');
    writeAuditLog(db, user.id, 'auth.login', 'user', user.id, { mode: 'sandbox_role_access', role: user.role }, getClientIp(req));

    res.json({
      token: session.token,
      expiresAt: session.expiresAt,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        fullName: user.full_name,
        phone: user.phone,
        avatarUrl: user.avatar_url,
        timezone: user.timezone,
      },
    });
  });

  // ==========================================================================
  // SIGNED PRIVATE FILE DOWNLOAD (Token-Verified — No Open Access!)
  // ==========================================================================

  router.get('/files/download/:attachmentId', (req, res) => {
    const { attachmentId } = req.params;
    const token = String(req.query.token || '');
    if (!token) {
      res.status(401).json({ error: 'Signed download token is required.' });
      return;
    }

    const verified = verifySignedDownloadRequest(token);
    if (!verified.valid || !verified.payload) {
      res.status(403).json({ error: verified.error || 'Invalid or expired download link.' });
      return;
    }
    if (verified.payload.attachmentId !== attachmentId) {
      res.status(403).json({ error: 'Download token does not match requested file.' });
      return;
    }

    const db = getDb();
    const userRow = db
      .prepare('SELECT id, email, role, full_name, is_active FROM users WHERE id = ?')
      .get(verified.payload.userId) as
      | { id: string; email: string; role: UserRole; full_name: string; is_active: number }
      | undefined;

    if (!userRow || userRow.is_active !== 1) {
      res.status(403).json({ error: 'Account inactive or unauthorized.' });
      return;
    }

    const att = db
      .prepare('SELECT * FROM attachments WHERE id = ?')
      .get(attachmentId) as
      | {
          id: string;
          candidate_id: string;
          uploaded_by: string;
          storage_key: string;
          original_name: string;
          mime_type: string;
        }
      | undefined;

    if (!att) {
      res.status(404).json({ error: 'File not found.' });
      return;
    }

    const activeRecruiter = getActiveAssignedRecruiterId(db, att.candidate_id);
    const actor: AuthActor = {
      id: userRow.id,
      email: userRow.email,
      role: userRow.role,
      fullName: userRow.full_name,
      isActive: true,
    };

    if (!canDownloadAttachment(actor, { candidateId: att.candidate_id, uploadedBy: att.uploaded_by }, activeRecruiter)) {
      res.status(403).json({ error: 'Forbidden: you are no longer authorized to access this document.' });
      return;
    }

    const bytes = readPrivateObject(att.storage_key);
    if (!bytes) {
      res.status(404).json({ error: 'Stored object unavailable.' });
      return;
    }

    writeAuditLog(db, actor.id, 'file.downloaded', 'attachment', att.id, { filename: att.original_name }, getClientIp(req));

    const isInline = att.mime_type.startsWith('image/') || att.mime_type.startsWith('audio/');
    res.setHeader('Content-Type', att.mime_type);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader(
      'Content-Disposition',
      `${isInline ? 'inline' : 'attachment'}; filename="${att.original_name.replace(/"/g, '')}"`
    );
    res.send(bytes);
  });

  // ==========================================================================
  // ALL ROUTES BELOW REQUIRE AUTHENTICATION
  // ==========================================================================
  router.use(requireAuth);

  router.get('/auth/me', (req: AuthedRequest, res) => {
    const db = getDb();
    const actor = req.actor!;
    let profile: unknown = null;
    let assignedRecruiter: unknown = null;

    if (actor.role === UserRole.Candidate) {
      profile = db.prepare('SELECT * FROM candidate_profiles WHERE user_id = ?').get(actor.id);
      const recId = getActiveAssignedRecruiterId(db, actor.id);
      if (recId) {
        assignedRecruiter = db
          .prepare(
            `SELECT u.id, u.full_name, u.email, u.phone, u.avatar_url, u.timezone, rp.title, rp.department
             FROM users u
             LEFT JOIN recruiter_profiles rp ON rp.user_id = u.id
             WHERE u.id = ?`
          )
          .get(recId);
      }
    } else if (actor.role === UserRole.Recruiter) {
      profile = db.prepare('SELECT * FROM recruiter_profiles WHERE user_id = ?').get(actor.id);
    }

    res.json({
      user: actor,
      profile,
      assignedRecruiter,
      onlineUserIds: realtimeHub.getOnlineUserIds(),
      storage: getStorageStatus(),
      calling: getCallingConfig(),
    });
  });

  router.post('/auth/logout', (req: AuthedRequest, res) => {
    const db = getDb();
    if (req.sessionTokenHash) {
      db.prepare(`UPDATE user_sessions SET revoked_at = datetime('now') WHERE token_hash = ?`).run(
        req.sessionTokenHash
      );
    }
    writeAuditLog(db, req.actor!.id, 'auth.logout', 'user', req.actor!.id, {}, getClientIp(req));
    res.json({ ok: true });
  });

  router.post('/auth/change-password', (req: AuthedRequest, res) => {
    const currentPassword = String(req.body?.currentPassword || '');
    const newPassword = String(req.body?.newPassword || '');
    if (newPassword.length < 8) {
      res.status(400).json({ error: 'New password must be at least 8 characters.' });
      return;
    }

    const db = getDb();
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.actor!.id) as {
      password_hash: string;
    };

    if (currentPassword && !verifyPassword(currentPassword, row.password_hash)) {
      res.status(400).json({ error: 'Current password is incorrect.' });
      return;
    }

    db.prepare(`UPDATE users SET password_hash = ?, must_reset_password = 0, updated_at = datetime('now') WHERE id = ?`).run(
      hashPassword(newPassword),
      req.actor!.id
    );
    writeAuditLog(db, req.actor!.id, 'auth.password_changed', 'user', req.actor!.id, {}, getClientIp(req));
    res.json({ ok: true });
  });

  // ==========================================================================
  // DASHBOARD & REPORTS
  // ==========================================================================

  router.get('/dashboard', (req: AuthedRequest, res) => {
    const db = getDb();
    const actor = req.actor!;
    const today = todayDateInTimezone(actor.timezone);

    if (actor.role === UserRole.Candidate) {
      const assignedRecId = getActiveAssignedRecruiterId(db, actor.id);
      const assignedRecruiter = assignedRecId
        ? db
            .prepare(
              `SELECT u.id, u.full_name, u.email, u.phone, u.avatar_url, u.timezone, rp.title, rp.department
               FROM users u LEFT JOIN recruiter_profiles rp ON rp.user_id = u.id WHERE u.id = ?`
            )
            .get(assignedRecId)
        : null;

      const unreadRow = db
        .prepare(
          `SELECT COUNT(*) as count FROM messages m
           JOIN conversations c ON c.id = m.conversation_id
           WHERE c.candidate_id = ? AND c.is_active = 1 AND m.sender_id != ? AND m.read_at IS NULL AND m.deleted_at IS NULL`
        )
        .get(actor.id, actor.id) as { count: number };

      const interviews = db
        .prepare(
          `SELECT i.*, u.full_name as recruiter_name
           FROM interviews i JOIN users u ON u.id = i.recruiter_id
           WHERE i.candidate_id = ? AND i.status IN ('requested', 'confirmed', 'reschedule_requested')
           ORDER BY i.start_utc ASC LIMIT 6`
        )
        .all(actor.id);

      const pendingRequests = interviews.filter((i: any) => i.status === 'requested').length;
      const availability = loadCandidateAvailability(actor.id, today, actor.timezone);
      const notifications = db
        .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 6')
        .all(actor.id);

      const missedCalls = (
        db
          .prepare(`SELECT COUNT(*) as count FROM calls WHERE callee_id = ? AND status = 'missed'`)
          .get(actor.id) as { count: number }
      ).count;

      res.json({
        role: actor.role,
        today,
        assignedRecruiter,
        stats: {
          unreadMessages: unreadRow.count,
          upcomingInterviews: interviews.length,
          pendingRequests,
          missedCalls,
          todayStatus: availability.resolved.status,
        },
        todayAvailability: availability,
        upcomingInterviews: interviews,
        notifications,
      });
      return;
    }

    if (actor.role === UserRole.Recruiter) {
      const assignedCandidates = db
        .prepare(
          `SELECT u.id, u.full_name, u.avatar_url, u.timezone, cp.technology, cp.location, cp.visa_status
           FROM assignments a
           JOIN users u ON u.id = a.candidate_id
           JOIN candidate_profiles cp ON cp.user_id = u.id
           WHERE a.recruiter_id = ? AND a.is_active = 1 AND u.is_active = 1`
        )
        .all(actor.id) as Array<any>;

      let availableCount = 0;
      let unavailableCount = 0;
      const availableTodayList: Array<any> = [];

      for (const c of assignedCandidates) {
        const av = loadCandidateAvailability(c.id, today, actor.timezone);
        if (av.resolved.status === 'unavailable') {
          unavailableCount += 1;
        } else {
          availableCount += 1;
          availableTodayList.push({
            ...c,
            status: av.resolved.status,
            convertedSlots: av.convertedSlots,
          });
        }
      }

      const unreadMessages = (
        db
          .prepare(
            `SELECT COUNT(*) as count FROM messages m
             JOIN conversations c ON c.id = m.conversation_id
             WHERE c.recruiter_id = ? AND c.is_active = 1 AND m.sender_id != ? AND m.read_at IS NULL AND m.deleted_at IS NULL`
          )
          .get(actor.id, actor.id) as { count: number }
      ).count;

      const upcomingInterviews = db
        .prepare(
          `SELECT i.*, u.full_name as candidate_name, cp.technology
           FROM interviews i
           JOIN users u ON u.id = i.candidate_id
           LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
           WHERE i.recruiter_id = ? AND i.status IN ('requested', 'confirmed', 'reschedule_requested')
           ORDER BY i.start_utc ASC LIMIT 8`
        )
        .all(actor.id) as Array<any>;

      const missedCalls = (
        db
          .prepare(`SELECT COUNT(*) as count FROM calls WHERE callee_id = ? AND status = 'missed'`)
          .get(actor.id) as { count: number }
      ).count;

      const reminders = db
        .prepare(
          `SELECT r.*, u.full_name as candidate_name
           FROM reminders r LEFT JOIN users u ON u.id = r.candidate_id
           WHERE r.user_id = ? AND r.is_completed = 0
           ORDER BY r.due_at ASC LIMIT 6`
        )
        .all(actor.id);

      const recentActivity = db
        .prepare(
          `SELECT al.*, u.full_name as actor_name
           FROM audit_logs al LEFT JOIN users u ON u.id = al.actor_id
           WHERE al.actor_id = ? OR al.actor_id IN (SELECT candidate_id FROM assignments WHERE recruiter_id = ? AND is_active = 1)
           ORDER BY al.created_at DESC LIMIT 8`
        )
        .all(actor.id, actor.id);

      res.json({
        role: actor.role,
        today,
        stats: {
          totalAssignedCandidates: assignedCandidates.length,
          availableCandidates: availableCount,
          unavailableCandidates: unavailableCount,
          availableToday: availableTodayList.length,
          unreadMessages,
          upcomingInterviews: upcomingInterviews.length,
          pendingConfirmations: upcomingInterviews.filter((i) => i.status === 'requested').length,
          missedCalls,
        },
        availableTodayList,
        upcomingInterviews,
        reminders,
        recentActivity,
      });
      return;
    }

    // Team Lead Org-Wide Dashboard
    const allCandidates = db
      .prepare(`SELECT id, is_active FROM users WHERE role = 'candidate'`)
      .all() as Array<{ id: string; is_active: number }>;
    const activeCandidates = allCandidates.filter((c) => c.is_active === 1);

    let availableCount = 0;
    let partialCount = 0;
    let unavailableCount = 0;
    for (const c of activeCandidates) {
      const av = loadCandidateAvailability(c.id, today, actor.timezone);
      if (av.resolved.status === 'available') availableCount += 1;
      else if (av.resolved.status === 'partially_available') partialCount += 1;
      else unavailableCount += 1;
    }

    const totalRecruiters = (
      db.prepare(`SELECT COUNT(*) as count FROM users WHERE role = 'recruiter' AND is_active = 1`).get() as {
        count: number;
      }
    ).count;
    const totalConversations = (
      db.prepare(`SELECT COUNT(*) as count FROM conversations WHERE is_active = 1`).get() as { count: number }
    ).count;
    const unreadMessages = (
      db.prepare(`SELECT COUNT(*) as count FROM messages WHERE read_at IS NULL AND deleted_at IS NULL`).get() as {
        count: number;
      }
    ).count;
    const totalInterviews = (db.prepare(`SELECT COUNT(*) as count FROM interviews`).get() as { count: number }).count;
    const upcomingInterviewsCount = (
      db
        .prepare(`SELECT COUNT(*) as count FROM interviews WHERE status IN ('requested', 'confirmed', 'reschedule_requested')`)
        .get() as { count: number }
    ).count;
    const missedCalls = (
      db.prepare(`SELECT COUNT(*) as count FROM calls WHERE status = 'missed'`).get() as { count: number }
    ).count;

    const recruiterWorkload = db
      .prepare(
        `SELECT u.id, u.full_name, u.avatar_url, rp.department,
                (SELECT COUNT(*) FROM assignments a WHERE a.recruiter_id = u.id AND a.is_active = 1) as active_candidates,
                (SELECT COUNT(*) FROM interviews i WHERE i.recruiter_id = u.id AND i.status IN ('requested', 'confirmed')) as active_interviews,
                (SELECT COUNT(*) FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE c.recruiter_id = u.id AND m.sender_id = u.id) as messages_sent
         FROM users u
         LEFT JOIN recruiter_profiles rp ON rp.user_id = u.id
         WHERE u.role = 'recruiter'
         ORDER BY active_candidates DESC`
      )
      .all();

    const recentActivity = db
      .prepare(
        `SELECT al.*, u.full_name as actor_name, u.role as actor_role
         FROM audit_logs al LEFT JOIN users u ON u.id = al.actor_id
         ORDER BY al.created_at DESC LIMIT 12`
      )
      .all();

    res.json({
      role: actor.role,
      today,
      stats: {
        totalCandidates: allCandidates.length,
        activeCandidates: activeCandidates.length,
        totalRecruiters,
        availableCandidates: availableCount + partialCount,
        unavailableCandidates: unavailableCount,
        totalConversations,
        unreadMessages,
        interviewsScheduled: totalInterviews,
        upcomingInterviews: upcomingInterviewsCount,
        missedCalls,
      },
      availabilityBreakdown: [
        { name: 'Available', count: availableCount },
        { name: 'Partially Available', count: partialCount },
        { name: 'Unavailable', count: unavailableCount },
      ],
      recruiterWorkload,
      recentActivity,
    });
  });

  router.get('/reports', requireRole(UserRole.TeamLead), (req: AuthedRequest, res) => {
    const db = getDb();
    const interviewsByStatus = db
      .prepare(`SELECT status, COUNT(*) as count FROM interviews GROUP BY status`)
      .all();
    const candidatesByVisa = db
      .prepare(`SELECT visa_status as name, COUNT(*) as count FROM candidate_profiles GROUP BY visa_status`)
      .all();
    const callsSummary = db
      .prepare(
        `SELECT call_type, status, COUNT(*) as count, COALESCE(SUM(duration_sec), 0) as total_duration
         FROM calls GROUP BY call_type, status`
      )
      .all();
    const recruiterActivity = db
      .prepare(
        `SELECT u.id, u.full_name,
                (SELECT COUNT(*) FROM assignments a WHERE a.recruiter_id = u.id AND a.is_active = 1) as candidates,
                (SELECT COUNT(*) FROM interviews i WHERE i.recruiter_id = u.id) as interviews,
                (SELECT COUNT(*) FROM messages m WHERE m.sender_id = u.id) as messages,
                (SELECT COUNT(*) FROM calls c WHERE c.caller_id = u.id OR c.callee_id = u.id) as calls
         FROM users u WHERE u.role = 'recruiter'`
      )
      .all();

    res.json({ interviewsByStatus, candidatesByVisa, callsSummary, recruiterActivity });
  });

  // ==========================================================================
  // CANDIDATE MANAGEMENT (Strict Role + Assignment Enforcement)
  // ==========================================================================

  router.get('/candidates', requireRole(UserRole.Recruiter, UserRole.TeamLead), (req: AuthedRequest, res) => {
    const db = getDb();
    const actor = req.actor!;
    const search = String(req.query.q || '').trim().toLowerCase();
    const dateParam = String(req.query.date || todayDateInTimezone(actor.timezone));
    const availabilityFilter = String(req.query.availability || '');
    const recruiterFilter = String(req.query.recruiterId || '');

    let rows: Array<any>;
    if (actor.role === UserRole.Recruiter) {
      // Recruiters ONLY see candidates actively assigned to them
      rows = db
        .prepare(
          `SELECT u.id, u.email, u.full_name, u.phone, u.avatar_url, u.timezone, u.is_active, u.created_at,
                  cp.location, cp.technology, cp.experience_years, cp.visa_status, cp.hourly_rate, cp.availability_summary,
                  a.recruiter_id as assigned_recruiter_id, ru.full_name as assigned_recruiter_name
           FROM assignments a
           JOIN users u ON u.id = a.candidate_id
           JOIN candidate_profiles cp ON cp.user_id = u.id
           JOIN users ru ON ru.id = a.recruiter_id
           WHERE a.recruiter_id = ? AND a.is_active = 1
           ORDER BY u.full_name ASC`
        )
        .all(actor.id);
    } else {
      rows = db
        .prepare(
          `SELECT u.id, u.email, u.full_name, u.phone, u.avatar_url, u.timezone, u.is_active, u.created_at,
                  cp.location, cp.technology, cp.experience_years, cp.visa_status, cp.hourly_rate, cp.availability_summary,
                  a.recruiter_id as assigned_recruiter_id, ru.full_name as assigned_recruiter_name
           FROM users u
           JOIN candidate_profiles cp ON cp.user_id = u.id
           LEFT JOIN assignments a ON a.candidate_id = u.id AND a.is_active = 1
           LEFT JOIN users ru ON ru.id = a.recruiter_id
           WHERE u.role = 'candidate'
           ORDER BY u.full_name ASC`
        )
        .all();
    }

    const enriched = rows
      .map((c) => {
        const av = loadCandidateAvailability(c.id, dateParam, actor.timezone);
        return {
          ...c,
          online: realtimeHub.getOnlineUserIds().includes(c.id),
          availabilityStatus: av.resolved.status,
          convertedSlots: av.convertedSlots,
        };
      })
      .filter((c) => {
        if (recruiterFilter && actor.role === UserRole.TeamLead && c.assigned_recruiter_id !== recruiterFilter) {
          return false;
        }
        if (availabilityFilter && c.availabilityStatus !== availabilityFilter) {
          return false;
        }
        if (search) {
          const hay = `${c.full_name} ${c.email} ${c.technology} ${c.location} ${c.visa_status} ${c.experience_years}`.toLowerCase();
          return hay.includes(search);
        }
        return true;
      });

    res.json({ candidates: enriched });
  });

  router.get('/candidates/:id', (req: AuthedRequest, res) => {
    const db = getDb();
    const actor = req.actor!;
    const candidateId = req.params.id;
    const activeRecruiterId = getActiveAssignedRecruiterId(db, candidateId);

    if (!canAccessCandidate(actor, candidateId, activeRecruiterId)) {
      res.status(403).json({ error: 'Forbidden: you do not have access to this candidate profile.' });
      return;
    }

    const candidate = db
      .prepare(
        `SELECT u.id, u.email, u.full_name, u.phone, u.avatar_url, u.timezone, u.is_active, u.created_at,
                cp.location, cp.technology, cp.experience_years, cp.visa_status, cp.hourly_rate, cp.availability_summary, cp.linkedin_url,
                a.recruiter_id as assigned_recruiter_id, ru.full_name as assigned_recruiter_name, ru.email as assigned_recruiter_email, ru.phone as assigned_recruiter_phone
         FROM users u
         JOIN candidate_profiles cp ON cp.user_id = u.id
         LEFT JOIN assignments a ON a.candidate_id = u.id AND a.is_active = 1
         LEFT JOIN users ru ON ru.id = a.recruiter_id
         WHERE u.id = ? AND u.role = 'candidate'`
      )
      .get(candidateId);

    if (!candidate) {
      res.status(404).json({ error: 'Candidate not found.' });
      return;
    }

    const today = todayDateInTimezone(actor.timezone);
    const availability = loadCandidateAvailability(candidateId, today, actor.timezone);
    const documents = db
      .prepare(
        `SELECT a.*, u.full_name as uploader_name
         FROM attachments a JOIN users u ON u.id = a.uploaded_by
         WHERE a.candidate_id = ? AND a.category IN ('resume', 'document')
         ORDER BY a.created_at DESC`
      )
      .all(candidateId);

    const interviews = db
      .prepare(
        `SELECT i.*, u.full_name as recruiter_name
         FROM interviews i JOIN users u ON u.id = i.recruiter_id
         WHERE i.candidate_id = ? ORDER BY i.start_utc DESC`
      )
      .all(candidateId);

    // Internal notes strictly excluded for candidates!
    const internalNotes = canAccessInternalNotes(actor, activeRecruiterId)
      ? db
          .prepare(
            `SELECT n.*, u.full_name as author_name, u.role as author_role
             FROM internal_notes n JOIN users u ON u.id = n.author_id
             WHERE n.candidate_id = ? ORDER BY n.created_at DESC`
          )
          .all(candidateId)
      : undefined;

    res.json({
      candidate,
      availability,
      documents,
      interviews,
      ...(internalNotes !== undefined ? { internalNotes } : {}),
    });
  });

  router.post('/candidates', requireRole(UserRole.TeamLead), (req: AuthedRequest, res) => {
    const db = getDb();
    const {
      fullName,
      email,
      phone = '',
      timezone = 'America/New_York',
      location = '',
      technology = '',
      experienceYears = 0,
      visaStatus = 'H-1B',
      hourlyRate = '',
      recruiterId,
    } = req.body || {};

    if (!fullName?.trim() || !email?.trim() || !recruiterId?.trim()) {
      res.status(400).json({ error: 'Full name, email, and primary assigned recruiter are required.' });
      return;
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const existing = db.prepare('SELECT id FROM users WHERE lower(email) = ?').get(normalizedEmail);
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const recruiter = db
      .prepare(`SELECT id, full_name FROM users WHERE id = ? AND role = 'recruiter' AND is_active = 1`)
      .get(recruiterId) as { id: string; full_name: string } | undefined;
    if (!recruiter) {
      res.status(400).json({ error: 'Selected recruiter does not exist or is inactive.' });
      return;
    }

    const candidateId = newId('usr_cand');
    const tempPassword = `RM-${crypto.randomBytes(5).toString('base64url')}!9`;
    const passHash = hashPassword(tempPassword);
    const assignId = newId('asg');
    const convId = newId('conv');

    db.transaction(() => {
      db.prepare(
        `INSERT INTO users (id, email, password_hash, role, full_name, phone, timezone, is_active, must_reset_password)
         VALUES (?, ?, ?, 'candidate', ?, ?, ?, 1, 1)`
      ).run(candidateId, normalizedEmail, passHash, fullName.trim(), String(phone).trim(), timezone);

      db.prepare(
        `INSERT INTO candidate_profiles (user_id, location, technology, experience_years, visa_status, hourly_rate)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        candidateId,
        String(location).trim(),
        String(technology).trim(),
        Number(experienceYears) || 0,
        String(visaStatus).trim(),
        String(hourlyRate).trim()
      );

      db.prepare(
        `INSERT INTO notification_preferences (user_id) VALUES (?)`
      ).run(candidateId);

      // Default weekday availability Mon-Fri
      const defaultSlots = JSON.stringify([
        { start: '09:00', end: '12:00' },
        { start: '14:00', end: '17:00' },
      ]);
      for (let dow = 0; dow <= 6; dow++) {
        const isWeekday = dow >= 1 && dow <= 5 ? 1 : 0;
        db.prepare(
          `INSERT INTO availability_rules (id, candidate_id, day_of_week, is_available, slots_json)
           VALUES (?, ?, ?, ?, ?)`
        ).run(newId('rule'), candidateId, dow, isWeekday, isWeekday ? defaultSlots : '[]');
      }

      db.prepare(
        `INSERT INTO assignments (id, candidate_id, recruiter_id, is_active, assigned_by, reason)
         VALUES (?, ?, ?, 1, ?, 'Initial candidate onboarding assignment')`
      ).run(assignId, candidateId, recruiterId, req.actor!.id);

      db.prepare(
        `INSERT INTO conversations (id, candidate_id, recruiter_id, is_active, last_message_at)
         VALUES (?, ?, ?, 1, datetime('now'))`
      ).run(convId, candidateId, recruiterId);

      createNotification(
        db,
        recruiterId,
        'assignment',
        `New Candidate Assigned: ${fullName.trim()}`,
        `${req.actor!.fullName} assigned ${fullName.trim()} (${technology || 'IT Specialist'}) to your workspace.`,
        'candidates'
      );
      createNotification(
        db,
        candidateId,
        'account',
        'Welcome to Recruitment Messenger',
        `Your account is active and assigned to ${recruiter.full_name}. Update your availability to get started.`,
        'availability'
      );

      writeAuditLog(
        db,
        req.actor!.id,
        'candidate.created',
        'candidate',
        candidateId,
        { email: normalizedEmail, assignedRecruiter: recruiter.full_name },
        getClientIp(req)
      );
    })();

    realtimeHub.sendToUsers([recruiterId], { type: 'notification:new' });

    res.status(201).json({
      candidateId,
      conversationId: convId,
      initialCredentials: {
        email: normalizedEmail,
        temporaryPassword: tempPassword,
        note: 'Share these credentials securely with the candidate. They should change their password upon sign-in.',
      },
    });
  });

  router.patch('/candidates/:id', (req: AuthedRequest, res) => {
    const db = getDb();
    const actor = req.actor!;
    const candidateId = req.params.id;

    // Candidates can edit only their own permitted profile fields; Team Lead can edit any candidate.
    if (actor.role === UserRole.Recruiter) {
      res.status(403).json({ error: 'Recruiters cannot overwrite candidate profile records directly.' });
      return;
    }
    if (actor.role === UserRole.Candidate && actor.id !== candidateId) {
      res.status(403).json({ error: 'Forbidden: cannot modify another candidate profile.' });
      return;
    }

    const {
      fullName,
      phone,
      timezone,
      location,
      technology,
      experienceYears,
      visaStatus,
      hourlyRate,
      availabilitySummary,
      linkedinUrl,
      isActive,
    } = req.body || {};

    if (linkedinUrl && !isValidHttpUrl(String(linkedinUrl))) {
      res.status(400).json({ error: 'LinkedIn URL must start with http:// or https://.' });
      return;
    }

    db.transaction(() => {
      db.prepare(
        `UPDATE users SET
          full_name = COALESCE(?, full_name),
          phone = COALESCE(?, phone),
          timezone = COALESCE(?, timezone),
          is_active = CASE WHEN ? IS NOT NULL AND ? = 'team_lead' THEN ? ELSE is_active END,
          updated_at = datetime('now')
         WHERE id = ?`
      ).run(
        fullName?.trim() || null,
        phone !== undefined ? String(phone).trim() : null,
        timezone || null,
        isActive !== undefined ? 1 : null,
        actor.role,
        isActive ? 1 : 0,
        candidateId
      );

      db.prepare(
        `UPDATE candidate_profiles SET
          location = COALESCE(?, location),
          technology = COALESCE(?, technology),
          experience_years = COALESCE(?, experience_years),
          visa_status = COALESCE(?, visa_status),
          hourly_rate = COALESCE(?, hourly_rate),
          availability_summary = COALESCE(?, availability_summary),
          linkedin_url = COALESCE(?, linkedin_url),
          updated_at = datetime('now')
         WHERE user_id = ?`
      ).run(
        location !== undefined ? String(location).trim() : null,
        technology !== undefined ? String(technology).trim() : null,
        experienceYears !== undefined ? Number(experienceYears) : null,
        visaStatus !== undefined ? String(visaStatus).trim() : null,
        hourlyRate !== undefined ? String(hourlyRate).trim() : null,
        availabilitySummary !== undefined ? String(availabilitySummary).trim() : null,
        linkedinUrl !== undefined ? String(linkedinUrl).trim() : null,
        candidateId
      );

      writeAuditLog(db, actor.id, 'profile.updated', 'candidate', candidateId, { updatedByRole: actor.role }, getClientIp(req));
    })();

    res.json({ ok: true });
  });

  // ==========================================================================
  // RECRUITER MANAGEMENT (Team Lead Only)
  // ==========================================================================

  router.get('/recruiters', requireRole(UserRole.TeamLead), (_req, res) => {
    const db = getDb();
    const recruiters = db
      .prepare(
        `SELECT u.id, u.email, u.full_name, u.phone, u.avatar_url, u.timezone, u.is_active, u.last_login_at, u.created_at,
                rp.title, rp.department, rp.location, rp.bio,
                (SELECT COUNT(*) FROM assignments a WHERE a.recruiter_id = u.id AND a.is_active = 1) as assigned_count,
                (SELECT COUNT(*) FROM interviews i WHERE i.recruiter_id = u.id AND i.status IN ('requested', 'confirmed')) as active_interviews
         FROM users u
         LEFT JOIN recruiter_profiles rp ON rp.user_id = u.id
         WHERE u.role = 'recruiter'
         ORDER BY u.full_name ASC`
      )
      .all();

    res.json({ recruiters });
  });

  router.post('/recruiters', requireRole(UserRole.TeamLead), (req: AuthedRequest, res) => {
    const db = getDb();
    const {
      fullName,
      email,
      phone = '',
      timezone = 'America/New_York',
      title = 'Technical Recruiter',
      department = 'US IT Bench Sales',
      location = 'Dallas, TX',
    } = req.body || {};

    if (!fullName?.trim() || !email?.trim()) {
      res.status(400).json({ error: 'Full name and email are required.' });
      return;
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const existing = db.prepare('SELECT id FROM users WHERE lower(email) = ?').get(normalizedEmail);
    if (existing) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const recruiterId = newId('usr_rec');
    const tempPassword = `RM-${crypto.randomBytes(5).toString('base64url')}!8`;

    db.transaction(() => {
      db.prepare(
        `INSERT INTO users (id, email, password_hash, role, full_name, phone, timezone, is_active, must_reset_password)
         VALUES (?, ?, ?, 'recruiter', ?, ?, ?, 1, 1)`
      ).run(recruiterId, normalizedEmail, hashPassword(tempPassword), fullName.trim(), String(phone).trim(), timezone);

      db.prepare(
        `INSERT INTO recruiter_profiles (user_id, title, department, location) VALUES (?, ?, ?, ?)`
      ).run(recruiterId, String(title).trim(), String(department).trim(), String(location).trim());

      db.prepare(`INSERT INTO notification_preferences (user_id) VALUES (?)`).run(recruiterId);

      writeAuditLog(
        db,
        req.actor!.id,
        'recruiter.created',
        'recruiter',
        recruiterId,
        { email: normalizedEmail, department },
        getClientIp(req)
      );
    })();

    res.status(201).json({
      recruiterId,
      initialCredentials: { email: normalizedEmail, temporaryPassword: tempPassword },
    });
  });

  router.patch('/recruiters/:id', requireRole(UserRole.TeamLead), (req: AuthedRequest, res) => {
    const db = getDb();
    const { fullName, phone, timezone, title, department, location, isActive } = req.body || {};
    const recruiterId = req.params.id;

    db.transaction(() => {
      db.prepare(
        `UPDATE users SET
          full_name = COALESCE(?, full_name),
          phone = COALESCE(?, phone),
          timezone = COALESCE(?, timezone),
          is_active = COALESCE(?, is_active),
          updated_at = datetime('now')
         WHERE id = ? AND role = 'recruiter'`
      ).run(
        fullName?.trim() || null,
        phone !== undefined ? String(phone).trim() : null,
        timezone || null,
        isActive !== undefined ? (isActive ? 1 : 0) : null,
        recruiterId
      );

      db.prepare(
        `UPDATE recruiter_profiles SET
          title = COALESCE(?, title),
          department = COALESCE(?, department),
          location = COALESCE(?, location),
          updated_at = datetime('now')
         WHERE user_id = ?`
      ).run(title || null, department || null, location || null, recruiterId);

      if (isActive === false) {
        db.prepare(`UPDATE user_sessions SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL`).run(
          recruiterId
        );
      }

      writeAuditLog(
        db,
        req.actor!.id,
        isActive === false ? 'account.deactivated' : isActive === true ? 'account.activated' : 'recruiter.updated',
        'recruiter',
        recruiterId,
        { isActive },
        getClientIp(req)
      );
    })();

    res.json({ ok: true });
  });

  router.post('/recruiters/:id/reset-password', requireRole(UserRole.TeamLead), (req: AuthedRequest, res) => {
    const db = getDb();
    const recruiterId = req.params.id;
    const tempPassword = `RM-${crypto.randomBytes(5).toString('base64url')}!7`;

    db.prepare(
      `UPDATE users SET password_hash = ?, must_reset_password = 1, updated_at = datetime('now') WHERE id = ? AND role = 'recruiter'`
    ).run(hashPassword(tempPassword), recruiterId);
    db.prepare(`UPDATE user_sessions SET revoked_at = datetime('now') WHERE user_id = ? AND revoked_at IS NULL`).run(
      recruiterId
    );
    writeAuditLog(db, req.actor!.id, 'auth.admin_password_reset', 'recruiter', recruiterId, {}, getClientIp(req));

    res.json({ temporaryPassword: tempPassword });
  });

  // ==========================================================================
  // CANDIDATE ASSIGNMENTS & REASSIGNMENT HISTORY (Team Lead Only)
  // ==========================================================================

  router.get('/assignments', requireRole(UserRole.TeamLead), (_req, res) => {
    const db = getDb();
    const history = db
      .prepare(
        `SELECT a.*,
                cu.full_name as candidate_name, cp.technology,
                ru.full_name as recruiter_name,
                bu.full_name as assigned_by_name
         FROM assignments a
         JOIN users cu ON cu.id = a.candidate_id
         LEFT JOIN candidate_profiles cp ON cp.user_id = cu.id
         JOIN users ru ON ru.id = a.recruiter_id
         JOIN users bu ON bu.id = a.assigned_by
         ORDER BY a.is_active DESC, a.assigned_at DESC`
      )
      .all();

    res.json({ assignments: history });
  });

  router.post('/assignments/reassign', requireRole(UserRole.TeamLead), (req: AuthedRequest, res) => {
    const db = getDb();
    const { candidateId, newRecruiterId, reason = 'Workload rebalancing' } = req.body || {};
    if (!candidateId || !newRecruiterId) {
      res.status(400).json({ error: 'Candidate and new recruiter are required.' });
      return;
    }

    const candidate = db
      .prepare(`SELECT id, full_name FROM users WHERE id = ? AND role = 'candidate'`)
      .get(candidateId) as { id: string; full_name: string } | undefined;
    const newRecruiter = db
      .prepare(`SELECT id, full_name FROM users WHERE id = ? AND role = 'recruiter' AND is_active = 1`)
      .get(newRecruiterId) as { id: string; full_name: string } | undefined;

    if (!candidate || !newRecruiter) {
      res.status(404).json({ error: 'Candidate or active target recruiter not found.' });
      return;
    }

    const prevRecruiterId = getActiveAssignedRecruiterId(db, candidateId);
    if (prevRecruiterId === newRecruiterId) {
      res.status(400).json({ error: 'Candidate is already assigned to this recruiter.' });
      return;
    }

    const prevRecruiter = prevRecruiterId
      ? (db.prepare('SELECT full_name FROM users WHERE id = ?').get(prevRecruiterId) as { full_name: string } | undefined)
      : undefined;

    const newAssignId = newId('asg');

    db.transaction(() => {
      // 1. Deactivate old assignment while preserving immutable historical record
      db.prepare(
        `UPDATE assignments SET is_active = 0, unassigned_at = datetime('now')
         WHERE candidate_id = ? AND is_active = 1`
      ).run(candidateId);

      // 2. Create new active assignment
      db.prepare(
        `INSERT INTO assignments (id, candidate_id, recruiter_id, is_active, assigned_by, reason)
         VALUES (?, ?, ?, 1, ?, ?)`
      ).run(newAssignId, candidateId, newRecruiterId, req.actor!.id, String(reason).trim());

      // 3. Deactivate previous active candidate<->recruiter conversations for this candidate (keep Team Lead direct chats intact)
      db.prepare(
        `UPDATE conversations SET is_active = 0, updated_at = datetime('now')
         WHERE candidate_id = ? AND thread_type = 'candidate_recruiter'`
      ).run(candidateId);

      // 4. Reactivate or create conversation for (candidate, newRecruiter)
      const existingConv = db
        .prepare(
          `SELECT id FROM conversations
           WHERE candidate_id = ? AND recruiter_id = ? AND thread_type = 'candidate_recruiter'`
        )
        .get(candidateId, newRecruiterId) as { id: string } | undefined;

      if (existingConv) {
        db.prepare(`UPDATE conversations SET is_active = 1, updated_at = datetime('now') WHERE id = ?`).run(
          existingConv.id
        );
      } else {
        db.prepare(
          `INSERT INTO conversations (id, candidate_id, recruiter_id, thread_type, is_active, last_message_at)
           VALUES (?, ?, ?, 'candidate_recruiter', 1, datetime('now'))`
        ).run(newId('conv'), candidateId, newRecruiterId);
      }

      // 5. Notify participants
      createNotification(
        db,
        candidateId,
        'assignment',
        'Assigned Recruiter Updated',
        `${newRecruiter.full_name} is now your primary assigned recruiter.`,
        'messages'
      );
      createNotification(
        db,
        newRecruiterId,
        'assignment',
        `Candidate Reassigned to You: ${candidate.full_name}`,
        `${req.actor!.fullName} assigned ${candidate.full_name} to your active bench. Reason: ${reason}`,
        'candidates'
      );
      if (prevRecruiterId) {
        createNotification(
          db,
          prevRecruiterId,
          'assignment',
          `Candidate Reassigned: ${candidate.full_name}`,
          `${candidate.full_name} was reassigned to ${newRecruiter.full_name}. Active workspace access has been removed.`,
          'candidates'
        );
      }

      writeAuditLog(
        db,
        req.actor!.id,
        'candidate.reassigned',
        'assignment',
        newAssignId,
        {
          candidate: candidate.full_name,
          fromRecruiter: prevRecruiter?.full_name || 'Unassigned',
          toRecruiter: newRecruiter.full_name,
          reason,
        },
        getClientIp(req)
      );
    })();

    const notifyTargets = [candidateId, newRecruiterId, ...(prevRecruiterId ? [prevRecruiterId] : [])];
    realtimeHub.sendToUsers(notifyTargets, { type: 'assignment:changed', candidateId });

    res.json({ ok: true, assignmentId: newAssignId });
  });

  // ==========================================================================
  // CONVERSATIONS & REAL-TIME MESSAGING
  // ==========================================================================

  router.get('/conversations', (req: AuthedRequest, res) => {
    const db = getDb();
    const actor = req.actor!;
    const q = String(req.query.q || '').trim().toLowerCase();

    let rows: Array<any>;
    if (actor.role === UserRole.Candidate) {
      // Candidate sees their assigned recruiter thread AND direct Team Lead chat(s)
      rows = db
        .prepare(
          `SELECT c.*,
                  cu.full_name as candidate_name, cu.avatar_url as candidate_avatar, cu.timezone as candidate_timezone, cu.role as candidate_role,
                  cp.technology, cp.visa_status, cp.location as candidate_location, cp.experience_years, cp.hourly_rate,
                  ru.full_name as recruiter_name, ru.avatar_url as recruiter_avatar, ru.timezone as recruiter_timezone, ru.role as recruiter_role,
                  (SELECT m.body FROM messages m WHERE m.conversation_id = c.id AND m.deleted_at IS NULL ORDER BY m.created_at DESC LIMIT 1) as last_message,
                  (SELECT m.message_type FROM messages m WHERE m.conversation_id = c.id AND m.deleted_at IS NULL ORDER BY m.created_at DESC LIMIT 1) as last_message_type,
                  (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.sender_id != ? AND m.read_at IS NULL AND m.deleted_at IS NULL) as unread_count
           FROM conversations c
           JOIN users cu ON cu.id = c.candidate_id
           LEFT JOIN candidate_profiles cp ON cp.user_id = cu.id
           JOIN users ru ON ru.id = c.recruiter_id
           WHERE c.candidate_id = ?
             AND c.is_active = 1
             AND c.thread_type IN ('candidate_recruiter', 'team_lead_candidate')
           ORDER BY c.last_message_at DESC`
        )
        .all(actor.id, actor.id);
    } else if (actor.role === UserRole.Recruiter) {
      // Recruiter sees ONLY conversations for currently assigned candidates + direct Team Lead chat(s)
      rows = db
        .prepare(
          `SELECT c.*,
                  cu.full_name as candidate_name, cu.avatar_url as candidate_avatar, cu.timezone as candidate_timezone, cu.role as candidate_role,
                  cp.technology, cp.visa_status, cp.location as candidate_location, cp.experience_years, cp.hourly_rate,
                  ru.full_name as recruiter_name, ru.avatar_url as recruiter_avatar, ru.timezone as recruiter_timezone, ru.role as recruiter_role,
                  (SELECT m.body FROM messages m WHERE m.conversation_id = c.id AND m.deleted_at IS NULL ORDER BY m.created_at DESC LIMIT 1) as last_message,
                  (SELECT m.message_type FROM messages m WHERE m.conversation_id = c.id AND m.deleted_at IS NULL ORDER BY m.created_at DESC LIMIT 1) as last_message_type,
                  (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.sender_id != ? AND m.read_at IS NULL AND m.deleted_at IS NULL) as unread_count
           FROM conversations c
           JOIN users cu ON cu.id = c.candidate_id
           LEFT JOIN candidate_profiles cp ON cp.user_id = cu.id
           JOIN users ru ON ru.id = c.recruiter_id
           WHERE c.recruiter_id = ?
             AND c.is_active = 1
             AND (
               c.thread_type = 'team_lead_recruiter'
               OR (
                 c.thread_type = 'candidate_recruiter'
                 AND EXISTS (
                   SELECT 1 FROM assignments a
                   WHERE a.candidate_id = c.candidate_id
                     AND a.recruiter_id = c.recruiter_id
                     AND a.is_active = 1
                 )
               )
             )
           ORDER BY c.last_message_at DESC`
        )
        .all(actor.id, actor.id);
    } else {
      // Team Lead sees all Candidate<->Recruiter chats AND direct Team Lead chats
      rows = db
        .prepare(
          `SELECT c.*,
                  cu.full_name as candidate_name, cu.avatar_url as candidate_avatar, cu.timezone as candidate_timezone, cu.role as candidate_role,
                  cp.technology, cp.visa_status, cp.location as candidate_location, cp.experience_years, cp.hourly_rate,
                  ru.full_name as recruiter_name, ru.avatar_url as recruiter_avatar, ru.timezone as recruiter_timezone, ru.role as recruiter_role,
                  (SELECT m.body FROM messages m WHERE m.conversation_id = c.id AND m.deleted_at IS NULL ORDER BY m.created_at DESC LIMIT 1) as last_message,
                  (SELECT m.message_type FROM messages m WHERE m.conversation_id = c.id AND m.deleted_at IS NULL ORDER BY m.created_at DESC LIMIT 1) as last_message_type,
                  (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.sender_id != ? AND m.read_at IS NULL AND m.deleted_at IS NULL) as unread_count
           FROM conversations c
           JOIN users cu ON cu.id = c.candidate_id
           LEFT JOIN candidate_profiles cp ON cp.user_id = cu.id
           JOIN users ru ON ru.id = c.recruiter_id
           ORDER BY c.is_active DESC, c.last_message_at DESC`
        )
        .all(actor.id);
    }

    const online = new Set(realtimeHub.getOnlineUserIds());
    const filtered = rows
      .map((r) => ({
        ...r,
        candidateOnline: online.has(r.candidate_id),
        recruiterOnline: online.has(r.recruiter_id),
      }))
      .filter((r) => {
        if (!q) return true;
        return `${r.candidate_name} ${r.recruiter_name} ${r.technology || ''}`.toLowerCase().includes(q);
      });

    res.json({ conversations: filtered });
  });

  router.get('/conversations/direct-targets', (req: AuthedRequest, res) => {
    const db = getDb();
    const actor = req.actor!;

    if (actor.role === UserRole.TeamLead) {
      const targets = db
        .prepare(
          `SELECT u.id, u.full_name, u.email, u.role, u.avatar_url, u.timezone,
                  cp.technology, rp.title, rp.department
           FROM users u
           LEFT JOIN candidate_profiles cp ON cp.user_id = u.id
           LEFT JOIN recruiter_profiles rp ON rp.user_id = u.id
           WHERE u.is_active = 1 AND u.role IN ('candidate', 'recruiter')
           ORDER BY CASE u.role WHEN 'recruiter' THEN 1 ELSE 2 END, u.full_name ASC`
        )
        .all();
      res.json({ targets });
      return;
    }

    const teamLeads = db
      .prepare(
        `SELECT u.id, u.full_name, u.email, u.role, u.avatar_url, u.timezone
         FROM users u
         WHERE u.is_active = 1 AND u.role = 'team_lead'
         ORDER BY u.full_name ASC`
      )
      .all();
    res.json({ targets: teamLeads });
  });

  router.post('/conversations/direct', (req: AuthedRequest, res) => {
    const db = getDb();
    const actor = req.actor!;
    const targetUserId = String(req.body?.targetUserId || '').trim();

    if (!targetUserId) {
      res.status(400).json({ error: 'Target user ID is required.' });
      return;
    }

    const target = db
      .prepare('SELECT id, role, full_name, is_active FROM users WHERE id = ? AND is_active = 1')
      .get(targetUserId) as { id: string; role: UserRole; full_name: string; is_active: number } | undefined;

    if (!target) {
      res.status(404).json({ error: 'Target user not found or inactive.' });
      return;
    }

    if (!canStartDirectTeamLeadChat(actor.role, target.role)) {
      res.status(403).json({
        error: 'Forbidden: direct chats are only permitted between a Team Lead and a Candidate or Recruiter.',
      });
      return;
    }

    let threadType: ConversationThreadType;
    let candidateColId: string;
    let recruiterColId: string;

    if (actor.role === UserRole.TeamLead && target.role === UserRole.Candidate) {
      threadType = ConversationThreadType.TeamLeadCandidate;
      candidateColId = target.id;
      recruiterColId = actor.id;
    } else if (actor.role === UserRole.Candidate && target.role === UserRole.TeamLead) {
      threadType = ConversationThreadType.TeamLeadCandidate;
      candidateColId = actor.id;
      recruiterColId = target.id;
    } else if (actor.role === UserRole.TeamLead && target.role === UserRole.Recruiter) {
      threadType = ConversationThreadType.TeamLeadRecruiter;
      candidateColId = actor.id;
      recruiterColId = target.id;
    } else {
      threadType = ConversationThreadType.TeamLeadRecruiter;
      candidateColId = target.id;
      recruiterColId = actor.id;
    }

    const existing = db
      .prepare('SELECT id FROM conversations WHERE candidate_id = ? AND recruiter_id = ? LIMIT 1')
      .get(candidateColId, recruiterColId) as { id: string } | undefined;

    if (existing) {
      db.prepare(`UPDATE conversations SET is_active = 1, updated_at = datetime('now') WHERE id = ?`).run(existing.id);
      res.json({ conversationId: existing.id, threadType, created: false });
      return;
    }

    const convId = newId('conv');
    db.prepare(
      `INSERT INTO conversations (id, candidate_id, recruiter_id, thread_type, is_active, last_message_at)
       VALUES (?, ?, ?, ?, 1, datetime('now'))`
    ).run(convId, candidateColId, recruiterColId, threadType);

    writeAuditLog(
      db,
      actor.id,
      'conversation.direct_started',
      'conversation',
      convId,
      { threadType, withUser: target.full_name, withRole: target.role },
      getClientIp(req)
    );

    res.status(201).json({ conversationId: convId, threadType, created: true });
  });

  router.get('/conversations/:id/messages', (req: AuthedRequest, res) => {
    const db = getDb();
    const actor = req.actor!;
    const convId = req.params.id;
    const search = String(req.query.q || '').trim().toLowerCase();

    const conv = db
      .prepare('SELECT * FROM conversations WHERE id = ?')
      .get(convId) as
      | { id: string; candidate_id: string; recruiter_id: string; thread_type: string; is_active: number }
      | undefined;

    if (!conv) {
      res.status(404).json({ error: 'Conversation not found.' });
      return;
    }

    const activeRecruiter = getActiveAssignedRecruiterId(db, conv.candidate_id);
    if (
      !canAccessConversation(
        actor,
        { candidateId: conv.candidate_id, recruiterId: conv.recruiter_id, threadType: conv.thread_type },
        activeRecruiter
      )
    ) {
      res.status(403).json({ error: 'Forbidden: unauthorized conversation access.' });
      return;
    }

    // Mark incoming messages as read when a direct participant opens the thread
    if (actor.id === conv.candidate_id || actor.id === conv.recruiter_id) {
      const updated = db
        .prepare(
          `UPDATE messages SET read_at = datetime('now')
           WHERE conversation_id = ? AND sender_id != ? AND read_at IS NULL`
        )
        .run(convId, actor.id);

      if (updated.changes > 0) {
        const otherId = actor.id === conv.candidate_id ? conv.recruiter_id : conv.candidate_id;
        realtimeHub.sendToUsers([otherId], {
          type: 'message:read',
          conversationId: convId,
          readerId: actor.id,
          readAt: new Date().toISOString(),
        });
      }
    }

    const rows = db
      .prepare(
        `SELECT m.*,
                u.full_name as sender_name, u.role as sender_role, u.avatar_url as sender_avatar,
                att.original_name as attachment_name, att.mime_type as attachment_mime, att.size_bytes as attachment_size, att.category as attachment_category
         FROM messages m
         JOIN users u ON u.id = m.sender_id
         LEFT JOIN attachments att ON att.id = m.attachment_id
         WHERE m.conversation_id = ? AND m.deleted_at IS NULL
         ORDER BY m.created_at ASC`
      )
      .all(convId) as Array<any>;

    const messages = rows
      .map((m) => ({
        ...m,
        reactions: JSON.parse(m.reactions_json || '{}'),
        signedUrl: m.attachment_id ? createSignedDownloadUrl(m.attachment_id, actor.id, 300).url : null,
      }))
      .filter((m) => {
        if (!search) return true;
        return `${m.body} ${m.attachment_name || ''}`.toLowerCase().includes(search);
      });

    const oversightNotice =
      conv.thread_type === ConversationThreadType.TeamLeadCandidate
        ? 'Direct private channel between Candidate and Team Lead.'
        : conv.thread_type === ConversationThreadType.TeamLeadRecruiter
        ? 'Direct internal channel between Recruiter and Team Lead.'
        : 'Authorized Team Leads may review and participate in recruitment conversations for support and compliance.';

    res.json({
      conversation: conv,
      oversightNotice,
      messages,
    });
  });

  router.post('/conversations/:id/messages', (req: AuthedRequest, res) => {
    const db = getDb();
    const actor = req.actor!;
    const convId = req.params.id;
    const { body = '', messageType = 'text', attachmentId = null, replyToId = null } = req.body || {};

    const conv = db
      .prepare('SELECT * FROM conversations WHERE id = ?')
      .get(convId) as
      | { id: string; candidate_id: string; recruiter_id: string; thread_type: string; is_active: number }
      | undefined;

    if (!conv) {
      res.status(404).json({ error: 'Conversation not found.' });
      return;
    }

    const activeRecruiter = getActiveAssignedRecruiterId(db, conv.candidate_id);
    if (
      !canAccessConversation(
        actor,
        { candidateId: conv.candidate_id, recruiterId: conv.recruiter_id, threadType: conv.thread_type },
        activeRecruiter
      )
    ) {
      res.status(403).json({ error: 'Forbidden: you cannot send messages in this conversation.' });
      return;
    }

    const trimmedBody = String(body).trim();
    if (!trimmedBody && !attachmentId) {
      res.status(400).json({ error: 'Message body or attachment is required.' });
      return;
    }

    const msgId = newId('msg');
    const nowIso = new Date().toISOString();

    db.transaction(() => {
      db.prepare(
        `INSERT INTO messages (id, conversation_id, sender_id, message_type, body, attachment_id, reply_to_id, delivered_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(msgId, convId, actor.id, messageType, trimmedBody, attachmentId, replyToId, nowIso, nowIso);

      db.prepare(`UPDATE conversations SET last_message_at = ?, updated_at = ? WHERE id = ?`).run(nowIso, nowIso, convId);

      const recipients = [conv.candidate_id, conv.recruiter_id].filter((id) => id !== actor.id);
      const rolePrefix = actor.role === UserRole.TeamLead ? 'Team Lead ' : '';
      for (const recipientId of recipients) {
        createNotification(
          db,
          recipientId,
          'message',
          `New message from ${rolePrefix}${actor.fullName}`,
          trimmedBody ? trimmedBody.slice(0, 90) : 'Sent an attachment',
          'messages'
        );
      }

      if (actor.role === UserRole.TeamLead && conv.thread_type === ConversationThreadType.CandidateRecruiter) {
        writeAuditLog(
          db,
          actor.id,
          'message.team_lead_sent',
          'conversation',
          convId,
          { candidateId: conv.candidate_id, recruiterId: conv.recruiter_id },
          getClientIp(req)
        );
      }
    })();

    const created = db
      .prepare(
        `SELECT m.*,
                u.full_name as sender_name, u.role as sender_role, u.avatar_url as sender_avatar,
                att.original_name as attachment_name, att.mime_type as attachment_mime, att.size_bytes as attachment_size
         FROM messages m
         JOIN users u ON u.id = m.sender_id
         LEFT JOIN attachments att ON att.id = m.attachment_id
         WHERE m.id = ?`
      )
      .get(msgId) as any;

    const payload = {
      ...created,
      reactions: {},
      signedUrl: created.attachment_id ? createSignedDownloadUrl(created.attachment_id, actor.id, 300).url : null,
    };

    const participantIds = [conv.candidate_id, conv.recruiter_id];
    realtimeHub.sendToUsers(participantIds, {
      type: 'message:new',
      conversationId: convId,
      message: payload,
    });
    if (conv.thread_type === ConversationThreadType.CandidateRecruiter) {
      realtimeHub.sendToTeamLeads({
        type: 'message:new',
        conversationId: convId,
        message: payload,
      });
    }

    res.status(201).json({ message: payload });
  });

  router.post('/messages/:id/react', (req: AuthedRequest, res) => {
    const db = getDb();
    const actor = req.actor!;
    const msgId = req.params.id;
    const emoji = String(req.body?.emoji || '').trim();
    if (!emoji || emoji.length > 8) {
      res.status(400).json({ error: 'Valid emoji reaction required.' });
      return;
    }

    const msg = db
      .prepare(
        `SELECT m.id, m.conversation_id, m.reactions_json, c.candidate_id, c.recruiter_id, c.thread_type
         FROM messages m JOIN conversations c ON c.id = m.conversation_id
         WHERE m.id = ?`
      )
      .get(msgId) as
      | {
          id: string;
          conversation_id: string;
          reactions_json: string;
          candidate_id: string;
          recruiter_id: string;
          thread_type: string;
        }
      | undefined;

    if (!msg) {
      res.status(404).json({ error: 'Message not found.' });
      return;
    }

    const activeRecruiter = getActiveAssignedRecruiterId(db, msg.candidate_id);
    if (
      !canAccessConversation(
        actor,
        { candidateId: msg.candidate_id, recruiterId: msg.recruiter_id, threadType: msg.thread_type },
        activeRecruiter
      )
    ) {
      res.status(403).json({ error: 'Forbidden.' });
      return;
    }

    const reactions = JSON.parse(msg.reactions_json || '{}') as Record<string, string[]>;
    const list = new Set(reactions[emoji] || []);
    if (list.has(actor.id)) {
      list.delete(actor.id);
    } else {
      list.add(actor.id);
    }
    if (list.size === 0) {
      delete reactions[emoji];
    } else {
      reactions[emoji] = Array.from(list);
    }

    db.prepare('UPDATE messages SET reactions_json = ? WHERE id = ?').run(JSON.stringify(reactions), msgId);

    realtimeHub.sendToUsers([msg.candidate_id, msg.recruiter_id], {
      type: 'message:reaction',
      conversationId: msg.conversation_id,
      messageId: msgId,
      reactions,
    });
    if (msg.thread_type === ConversationThreadType.CandidateRecruiter) {
      realtimeHub.sendToTeamLeads({
        type: 'message:reaction',
        conversationId: msg.conversation_id,
        messageId: msgId,
        reactions,
      });
    }

    res.json({ reactions });
  });

  router.delete('/messages/:id', (req: AuthedRequest, res) => {
    const db = getDb();
    const actor = req.actor!;
    const msgId = req.params.id;

    const msg = db.prepare('SELECT id, sender_id, conversation_id FROM messages WHERE id = ?').get(msgId) as
      | { id: string; sender_id: string; conversation_id: string }
      | undefined;
    if (!msg) {
      res.status(404).json({ error: 'Message not found.' });
      return;
    }
    if (msg.sender_id !== actor.id && actor.role !== UserRole.TeamLead) {
      res.status(403).json({ error: 'Only the message author or Team Lead can delete a message.' });
      return;
    }

    db.prepare(`UPDATE messages SET deleted_at = datetime('now') WHERE id = ?`).run(msgId);
    writeAuditLog(db, actor.id, 'message.deleted', 'message', msgId, { conversationId: msg.conversation_id }, getClientIp(req));
    res.json({ ok: true });
  });

  // ==========================================================================
  // PRIVATE INTERNAL RECRUITER NOTES (STRICTLY BLOCKED FOR CANDIDATES)
  // ==========================================================================

  router.get('/candidates/:id/notes', (req: AuthedRequest, res) => {
    const db = getDb();
    const actor = req.actor!;
    const candidateId = req.params.id;
    const activeRecruiter = getActiveAssignedRecruiterId(db, candidateId);

    if (!canAccessInternalNotes(actor, activeRecruiter)) {
      res.status(403).json({ error: 'Forbidden: internal notes are restricted to assigned recruiters and Team Leads.' });
      return;
    }

    const notes = db
      .prepare(
        `SELECT n.*, u.full_name as author_name, u.role as author_role
         FROM internal_notes n JOIN users u ON u.id = n.author_id
         WHERE n.candidate_id = ?
         ORDER BY n.created_at DESC`
      )
      .all(candidateId);

    res.json({ notes });
  });

  router.post('/candidates/:id/notes', (req: AuthedRequest, res) => {
    const db = getDb();
    const actor = req.actor!;
    const candidateId = req.params.id;
    const activeRecruiter = getActiveAssignedRecruiterId(db, candidateId);

    if (!canAccessInternalNotes(actor, activeRecruiter)) {
      res.status(403).json({ error: 'Forbidden: candidates cannot create or view internal notes.' });
      return;
    }

    const content = String(req.body?.content || '').trim();
    if (!content) {
      res.status(400).json({ error: 'Note content cannot be empty.' });
      return;
    }

    const noteId = newId('note');
    db.prepare(
      `INSERT INTO internal_notes (id, candidate_id, author_id, content) VALUES (?, ?, ?, ?)`
    ).run(noteId, candidateId, actor.id, content);

    const created = db
      .prepare(
        `SELECT n.*, u.full_name as author_name, u.role as author_role
         FROM internal_notes n JOIN users u ON u.id = n.author_id
         WHERE n.id = ?`
      )
      .get(noteId);

    res.status(201).json({ note: created });
  });

  // ==========================================================================
  // AVAILABILITY MANAGEMENT (Weekly Recurring + Daily Overrides + Timezone)
  // ==========================================================================

  router.get('/availability/overview', requireRole(UserRole.Recruiter, UserRole.TeamLead), (req: AuthedRequest, res) => {
    const db = getDb();
    const actor = req.actor!;
    const dateStr = String(req.query.date || todayDateInTimezone(actor.timezone));
    const recruiterFilter = String(req.query.recruiterId || '');
    const techFilter = String(req.query.technology || '').trim().toLowerCase();

    const rows =
      actor.role === UserRole.Recruiter
        ? db
            .prepare(
              `SELECT u.id, u.full_name, u.avatar_url, u.timezone, cp.technology, cp.location, cp.visa_status,
                      ru.id as recruiter_id, ru.full_name as recruiter_name
               FROM assignments a
               JOIN users u ON u.id = a.candidate_id
               JOIN candidate_profiles cp ON cp.user_id = u.id
               JOIN users ru ON ru.id = a.recruiter_id
               WHERE a.recruiter_id = ? AND a.is_active = 1 AND u.is_active = 1
               ORDER BY u.full_name ASC`
            )
            .all(actor.id)
        : db
            .prepare(
              `SELECT u.id, u.full_name, u.avatar_url, u.timezone, cp.technology, cp.location, cp.visa_status,
                      a.recruiter_id, ru.full_name as recruiter_name
               FROM users u
               JOIN candidate_profiles cp ON cp.user_id = u.id
               LEFT JOIN assignments a ON a.candidate_id = u.id AND a.is_active = 1
               LEFT JOIN users ru ON ru.id = a.recruiter_id
               WHERE u.role = 'candidate' AND u.is_active = 1
               ORDER BY u.full_name ASC`
            )
            .all();

    const items = (rows as Array<any>)
      .filter((r) => {
        if (recruiterFilter && actor.role === UserRole.TeamLead && r.recruiter_id !== recruiterFilter) return false;
        if (techFilter && !String(r.technology || '').toLowerCase().includes(techFilter)) return false;
        return true;
      })
      .map((r) => ({
        ...r,
        availability: loadCandidateAvailability(r.id, dateStr, actor.timezone),
      }));

    res.json({ date: dateStr, viewerTimezone: actor.timezone, items });
  });

  router.get('/availability/:candidateId', (req: AuthedRequest, res) => {
    const db = getDb();
    const actor = req.actor!;
    const candidateId = req.params.candidateId;
    const activeRecruiter = getActiveAssignedRecruiterId(db, candidateId);

    if (!canAccessCandidate(actor, candidateId, activeRecruiter)) {
      res.status(403).json({ error: 'Forbidden: cannot view this candidate availability.' });
      return;
    }

    const dateStr = String(req.query.date || todayDateInTimezone(actor.timezone));
    res.json(loadCandidateAvailability(candidateId, dateStr, actor.timezone));
  });

  router.put('/availability/:candidateId/weekly', (req: AuthedRequest, res) => {
    const db = getDb();
    const actor = req.actor!;
    const candidateId = req.params.candidateId;

    // Recruiters cannot overwrite candidate availability in MVP
    if (actor.role === UserRole.Recruiter || (actor.role === UserRole.Candidate && actor.id !== candidateId)) {
      res.status(403).json({ error: 'Only the candidate (or Team Lead) can update weekly availability.' });
      return;
    }

    const { timezone, rules } = req.body as { timezone?: string; rules: WeeklyRule[] };
    if (!Array.isArray(rules) || rules.length === 0) {
      res.status(400).json({ error: 'Weekly availability rules are required.' });
      return;
    }

    for (const r of rules) {
      if (r.isAvailable) {
        const check = validateTimeSlots(r.slots || []);
        if (!check.valid) {
          res.status(400).json({ error: check.error });
          return;
        }
      }
    }

    db.transaction(() => {
      if (timezone) {
        db.prepare(`UPDATE users SET timezone = ?, updated_at = datetime('now') WHERE id = ?`).run(timezone, candidateId);
      }

      for (const r of rules) {
        db.prepare(
          `INSERT INTO availability_rules (id, candidate_id, day_of_week, is_available, slots_json, updated_at)
           VALUES (?, ?, ?, ?, ?, datetime('now'))
           ON CONFLICT(candidate_id, day_of_week) DO UPDATE SET
             is_available = excluded.is_available,
             slots_json = excluded.slots_json,
             updated_at = datetime('now')`
        ).run(
          newId('rule'),
          candidateId,
          r.dayOfWeek,
          r.isAvailable ? 1 : 0,
          JSON.stringify(r.isAvailable ? r.slots : [])
        );
      }

      const assignedRecruiter = getActiveAssignedRecruiterId(db, candidateId);
      if (assignedRecruiter) {
        createNotification(
          db,
          assignedRecruiter,
          'availability_change',
          `Weekly Availability Updated: ${actor.fullName}`,
          `${actor.fullName} updated their recurring weekly schedule${timezone ? ` (${timezone})` : ''}.`,
          'availability'
        );
        realtimeHub.sendToUsers([assignedRecruiter], { type: 'notification:new' });
      }

      writeAuditLog(db, actor.id, 'availability.weekly_updated', 'candidate', candidateId, { timezone }, getClientIp(req));
    })();

    res.json({ ok: true });
  });

  router.post('/availability/:candidateId/exceptions', (req: AuthedRequest, res) => {
    const db = getDb();
    const actor = req.actor!;
    const candidateId = req.params.candidateId;

    if (actor.role === UserRole.Recruiter || (actor.role === UserRole.Candidate && actor.id !== candidateId)) {
      res.status(403).json({ error: 'Only the candidate (or Team Lead) can set custom daily exceptions.' });
      return;
    }

    const { date, isUnavailable = false, slots = [], note = '' } = req.body as DailyException;
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      res.status(400).json({ error: 'Valid YYYY-MM-DD date is required.' });
      return;
    }

    if (!isUnavailable) {
      const check = validateTimeSlots(slots);
      if (!check.valid) {
        res.status(400).json({ error: check.error });
        return;
      }
    }

    db.transaction(() => {
      db.prepare(
        `INSERT INTO availability_exceptions (id, candidate_id, exception_date, is_unavailable, slots_json, note, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT(candidate_id, exception_date) DO UPDATE SET
           is_unavailable = excluded.is_unavailable,
           slots_json = excluded.slots_json,
           note = excluded.note,
           updated_at = datetime('now')`
      ).run(
        newId('exc'),
        candidateId,
        date,
        isUnavailable ? 1 : 0,
        JSON.stringify(isUnavailable ? [] : slots),
        String(note).trim()
      );

      const assignedRecruiter = getActiveAssignedRecruiterId(db, candidateId);
      if (assignedRecruiter) {
        createNotification(
          db,
          assignedRecruiter,
          'availability_change',
          `Custom Availability Set: ${actor.fullName}`,
          isUnavailable
            ? `${actor.fullName} marked ${date} as unavailable.`
            : `${actor.fullName} set custom interview slots for ${date}.`,
          'availability'
        );
        realtimeHub.sendToUsers([assignedRecruiter], { type: 'notification:new' });
      }

      writeAuditLog(
        db,
        actor.id,
        'availability.exception_saved',
        'candidate',
        candidateId,
        { date, isUnavailable, slotCount: slots.length },
        getClientIp(req)
      );
    })();

    res.json({ ok: true });
  });

  router.delete('/availability/:candidateId/exceptions/:date', (req: AuthedRequest, res) => {
    const db = getDb();
    const actor = req.actor!;
    const { candidateId, date } = req.params;
    if (actor.role === UserRole.Recruiter || (actor.role === UserRole.Candidate && actor.id !== candidateId)) {
      res.status(403).json({ error: 'Forbidden.' });
      return;
    }

    db.prepare('DELETE FROM availability_exceptions WHERE candidate_id = ? AND exception_date = ?').run(
      candidateId,
      date
    );
    res.json({ ok: true });
  });

  router.post('/availability/:candidateId/quick-today', (req: AuthedRequest, res) => {
    const db = getDb();
    const actor = req.actor!;
    const candidateId = req.params.candidateId;
    if (actor.role !== UserRole.Candidate || actor.id !== candidateId) {
      res.status(403).json({ error: 'Only the candidate can trigger quick availability.' });
      return;
    }

    const today = todayDateInTimezone(actor.timezone);
    const slots: TimeSlot[] = [
      { start: '09:00', end: '12:00' },
      { start: '13:30', end: '18:00' },
    ];

    db.transaction(() => {
      db.prepare(
        `INSERT INTO availability_exceptions (id, candidate_id, exception_date, is_unavailable, slots_json, note, updated_at)
         VALUES (?, ?, ?, 0, ?, 'Available for Interview Today (Quick Action)', datetime('now'))
         ON CONFLICT(candidate_id, exception_date) DO UPDATE SET
           is_unavailable = 0,
           slots_json = excluded.slots_json,
           note = excluded.note,
           updated_at = datetime('now')`
      ).run(newId('exc'), candidateId, today, JSON.stringify(slots));

      const assignedRecruiter = getActiveAssignedRecruiterId(db, candidateId);
      if (assignedRecruiter) {
        createNotification(
          db,
          assignedRecruiter,
          'availability_change',
          `${actor.fullName} is Available for Interviews Today`,
          `Quick action confirmed full interview availability for ${today} (${actor.timezone}).`,
          'availability'
        );
        realtimeHub.sendToUsers([assignedRecruiter], { type: 'notification:new' });
      }
    })();

    res.json({ ok: true, date: today, slots });
  });

  // ==========================================================================
  // INTERVIEW SCHEDULING & CONFLICT DETECTION
  // ==========================================================================

  router.get('/interviews', (req: AuthedRequest, res) => {
    const db = getDb();
    const actor = req.actor!;

    let rows: Array<any>;
    if (actor.role === UserRole.Candidate) {
      rows = db
        .prepare(
          `SELECT i.*, cu.full_name as candidate_name, ru.full_name as recruiter_name, cp.technology
           FROM interviews i
           JOIN users cu ON cu.id = i.candidate_id
           JOIN users ru ON ru.id = i.recruiter_id
           LEFT JOIN candidate_profiles cp ON cp.user_id = cu.id
           WHERE i.candidate_id = ?
           ORDER BY i.start_utc ASC`
        )
        .all(actor.id);
    } else if (actor.role === UserRole.Recruiter) {
      rows = db
        .prepare(
          `SELECT i.*, cu.full_name as candidate_name, ru.full_name as recruiter_name, cp.technology
           FROM interviews i
           JOIN assignments a ON a.candidate_id = i.candidate_id AND a.recruiter_id = ? AND a.is_active = 1
           JOIN users cu ON cu.id = i.candidate_id
           JOIN users ru ON ru.id = i.recruiter_id
           LEFT JOIN candidate_profiles cp ON cp.user_id = cu.id
           WHERE i.recruiter_id = ?
           ORDER BY i.start_utc ASC`
        )
        .all(actor.id, actor.id);
    } else {
      rows = db
        .prepare(
          `SELECT i.*, cu.full_name as candidate_name, ru.full_name as recruiter_name, cp.technology
           FROM interviews i
           JOIN users cu ON cu.id = i.candidate_id
           JOIN users ru ON ru.id = i.recruiter_id
           LEFT JOIN candidate_profiles cp ON cp.user_id = cu.id
           ORDER BY i.start_utc ASC`
        )
        .all();
    }

    res.json({ interviews: rows });
  });

  router.post('/interviews', requireRole(UserRole.Recruiter, UserRole.TeamLead), (req: AuthedRequest, res) => {
    const db = getDb();
    const actor = req.actor!;
    const {
      candidateId,
      companyName,
      jobPosition,
      date,
      startTime,
      durationMinutes = 45,
      timezone = actor.timezone,
      interviewType = InterviewType.Video,
      meetingLink = '',
      instructions = '',
    } = req.body || {};

    if (!candidateId || !companyName?.trim() || !jobPosition?.trim() || !date || !startTime) {
      res.status(400).json({ error: 'Candidate, company, job position, date, and time are required.' });
      return;
    }

    if (meetingLink && !isValidHttpUrl(String(meetingLink))) {
      res.status(400).json({ error: 'Meeting link must be a valid http:// or https:// URL.' });
      return;
    }

    const activeRecruiterId = getActiveAssignedRecruiterId(db, candidateId);
    if (!canAccessCandidate(actor, candidateId, activeRecruiterId)) {
      res.status(403).json({ error: 'Forbidden: you can only schedule interviews for your assigned candidates.' });
      return;
    }

    const recruiterId = actor.role === UserRole.Recruiter ? actor.id : activeRecruiterId || actor.id;
    const startUtcDate = zonedTimeToUtc(date, startTime, timezone);
    const endUtcDate = new Date(startUtcDate.getTime() + Number(durationMinutes) * 60_000);

    const existingRows = db
      .prepare(
        `SELECT id, candidate_id, recruiter_id, start_utc, end_utc, status FROM interviews
         WHERE status IN ('confirmed', 'requested', 'reschedule_requested')`
      )
      .all() as Array<{
      id: string;
      candidate_id: string;
      recruiter_id: string;
      start_utc: string;
      end_utc: string;
      status: InterviewStatus;
    }>;

    const existingIntervals: InterviewInterval[] = existingRows.map((r) => ({
      id: r.id,
      candidateId: r.candidate_id,
      recruiterId: r.recruiter_id,
      startUtc: r.start_utc,
      endUtc: r.end_utc,
      status: r.status,
    }));

    const conflict = hasInterviewConflict(
      existingIntervals,
      candidateId,
      recruiterId,
      startUtcDate.toISOString(),
      endUtcDate.toISOString()
    );

    if (conflict.hasConflict) {
      res.status(409).json({ error: conflict.reason || 'Scheduling conflict detected.' });
      return;
    }

    const ivId = newId('iv');
    db.transaction(() => {
      db.prepare(
        `INSERT INTO interviews (id, candidate_id, recruiter_id, company_name, job_position, start_utc, end_utc, timezone, interview_type, meeting_link, instructions, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested')`
      ).run(
        ivId,
        candidateId,
        recruiterId,
        companyName.trim(),
        jobPosition.trim(),
        startUtcDate.toISOString(),
        endUtcDate.toISOString(),
        timezone,
        interviewType,
        String(meetingLink).trim(),
        String(instructions).trim()
      );

      createNotification(
        db,
        candidateId,
        'interview_request',
        `Interview Request: ${companyName.trim()}`,
        `${actor.fullName} scheduled a ${interviewType} interview for ${jobPosition.trim()} on ${date} at ${startTime} (${timezone}).`,
        'interviews'
      );

      writeAuditLog(
        db,
        actor.id,
        'interview.created',
        'interview',
        ivId,
        { candidateId, companyName: companyName.trim(), startUtc: startUtcDate.toISOString() },
        getClientIp(req)
      );
    })();

    realtimeHub.sendToUsers([candidateId], { type: 'notification:new' });
    res.status(201).json({ id: ivId });
  });

  router.post('/interviews/:id/respond', requireRole(UserRole.Candidate), (req: AuthedRequest, res) => {
    const db = getDb();
    const actor = req.actor!;
    const ivId = req.params.id;
    const { action, note = '' } = req.body || {};

    const iv = db.prepare('SELECT * FROM interviews WHERE id = ?').get(ivId) as any;
    if (!iv) {
      res.status(404).json({ error: 'Interview not found.' });
      return;
    }
    if (iv.candidate_id !== actor.id) {
      res.status(403).json({ error: 'Forbidden.' });
      return;
    }

    let newStatus: InterviewStatus;
    if (action === 'confirm') newStatus = InterviewStatus.Confirmed;
    else if (action === 'decline') newStatus = InterviewStatus.Cancelled;
    else if (action === 'reschedule') newStatus = InterviewStatus.RescheduleRequested;
    else {
      res.status(400).json({ error: 'Invalid response action.' });
      return;
    }

    db.transaction(() => {
      db.prepare(
        `UPDATE interviews SET status = ?, candidate_note = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(newStatus, String(note).trim(), ivId);

      createNotification(
        db,
        iv.recruiter_id,
        'interview_update',
        `Interview ${newStatus.replace('_', ' ')}: ${iv.company_name}`,
        `${actor.fullName} responded (${newStatus.replace('_', ' ')}) to ${iv.job_position}.${note ? ` Note: ${note}` : ''}`,
        'interviews'
      );

      writeAuditLog(db, actor.id, `interview.${action}`, 'interview', ivId, { status: newStatus }, getClientIp(req));
    })();

    realtimeHub.sendToUsers([iv.recruiter_id], { type: 'notification:new' });
    res.json({ ok: true, status: newStatus });
  });

  router.patch('/interviews/:id', requireRole(UserRole.Recruiter, UserRole.TeamLead), (req: AuthedRequest, res) => {
    const db = getDb();
    const actor = req.actor!;
    const ivId = req.params.id;
    const { status, outcome, feedback, date, startTime, durationMinutes, timezone, meetingLink, instructions } =
      req.body || {};

    const iv = db.prepare('SELECT * FROM interviews WHERE id = ?').get(ivId) as any;
    if (!iv) {
      res.status(404).json({ error: 'Interview not found.' });
      return;
    }

    const activeRecruiter = getActiveAssignedRecruiterId(db, iv.candidate_id);
    if (!canAccessCandidate(actor, iv.candidate_id, activeRecruiter)) {
      res.status(403).json({ error: 'Forbidden.' });
      return;
    }

    let nextStartUtc = iv.start_utc;
    let nextEndUtc = iv.end_utc;
    if (date && startTime) {
      const tz = timezone || iv.timezone;
      const startD = zonedTimeToUtc(date, startTime, tz);
      const dur = Number(durationMinutes) || 45;
      const endD = new Date(startD.getTime() + dur * 60_000);

      const existingRows = db
        .prepare(
          `SELECT id, candidate_id, recruiter_id, start_utc, end_utc, status FROM interviews
           WHERE status IN ('confirmed', 'requested', 'reschedule_requested')`
        )
        .all() as Array<any>;

      const conflict = hasInterviewConflict(
        existingRows.map((r) => ({
          id: r.id,
          candidateId: r.candidate_id,
          recruiterId: r.recruiter_id,
          startUtc: r.start_utc,
          endUtc: r.end_utc,
          status: r.status,
        })),
        iv.candidate_id,
        iv.recruiter_id,
        startD.toISOString(),
        endD.toISOString(),
        ivId
      );

      if (conflict.hasConflict) {
        res.status(409).json({ error: conflict.reason });
        return;
      }
      nextStartUtc = startD.toISOString();
      nextEndUtc = endD.toISOString();
    }

    db.transaction(() => {
      db.prepare(
        `UPDATE interviews SET
          status = COALESCE(?, status),
          outcome = COALESCE(?, outcome),
          feedback = COALESCE(?, feedback),
          start_utc = ?,
          end_utc = ?,
          timezone = COALESCE(?, timezone),
          meeting_link = COALESCE(?, meeting_link),
          instructions = COALESCE(?, instructions),
          updated_at = datetime('now')
         WHERE id = ?`
      ).run(
        status || null,
        outcome !== undefined ? String(outcome).trim() : null,
        feedback !== undefined ? String(feedback).trim() : null,
        nextStartUtc,
        nextEndUtc,
        timezone || null,
        meetingLink !== undefined ? String(meetingLink).trim() : null,
        instructions !== undefined ? String(instructions).trim() : null,
        ivId
      );

      createNotification(
        db,
        iv.candidate_id,
        'interview_update',
        `Interview Updated: ${iv.company_name}`,
        `${actor.fullName} updated your ${iv.job_position} interview (${status || iv.status}).`,
        'interviews'
      );

      writeAuditLog(db, actor.id, 'interview.updated', 'interview', ivId, { status, outcome }, getClientIp(req));
    })();

    realtimeHub.sendToUsers([iv.candidate_id], { type: 'notification:new' });
    res.json({ ok: true });
  });

  // ==========================================================================
  // DOCUMENTS & PRIVATE UPLOADS (Resumes, Supporting Docs, Chat Files, Voice Notes)
  // ==========================================================================

  router.get('/documents/:candidateId', (req: AuthedRequest, res) => {
    const db = getDb();
    const actor = req.actor!;
    const candidateId = req.params.candidateId;
    const activeRecruiter = getActiveAssignedRecruiterId(db, candidateId);

    if (!canAccessCandidate(actor, candidateId, activeRecruiter)) {
      res.status(403).json({ error: 'Forbidden: unauthorized document list access.' });
      return;
    }

    const docs = db
      .prepare(
        `SELECT a.*, u.full_name as uploader_name
         FROM attachments a JOIN users u ON u.id = a.uploaded_by
         WHERE a.candidate_id = ? AND a.category IN ('resume', 'document')
         ORDER BY a.created_at DESC`
      )
      .all(candidateId) as Array<any>;

    const enriched = docs.map((d) => ({
      ...d,
      signedUrl: createSignedDownloadUrl(d.id, actor.id, 180).url,
    }));

    res.json({ documents: enriched });
  });

  router.post('/uploads', upload.single('file'), (req: AuthedRequest, res) => {
    const db = getDb();
    const actor = req.actor!;
    const file = req.file;
    if (!file) {
      res.status(400).json({ error: 'File payload is required.' });
      return;
    }

    const candidateId = String(req.body?.candidateId || (actor.role === UserRole.Candidate ? actor.id : '')).trim();
    const category = String(req.body?.category || 'chat_file').trim();
    const versionLabel = String(req.body?.versionLabel || 'v1').trim();

    if (!candidateId) {
      res.status(400).json({ error: 'Candidate ID is required for private file scoping.' });
      return;
    }

    const activeRecruiter = getActiveAssignedRecruiterId(db, candidateId);
    const isSelfStaffUpload = actor.role === UserRole.Recruiter && candidateId === actor.id;
    if (!isSelfStaffUpload && !canAccessCandidate(actor, candidateId, activeRecruiter)) {
      res.status(403).json({ error: 'Forbidden: cannot upload files for this candidate.' });
      return;
    }

    const validation = validateUploadedFile({
      originalName: file.originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size,
    });
    if (!validation.valid || !validation.safeName) {
      res.status(400).json({ error: validation.error });
      return;
    }

    const validCategories = new Set(['resume', 'document', 'chat_file', 'voice_note']);
    const safeCategory = validCategories.has(category) ? category : 'chat_file';
    const attId = newId('att');
    const storageKey = `${attId}_${validation.safeName}`;

    storePrivateObject(storageKey, file.buffer);

    db.prepare(
      `INSERT INTO attachments (id, candidate_id, uploaded_by, storage_key, original_name, mime_type, size_bytes, category, version_label)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      attId,
      candidateId,
      actor.id,
      storageKey,
      validation.safeName,
      file.mimetype.split(';')[0].trim().toLowerCase(),
      file.size,
      safeCategory,
      versionLabel
    );

    writeAuditLog(
      db,
      actor.id,
      'file.uploaded',
      'attachment',
      attId,
      { filename: validation.safeName, category: safeCategory, sizeBytes: file.size },
      getClientIp(req)
    );

    const signed = createSignedDownloadUrl(attId, actor.id, 300);
    res.status(201).json({
      attachment: {
        id: attId,
        original_name: validation.safeName,
        mime_type: file.mimetype,
        size_bytes: file.size,
        category: safeCategory,
        version_label: versionLabel,
        signedUrl: signed.url,
      },
    });
  });

  // ==========================================================================
  // VOICE & VIDEO CALL METADATA & HISTORY
  // ==========================================================================

  router.get('/calls', (req: AuthedRequest, res) => {
    const db = getDb();
    const actor = req.actor!;

    const calls =
      actor.role === UserRole.TeamLead
        ? db
            .prepare(
              `SELECT c.*, u1.full_name as caller_name, u1.role as caller_role,
                      u2.full_name as callee_name, u2.role as callee_role
               FROM calls c
               JOIN users u1 ON u1.id = c.caller_id
               JOIN users u2 ON u2.id = c.callee_id
               ORDER BY c.started_at DESC LIMIT 50`
            )
            .all()
        : db
            .prepare(
              `SELECT c.*, u1.full_name as caller_name, u1.role as caller_role,
                      u2.full_name as callee_name, u2.role as callee_role
               FROM calls c
               JOIN users u1 ON u1.id = c.caller_id
               JOIN users u2 ON u2.id = c.callee_id
               WHERE c.caller_id = ? OR c.callee_id = ?
               ORDER BY c.started_at DESC LIMIT 50`
            )
            .all(actor.id, actor.id);

    res.json({ calls, config: getCallingConfig() });
  });

  router.post('/calls', (req: AuthedRequest, res) => {
    const db = getDb();
    const actor = req.actor!;
    const { conversationId, calleeId, callType = CallType.Audio } = req.body || {};

    if (!conversationId || !calleeId) {
      res.status(400).json({ error: 'Conversation and callee are required.' });
      return;
    }

    const conv = db.prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId) as
      | { id: string; candidate_id: string; recruiter_id: string; thread_type: string }
      | undefined;
    if (!conv) {
      res.status(404).json({ error: 'Conversation not found.' });
      return;
    }

    const activeRecruiter = getActiveAssignedRecruiterId(db, conv.candidate_id);
    if (
      !canAccessConversation(
        actor,
        { candidateId: conv.candidate_id, recruiterId: conv.recruiter_id, threadType: conv.thread_type },
        activeRecruiter
      )
    ) {
      res.status(403).json({ error: 'Forbidden.' });
      return;
    }

    const callId = newId('call');
    db.prepare(
      `INSERT INTO calls (id, conversation_id, caller_id, callee_id, call_type, status)
       VALUES (?, ?, ?, ?, ?, 'ringing')`
    ).run(callId, conversationId, actor.id, calleeId, callType);

    createNotification(
      db,
      calleeId,
      'incoming_call',
      `Incoming ${callType === 'video' ? 'Video' : 'Audio'} Call`,
      `${actor.fullName} started a ${callType} call with you.`,
      'calls'
    );

    res.status(201).json({ callId });
  });

  router.patch('/calls/:id', (req: AuthedRequest, res) => {
    const db = getDb();
    const actor = req.actor!;
    const callId = req.params.id;
    const { status, durationSec = 0, outcome = '' } = req.body || {};

    const call = db.prepare('SELECT * FROM calls WHERE id = ?').get(callId) as any;
    if (!call) {
      res.status(404).json({ error: 'Call record not found.' });
      return;
    }
    if (call.caller_id !== actor.id && call.callee_id !== actor.id && actor.role !== UserRole.TeamLead) {
      res.status(403).json({ error: 'Forbidden.' });
      return;
    }

    db.prepare(
      `UPDATE calls SET
         status = COALESCE(?, status),
         duration_sec = CASE WHEN ? > 0 THEN ? ELSE duration_sec END,
         outcome = COALESCE(?, outcome),
         ended_at = CASE WHEN ? IN ('ended', 'missed', 'declined') THEN datetime('now') ELSE ended_at END
       WHERE id = ?`
    ).run(status || null, Number(durationSec), Number(durationSec), outcome || null, status || '', callId);

    if (status === CallStatus.Missed && call.conversation_id) {
      const msgId = newId('msg');
      db.prepare(
        `INSERT INTO messages (id, conversation_id, sender_id, message_type, body, delivered_at)
         VALUES (?, ?, ?, 'call_event', ?, datetime('now'))`
      ).run(msgId, call.conversation_id, call.caller_id, `Missed ${call.call_type} call`);

      createNotification(
        db,
        call.callee_id,
        'missed_call',
        `Missed ${call.call_type === 'video' ? 'Video' : 'Audio'} Call`,
        `You missed a ${call.call_type} call from ${actor.fullName}.`,
        'calls'
      );
      realtimeHub.sendToUsers([call.callee_id], { type: 'notification:new' });
    }

    res.json({ ok: true });
  });

  // ==========================================================================
  // REMINDERS, NOTIFICATIONS, PREFERENCES & AUDIT LOGS
  // ==========================================================================

  router.get('/reminders', requireRole(UserRole.Recruiter, UserRole.TeamLead), (req: AuthedRequest, res) => {
    const db = getDb();
    const rows = db
      .prepare(
        `SELECT r.*, u.full_name as candidate_name
         FROM reminders r LEFT JOIN users u ON u.id = r.candidate_id
         WHERE r.user_id = ?
         ORDER BY r.is_completed ASC, r.due_at ASC`
      )
      .all(req.actor!.id);
    res.json({ reminders: rows });
  });

  router.post('/reminders', requireRole(UserRole.Recruiter, UserRole.TeamLead), (req: AuthedRequest, res) => {
    const db = getDb();
    const { title, dueAt, candidateId = null } = req.body || {};
    if (!title?.trim() || !dueAt) {
      res.status(400).json({ error: 'Reminder title and due date/time are required.' });
      return;
    }
    const id = newId('rem');
    db.prepare(`INSERT INTO reminders (id, user_id, candidate_id, title, due_at) VALUES (?, ?, ?, ?, ?)`).run(
      id,
      req.actor!.id,
      candidateId || null,
      title.trim(),
      dueAt
    );
    res.status(201).json({ id });
  });

  router.patch('/reminders/:id', requireRole(UserRole.Recruiter, UserRole.TeamLead), (req: AuthedRequest, res) => {
    const db = getDb();
    const { isCompleted } = req.body || {};
    db.prepare('UPDATE reminders SET is_completed = ? WHERE id = ? AND user_id = ?').run(
      isCompleted ? 1 : 0,
      req.params.id,
      req.actor!.id
    );
    res.json({ ok: true });
  });

  router.get('/notifications', (req: AuthedRequest, res) => {
    const db = getDb();
    const rows = db
      .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 40')
      .all(req.actor!.id);
    const prefs = db
      .prepare('SELECT * FROM notification_preferences WHERE user_id = ?')
      .get(req.actor!.id);
    res.json({ notifications: rows, preferences: prefs });
  });

  router.post('/notifications/read-all', (req: AuthedRequest, res) => {
    const db = getDb();
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.actor!.id);
    res.json({ ok: true });
  });

  router.put('/notification-preferences', (req: AuthedRequest, res) => {
    const db = getDb();
    const p = req.body || {};
    db.prepare(
      `INSERT INTO notification_preferences (user_id, browser_push, email_alerts, message_alerts, interview_alerts, availability_alerts, call_alerts, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         browser_push = excluded.browser_push,
         email_alerts = excluded.email_alerts,
         message_alerts = excluded.message_alerts,
         interview_alerts = excluded.interview_alerts,
         availability_alerts = excluded.availability_alerts,
         call_alerts = excluded.call_alerts,
         updated_at = datetime('now')`
    ).run(
      req.actor!.id,
      p.browser_push ? 1 : 0,
      p.email_alerts ? 1 : 0,
      p.message_alerts ? 1 : 0,
      p.interview_alerts ? 1 : 0,
      p.availability_alerts ? 1 : 0,
      p.call_alerts ? 1 : 0
    );
    res.json({ ok: true });
  });

  router.get('/audit-logs', requireRole(UserRole.TeamLead), (req, res) => {
    const db = getDb();
    const q = String(req.query.q || '').trim().toLowerCase();
    const rows = db
      .prepare(
        `SELECT al.*, u.full_name as actor_name, u.role as actor_role, u.email as actor_email
         FROM audit_logs al
         LEFT JOIN users u ON u.id = al.actor_id
         ORDER BY al.created_at DESC LIMIT 120`
      )
      .all() as Array<any>;

    const filtered = rows.filter((r) => {
      if (!q) return true;
      return `${r.action} ${r.actor_name || ''} ${r.entity_type} ${r.details_json}`.toLowerCase().includes(q);
    });

    res.json({ logs: filtered });
  });

  router.patch('/account/settings', (req: AuthedRequest, res) => {
    const db = getDb();
    const { fullName, phone, timezone } = req.body || {};
    db.prepare(
      `UPDATE users SET
        full_name = COALESCE(?, full_name),
        phone = COALESCE(?, phone),
        timezone = COALESCE(?, timezone),
        updated_at = datetime('now')
       WHERE id = ?`
    ).run(fullName?.trim() || null, phone !== undefined ? String(phone).trim() : null, timezone || null, req.actor!.id);

    writeAuditLog(db, req.actor!.id, 'account.settings_updated', 'user', req.actor!.id, { timezone }, getClientIp(req));
    res.json({ ok: true });
  });

  // ==========================================================================
  // CANDIDATE COMPLAINTS (DIRECT TO TEAM LEAD, VISIBLE ONLY TO ASSIGNED RECRUITER)
  // ==========================================================================

  const VALID_COMPLAINT_CATEGORIES = new Set<string>(Object.values(ComplaintCategory));
  const VALID_COMPLAINT_PRIORITIES = new Set<string>(Object.values(ComplaintPriority));
  const VALID_COMPLAINT_STATUSES = new Set<string>(Object.values(ComplaintStatus));

  router.get('/complaints', (req: AuthedRequest, res) => {
    const db = getDb();
    const actor = req.actor!;
    const statusFilter = String(req.query.status || '').trim();

    let rows: Array<any>;
    if (actor.role === UserRole.TeamLead) {
      rows = db
        .prepare(
          `SELECT cmp.*,
                  cu.full_name as candidate_name, cu.email as candidate_email, cu.avatar_url as candidate_avatar,
                  cp.technology as candidate_technology,
                  ru.full_name as recruiter_name, ru.email as recruiter_email,
                  resu.full_name as resolved_by_name
           FROM complaints cmp
           JOIN users cu ON cu.id = cmp.candidate_id
           LEFT JOIN candidate_profiles cp ON cp.user_id = cu.id
           LEFT JOIN users ru ON ru.id = cmp.recruiter_id
           LEFT JOIN users resu ON resu.id = cmp.resolved_by
           ORDER BY CASE cmp.status WHEN 'open' THEN 1 WHEN 'in_review' THEN 2 ELSE 3 END, cmp.created_at DESC`
        )
        .all();
    } else if (actor.role === UserRole.Candidate) {
      // Candidates see ONLY their own submitted complaints
      rows = db
        .prepare(
          `SELECT cmp.*,
                  cu.full_name as candidate_name, cu.email as candidate_email, cu.avatar_url as candidate_avatar,
                  cp.technology as candidate_technology,
                  ru.full_name as recruiter_name, ru.email as recruiter_email,
                  resu.full_name as resolved_by_name
           FROM complaints cmp
           JOIN users cu ON cu.id = cmp.candidate_id
           LEFT JOIN candidate_profiles cp ON cp.user_id = cu.id
           LEFT JOIN users ru ON ru.id = cmp.recruiter_id
           LEFT JOIN users resu ON resu.id = cmp.resolved_by
           WHERE cmp.candidate_id = ?
           ORDER BY cmp.created_at DESC`
        )
        .all(actor.id);
    } else {
      // Recruiters see ONLY complaints pertaining to their assigned candidates where visible_to_recruiter = 1
      rows = db
        .prepare(
          `SELECT cmp.*,
                  cu.full_name as candidate_name, cu.email as candidate_email, cu.avatar_url as candidate_avatar,
                  cp.technology as candidate_technology,
                  ru.full_name as recruiter_name, ru.email as recruiter_email,
                  resu.full_name as resolved_by_name
           FROM complaints cmp
           JOIN users cu ON cu.id = cmp.candidate_id
           LEFT JOIN candidate_profiles cp ON cp.user_id = cu.id
           LEFT JOIN users ru ON ru.id = cmp.recruiter_id
           LEFT JOIN users resu ON resu.id = cmp.resolved_by
           WHERE cmp.recruiter_id = ? AND cmp.visible_to_recruiter = 1
           ORDER BY CASE cmp.status WHEN 'open' THEN 1 WHEN 'in_review' THEN 2 ELSE 3 END, cmp.created_at DESC`
        )
        .all(actor.id);
    }

    const filtered = statusFilter ? rows.filter((r) => r.status === statusFilter) : rows;
    const openCount = rows.filter((r) => r.status === 'open' || r.status === 'in_review').length;
    res.json({ complaints: filtered, openCount });
  });

  router.get('/complaints/:id', (req: AuthedRequest, res) => {
    const db = getDb();
    const actor = req.actor!;
    const cmp = db
      .prepare(
        `SELECT cmp.*,
                cu.full_name as candidate_name, ru.full_name as recruiter_name
         FROM complaints cmp
         JOIN users cu ON cu.id = cmp.candidate_id
         LEFT JOIN users ru ON ru.id = cmp.recruiter_id
         WHERE cmp.id = ?`
      )
      .get(req.params.id) as any;

    if (!cmp) {
      res.status(404).json({ error: 'Complaint not found.' });
      return;
    }

    if (
      !canAccessComplaint(actor, {
        candidateId: cmp.candidate_id,
        recruiterId: cmp.recruiter_id,
        visibleToRecruiter: cmp.visible_to_recruiter === 1,
      })
    ) {
      res.status(403).json({ error: 'Forbidden: you do not have access to this complaint.' });
      return;
    }

    res.json({ complaint: cmp });
  });

  router.post('/complaints', (req: AuthedRequest, res) => {
    const db = getDb();
    const actor = req.actor!;
    if (!canSubmitComplaint(actor)) {
      res.status(403).json({ error: 'Only candidates can submit candidate complaints.' });
      return;
    }

    const category = String(req.body?.category || 'communication').trim();
    const priority = String(req.body?.priority || 'normal').trim();
    const subject = String(req.body?.subject || '').trim();
    const description = String(req.body?.description || '').trim();

    if (!VALID_COMPLAINT_CATEGORIES.has(category)) {
      res.status(400).json({ error: 'Invalid complaint category.' });
      return;
    }
    if (!VALID_COMPLAINT_PRIORITIES.has(priority)) {
      res.status(400).json({ error: 'Invalid complaint priority.' });
      return;
    }
    if (!subject || subject.length > 160) {
      res.status(400).json({ error: 'Subject is required (max 160 characters).' });
      return;
    }
    if (!description || description.length < 10 || description.length > 4000) {
      res.status(400).json({ error: 'Please provide a clear description (10–4000 characters).' });
      return;
    }

    // Bind candidate_id strictly to authenticated actor and resolve active assigned recruiter server-side
    const assignedRecruiterId = getActiveAssignedRecruiterId(db, actor.id);
    const complaintId = newId('cmp');

    const teamLeads = db
      .prepare(`SELECT id FROM users WHERE role = 'team_lead' AND is_active = 1`)
      .all() as Array<{ id: string }>;

    db.transaction(() => {
      db.prepare(
        `INSERT INTO complaints (
           id, candidate_id, recruiter_id, category, priority, subject, description,
           status, visible_to_recruiter
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'open', 1)`
      ).run(complaintId, actor.id, assignedRecruiterId, category, priority, subject, description);

      // Route complaint directly to Team Lead(s)
      for (const tl of teamLeads) {
        createNotification(
          db,
          tl.id,
          'complaint',
          `New Candidate Complaint (${priority.toUpperCase()}): ${actor.fullName}`,
          subject,
          'complaints'
        );
      }

      writeAuditLog(
        db,
        actor.id,
        'complaint.submitted',
        'complaint',
        complaintId,
        { category, priority, assignedRecruiterId },
        getClientIp(req)
      );
    })();

    const created = db
      .prepare(
        `SELECT cmp.*,
                cu.full_name as candidate_name, cu.email as candidate_email, cu.avatar_url as candidate_avatar,
                cp.technology as candidate_technology,
                ru.full_name as recruiter_name, ru.email as recruiter_email
         FROM complaints cmp
         JOIN users cu ON cu.id = cmp.candidate_id
         LEFT JOIN candidate_profiles cp ON cp.user_id = cu.id
         LEFT JOIN users ru ON ru.id = cmp.recruiter_id
         WHERE cmp.id = ?`
      )
      .get(complaintId);

    // Push live alert directly to Team Leads
    realtimeHub.sendToTeamLeads({
      type: 'complaint:new',
      complaint: created,
    });
    realtimeHub.sendToTeamLeads({ type: 'notification:new' });

    res.status(201).json({ complaint: created });
  });

  router.patch('/complaints/:id', (req: AuthedRequest, res) => {
    const db = getDb();
    const actor = req.actor!;
    if (!canManageComplaint(actor)) {
      res.status(403).json({ error: 'Forbidden: only Team Leads can review or update complaints.' });
      return;
    }

    const cmp = db.prepare('SELECT * FROM complaints WHERE id = ?').get(req.params.id) as any;
    if (!cmp) {
      res.status(404).json({ error: 'Complaint not found.' });
      return;
    }

    const { status, teamLeadResponse, visibleToRecruiter } = req.body || {};
    if (status !== undefined && !VALID_COMPLAINT_STATUSES.has(String(status))) {
      res.status(400).json({ error: 'Invalid complaint status.' });
      return;
    }
    if (teamLeadResponse !== undefined && String(teamLeadResponse).length > 4000) {
      res.status(400).json({ error: 'Response exceeds maximum length (4000 characters).' });
      return;
    }

    const nextStatus = status ? String(status) : cmp.status;
    const nextResponse =
      teamLeadResponse !== undefined ? String(teamLeadResponse).trim() : cmp.team_lead_response;
    const nextVisible =
      visibleToRecruiter !== undefined ? (visibleToRecruiter ? 1 : 0) : cmp.visible_to_recruiter;
    const isResolvedNow = nextStatus === ComplaintStatus.Resolved || nextStatus === ComplaintStatus.Dismissed;

    db.transaction(() => {
      db.prepare(
        `UPDATE complaints SET
           status = ?,
           team_lead_response = ?,
           visible_to_recruiter = ?,
           resolved_by = CASE WHEN ? = 1 THEN ? ELSE resolved_by END,
           resolved_at = CASE WHEN ? = 1 THEN COALESCE(resolved_at, datetime('now')) ELSE NULL END,
           updated_at = datetime('now')
         WHERE id = ?`
      ).run(
        nextStatus,
        nextResponse,
        nextVisible,
        isResolvedNow ? 1 : 0,
        actor.id,
        isResolvedNow ? 1 : 0,
        cmp.id
      );

      createNotification(
        db,
        cmp.candidate_id,
        'complaint',
        `Complaint Updated (${nextStatus.replace('_', ' ')})`,
        nextResponse
          ? `${actor.fullName} responded: ${nextResponse.slice(0, 100)}`
          : `Team Lead updated your complaint "${cmp.subject}" to ${nextStatus.replace('_', ' ')}.`,
        'complaints'
      );

      writeAuditLog(
        db,
        actor.id,
        'complaint.updated',
        'complaint',
        cmp.id,
        { status: nextStatus, visibleToRecruiter: nextVisible === 1 },
        getClientIp(req)
      );
    })();

    const updated = db
      .prepare(
        `SELECT cmp.*,
                cu.full_name as candidate_name, cu.email as candidate_email, cu.avatar_url as candidate_avatar,
                cp.technology as candidate_technology,
                ru.full_name as recruiter_name, ru.email as recruiter_email,
                resu.full_name as resolved_by_name
         FROM complaints cmp
         JOIN users cu ON cu.id = cmp.candidate_id
         LEFT JOIN candidate_profiles cp ON cp.user_id = cu.id
         LEFT JOIN users ru ON ru.id = cmp.recruiter_id
         LEFT JOIN users resu ON resu.id = cmp.resolved_by
         WHERE cmp.id = ?`
      )
      .get(cmp.id);

    const notifyIds = [cmp.candidate_id];
    if (nextVisible === 1 && cmp.recruiter_id) {
      notifyIds.push(cmp.recruiter_id);
    }
    realtimeHub.sendToUsers(notifyIds, { type: 'complaint:updated', complaint: updated });
    realtimeHub.sendToUsers([cmp.candidate_id], { type: 'notification:new' });

    res.json({ complaint: updated });
  });

  return router;
}
