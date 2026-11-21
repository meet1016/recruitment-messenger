export enum UserRole {
  Candidate = 'candidate',
  Recruiter = 'recruiter',
  TeamLead = 'team_lead',
}

export enum InterviewType {
  Phone = 'phone',
  Video = 'video',
  InPerson = 'in_person',
}

export enum InterviewStatus {
  Requested = 'requested',
  Confirmed = 'confirmed',
  RescheduleRequested = 'reschedule_requested',
  Completed = 'completed',
  Cancelled = 'cancelled',
  NoShow = 'no_show',
}

export enum AvailabilityStatus {
  Available = 'available',
  PartiallyAvailable = 'partially_available',
  Unavailable = 'unavailable',
}

export enum CallType {
  Audio = 'audio',
  Video = 'video',
}

export enum CallStatus {
  Ringing = 'ringing',
  Connected = 'connected',
  Ended = 'ended',
  Missed = 'missed',
  Declined = 'declined',
}

export enum MessageType {
  Text = 'text',
  Image = 'image',
  Document = 'document',
  VoiceNote = 'voice_note',
  CallEvent = 'call_event',
}

export enum ComplaintCategory {
  Communication = 'communication',
  Scheduling = 'scheduling',
  Conduct = 'conduct',
  RateTerms = 'rate_terms',
  Other = 'other',
}

export enum ComplaintPriority {
  Low = 'low',
  Normal = 'normal',
  High = 'high',
  Urgent = 'urgent',
}

export enum ComplaintStatus {
  Open = 'open',
  InReview = 'in_review',
  Resolved = 'resolved',
  Dismissed = 'dismissed',
}

export enum ConversationThreadType {
  CandidateRecruiter = 'candidate_recruiter',
  TeamLeadCandidate = 'team_lead_candidate',
  TeamLeadRecruiter = 'team_lead_recruiter',
}

export interface ComplaintAccessTarget {
  candidateId: string;
  recruiterId: string | null;
  visibleToRecruiter: boolean;
}

export interface TimeSlot {
  start: string; // HH:MM (24-hour)
  end: string;   // HH:MM (24-hour)
}

export interface WeeklyRule {
  dayOfWeek: number; // 0 = Sunday ... 6 = Saturday
  isAvailable: boolean;
  slots: TimeSlot[];
}

export interface DailyException {
  date: string; // YYYY-MM-DD in candidate timezone
  isUnavailable: boolean;
  slots: TimeSlot[];
  note?: string;
}

export interface ResolvedDayAvailability {
  date: string;
  timezone: string;
  source: 'custom_exception' | 'weekly_recurring';
  status: AvailabilityStatus;
  slots: TimeSlot[];
  note?: string;
}

export interface AuthActor {
  id: string;
  role: UserRole;
  email: string;
  fullName: string;
  isActive: boolean;
}

export interface AssignmentRecord {
  id: string;
  candidateId: string;
  recruiterId: string;
  isActive: boolean;
  assignedAt: string;
  unassignedAt: string | null;
  assignedBy: string;
  reason: string | null;
}

export interface InterviewInterval {
  id: string;
  candidateId: string;
  recruiterId: string;
  startUtc: string;
  endUtc: string;
  status: InterviewStatus;
}

export const US_TIMEZONES = [
  { id: 'America/New_York', label: 'Eastern Time (ET — New York)' },
  { id: 'America/Chicago', label: 'Central Time (CT — Chicago)' },
  { id: 'America/Denver', label: 'Mountain Time (MT — Denver)' },
  { id: 'America/Phoenix', label: 'Mountain No-DST (MST — Phoenix)' },
  { id: 'America/Los_Angeles', label: 'Pacific Time (PT — Los Angeles)' },
  { id: 'America/Anchorage', label: 'Alaska Time (AKT — Anchorage)' },
  { id: 'Pacific/Honolulu', label: 'Hawaii Time (HST — Honolulu)' },
] as const;

export const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'audio/webm',
  'audio/ogg',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
]);

export const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  '.pdf',
  '.doc',
  '.docx',
  '.txt',
  '.png',
  '.jpg',
  '.jpeg',
  '.webp',
  '.gif',
  '.webm',
  '.ogg',
  '.mp3',
  '.m4a',
  '.wav',
]);

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
