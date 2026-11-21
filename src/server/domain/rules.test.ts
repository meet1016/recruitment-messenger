import test from 'node:test';
import assert from 'node:assert/strict';
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
  resolveAvailabilityForDate,
  sanitizeConversationPayloadForRole,
  signDownloadToken,
  validateUploadedFile,
  verifyDownloadToken,
  verifyPassword,
} from './rules';
import {
  AuthActor,
  AvailabilityStatus,
  ConversationThreadType,
  DailyException,
  InterviewInterval,
  InterviewStatus,
  UserRole,
  WeeklyRule,
} from './types';

const teamLead: AuthActor = {
  id: 'usr_lead_1',
  role: UserRole.TeamLead,
  email: 'sarah@benchlink.io',
  fullName: 'Sarah Jenkins',
  isActive: true,
};

const recruiterA: AuthActor = {
  id: 'usr_rec_a',
  role: UserRole.Recruiter,
  email: 'marcus@benchlink.io',
  fullName: 'Marcus Vance',
  isActive: true,
};

const recruiterB: AuthActor = {
  id: 'usr_rec_b',
  role: UserRole.Recruiter,
  email: 'priya@benchlink.io',
  fullName: 'Priya Nair',
  isActive: true,
};

const candidateA: AuthActor = {
  id: 'usr_cand_a',
  role: UserRole.Candidate,
  email: 'arjun@devmail.com',
  fullName: 'Arjun Mehta',
  isActive: true,
};

const candidateB: AuthActor = {
  id: 'usr_cand_b',
  role: UserRole.Candidate,
  email: 'elena@devmail.com',
  fullName: 'Elena Rostova',
  isActive: true,
};

test('RBAC: Candidate A cannot access Candidate B conversation or profile', () => {
  assert.equal(canAccessCandidate(candidateA, candidateA.id, recruiterA.id), true);
  assert.equal(canAccessCandidate(candidateA, candidateB.id, recruiterB.id), false);
  assert.equal(
    canAccessConversation(candidateA, { candidateId: candidateB.id, recruiterId: recruiterB.id }, recruiterB.id),
    false
  );
});

test('RBAC: Recruiter A cannot access Recruiter B assigned candidates', () => {
  assert.equal(canAccessCandidate(recruiterA, candidateA.id, recruiterA.id), true);
  assert.equal(canAccessCandidate(recruiterA, candidateB.id, recruiterB.id), false);
  assert.equal(
    canAccessConversation(recruiterA, { candidateId: candidateB.id, recruiterId: recruiterB.id }, recruiterB.id),
    false
  );
});

test('RBAC: Team Lead can access all candidates and conversations', () => {
  assert.equal(canAccessCandidate(teamLead, candidateA.id, recruiterA.id), true);
  assert.equal(canAccessCandidate(teamLead, candidateB.id, recruiterB.id), true);
  assert.equal(
    canAccessConversation(teamLead, { candidateId: candidateB.id, recruiterId: recruiterB.id }, recruiterB.id),
    true
  );
});

test('RBAC: Reassigning candidate revokes previous recruiter access immediately', () => {
  // After reassignment of candidateA from recruiterA to recruiterB
  const newAssignedRecruiter = recruiterB.id;
  assert.equal(canAccessCandidate(recruiterA, candidateA.id, newAssignedRecruiter), false);
  assert.equal(canAccessCandidate(recruiterB, candidateA.id, newAssignedRecruiter), true);
  assert.equal(
    canAccessConversation(
      recruiterA,
      { candidateId: candidateA.id, recruiterId: recruiterA.id },
      newAssignedRecruiter
    ),
    false
  );
});

test('Internal notes are strictly blocked from candidates and stripped from candidate payloads', () => {
  assert.equal(canAccessInternalNotes(candidateA, recruiterA.id), false);
  assert.equal(canAccessInternalNotes(recruiterA, recruiterA.id), true);
  assert.equal(canAccessInternalNotes(recruiterB, recruiterA.id), false);
  assert.equal(canAccessInternalNotes(teamLead, recruiterA.id), true);

  const sanitized = sanitizeConversationPayloadForRole(candidateA, {
    messages: [{ id: 'm1', body: 'Hello' }],
    internalNotes: [{ id: 'n1', content: 'Private rate negotiation note' }],
  });
  assert.equal('internalNotes' in sanitized, false);
});

test('Availability: Daily custom exception overrides weekly recurring schedule', () => {
  const weekly: WeeklyRule[] = [
    {
      dayOfWeek: 1, // Monday
      isAvailable: true,
      slots: [
        { start: '09:00', end: '12:00' },
        { start: '14:00', end: '18:00' },
      ],
    },
  ];
  const exceptions: DailyException[] = [
    {
      date: '2026-11-23', // Monday
      isUnavailable: true,
      slots: [],
      note: 'Medical appointment',
    },
    {
      date: '2026-11-30', // Monday
      isUnavailable: false,
      slots: [{ start: '15:00', end: '17:00' }],
      note: 'Afternoon only',
    },
  ];

  // Normal Monday (2026-11-16) uses weekly recurring
  const normalMonday = resolveAvailabilityForDate('2026-11-16', 'America/New_York', weekly, exceptions);
  assert.equal(normalMonday.source, 'weekly_recurring');
  assert.equal(normalMonday.status, AvailabilityStatus.Available);
  assert.equal(normalMonday.slots.length, 2);

  // Full-day unavailable override
  const blockedMonday = resolveAvailabilityForDate('2026-11-23', 'America/New_York', weekly, exceptions);
  assert.equal(blockedMonday.source, 'custom_exception');
  assert.equal(blockedMonday.status, AvailabilityStatus.Unavailable);
  assert.equal(blockedMonday.slots.length, 0);

  // Partial custom override (< 4 hours => partially_available)
  const partialMonday = resolveAvailabilityForDate('2026-11-30', 'America/New_York', weekly, exceptions);
  assert.equal(partialMonday.source, 'custom_exception');
  assert.equal(partialMonday.status, AvailabilityStatus.PartiallyAvailable);
  assert.equal(partialMonday.slots[0].start, '15:00');
});

test('Timezone conversion handles US EST/PST and EDT/PDT across DST accurately', () => {
  // Winter (standard time): 12:00 EST -> 09:00 PST (3 hours difference)
  const winter = convertSlotBetweenTimezones(
    '2026-11-23',
    { start: '12:00', end: '14:00' },
    'America/New_York',
    'America/Los_Angeles'
  );
  assert.equal(winter.startLabel, '9:00 AM');
  assert.equal(winter.endLabel, '11:00 AM');
  assert.equal(winter.tzAbbr, 'PST');

  // Summer (daylight saving): 12:00 EDT -> 09:00 PDT, and Phoenix stays MST (09:00)
  const summerPhoenix = convertSlotBetweenTimezones(
    '2026-07-15',
    { start: '12:00', end: '13:00' },
    'America/New_York',
    'America/Phoenix'
  );
  assert.equal(summerPhoenix.startLabel, '9:00 AM');
  assert.equal(summerPhoenix.tzAbbr, 'MST');
});

test('Interview conflict detection prevents overlapping confirmed bookings and ignores cancelled', () => {
  const existing: InterviewInterval[] = [
    {
      id: 'iv_1',
      candidateId: candidateA.id,
      recruiterId: recruiterA.id,
      startUtc: '2026-11-24T15:00:00.000Z',
      endUtc: '2026-11-24T16:00:00.000Z',
      status: InterviewStatus.Confirmed,
    },
    {
      id: 'iv_2',
      candidateId: candidateA.id,
      recruiterId: recruiterA.id,
      startUtc: '2026-11-24T17:00:00.000Z',
      endUtc: '2026-11-24T18:00:00.000Z',
      status: InterviewStatus.Cancelled,
    },
  ];

  // Overlaps iv_1
  const overlap = hasInterviewConflict(
    existing,
    candidateA.id,
    recruiterA.id,
    '2026-11-24T15:30:00.000Z',
    '2026-11-24T16:30:00.000Z'
  );
  assert.equal(overlap.hasConflict, true);

  // Adjacent slot (16:00 - 17:00) does NOT overlap
  const adjacent = hasInterviewConflict(
    existing,
    candidateA.id,
    recruiterA.id,
    '2026-11-24T16:00:00.000Z',
    '2026-11-24T17:00:00.000Z'
  );
  assert.equal(adjacent.hasConflict, false);

  // Overlaps cancelled iv_2 -> allowed
  const overCancelled = hasInterviewConflict(
    existing,
    candidateA.id,
    recruiterA.id,
    '2026-11-24T17:15:00.000Z',
    '2026-11-24T17:45:00.000Z'
  );
  assert.equal(overCancelled.hasConflict, false);
});

test('Private attachment authorization and short-lived HMAC signed URLs', () => {
  const attachment = { candidateId: candidateA.id, uploadedBy: candidateA.id };
  assert.equal(canDownloadAttachment(candidateB, attachment, recruiterA.id), false);
  assert.equal(canDownloadAttachment(recruiterB, attachment, recruiterA.id), false);
  assert.equal(canDownloadAttachment(recruiterA, attachment, recruiterA.id), true);
  assert.equal(canDownloadAttachment(teamLead, attachment, recruiterA.id), true);

  const secret = 'test-signing-secret';
  const now = 1_700_000_000_000;
  const token = signDownloadToken({ attachmentId: 'att_1', userId: recruiterA.id, exp: now + 60_000 }, secret);

  const ok = verifyDownloadToken(token, secret, now + 10_000);
  assert.equal(ok.valid, true);
  assert.equal(ok.payload?.attachmentId, 'att_1');

  const expired = verifyDownloadToken(token, secret, now + 120_000);
  assert.equal(expired.valid, false);

  const tampered = verifyDownloadToken(`${token}x`, secret, now + 10_000);
  assert.equal(tampered.valid, false);
});

test('Password hashing, upload validation, and login rate limiting', () => {
  const hash = hashPassword('StrongPass!2026');
  assert.equal(verifyPassword('StrongPass!2026', hash), true);
  assert.equal(verifyPassword('WrongPass!2026', hash), false);

  assert.equal(
    validateUploadedFile({ originalName: 'Arjun_Resume_v3.pdf', mimeType: 'application/pdf', sizeBytes: 120_000 }).valid,
    true
  );
  assert.equal(
    validateUploadedFile({ originalName: 'script.exe', mimeType: 'application/x-msdownload', sizeBytes: 1000 }).valid,
    false
  );

  const limiter = createRateLimiter(3, 60_000);
  assert.equal(limiter.check('ip:1').allowed, true);
  limiter.recordFailure('ip:1');
  limiter.recordFailure('ip:1');
  limiter.recordFailure('ip:1');
  assert.equal(limiter.check('ip:1').allowed, false);
  limiter.reset('ip:1');
  assert.equal(limiter.check('ip:1').allowed, true);
});

test('Complaints RBAC: submitted by Candidate directly to Team Lead, visible ONLY to assigned Recruiter when enabled', () => {
  assert.equal(canSubmitComplaint(candidateA), true);
  assert.equal(canSubmitComplaint(recruiterA), false);
  assert.equal(canSubmitComplaint(teamLead), false);

  assert.equal(canManageComplaint(teamLead), true);
  assert.equal(canManageComplaint(recruiterA), false);
  assert.equal(canManageComplaint(candidateA), false);

  const sharedComplaint = {
    candidateId: candidateA.id,
    recruiterId: recruiterA.id,
    visibleToRecruiter: true,
  };
  assert.equal(canAccessComplaint(teamLead, sharedComplaint), true);
  assert.equal(canAccessComplaint(candidateA, sharedComplaint), true);
  assert.equal(canAccessComplaint(candidateB, sharedComplaint), false);
  assert.equal(canAccessComplaint(recruiterA, sharedComplaint), true);
  assert.equal(canAccessComplaint(recruiterB, sharedComplaint), false);

  const teamLeadOnlyComplaint = {
    candidateId: candidateA.id,
    recruiterId: recruiterA.id,
    visibleToRecruiter: false,
  };
  assert.equal(canAccessComplaint(teamLead, teamLeadOnlyComplaint), true);
  assert.equal(canAccessComplaint(candidateA, teamLeadOnlyComplaint), true);
  assert.equal(canAccessComplaint(recruiterA, teamLeadOnlyComplaint), false);
});

test('Team Lead direct chat RBAC isolates TeamLead<->Candidate and TeamLead<->Recruiter threads', () => {
  // Team Lead <-> Candidate direct chat
  const tlCandThread = {
    candidateId: candidateA.id,
    recruiterId: teamLead.id,
    threadType: ConversationThreadType.TeamLeadCandidate,
  };
  assert.equal(canAccessConversation(teamLead, tlCandThread, recruiterA.id), true);
  assert.equal(canAccessConversation(candidateA, tlCandThread, recruiterA.id), true);
  assert.equal(canAccessConversation(candidateB, tlCandThread, recruiterB.id), false);
  assert.equal(canAccessConversation(recruiterA, tlCandThread, recruiterA.id), false);

  // Team Lead <-> Recruiter direct chat
  const tlRecThread = {
    candidateId: teamLead.id,
    recruiterId: recruiterA.id,
    threadType: ConversationThreadType.TeamLeadRecruiter,
  };
  assert.equal(canAccessConversation(teamLead, tlRecThread, null), true);
  assert.equal(canAccessConversation(recruiterA, tlRecThread, null), true);
  assert.equal(canAccessConversation(recruiterB, tlRecThread, null), false);
  assert.equal(canAccessConversation(candidateA, tlRecThread, recruiterA.id), false);

  // Direct chat initiation pairs
  assert.equal(canStartDirectTeamLeadChat(UserRole.TeamLead, UserRole.Candidate), true);
  assert.equal(canStartDirectTeamLeadChat(UserRole.TeamLead, UserRole.Recruiter), true);
  assert.equal(canStartDirectTeamLeadChat(UserRole.Candidate, UserRole.TeamLead), true);
  assert.equal(canStartDirectTeamLeadChat(UserRole.Recruiter, UserRole.TeamLead), true);
  assert.equal(canStartDirectTeamLeadChat(UserRole.Candidate, UserRole.Candidate), false);
  assert.equal(canStartDirectTeamLeadChat(UserRole.Candidate, UserRole.Recruiter), false);
});
