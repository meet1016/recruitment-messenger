export const US_TIMEZONES = [
  { id: 'America/New_York', label: 'Eastern Time (ET — New York)' },
  { id: 'America/Chicago', label: 'Central Time (CT — Chicago)' },
  { id: 'America/Denver', label: 'Mountain Time (MT — Denver)' },
  { id: 'America/Phoenix', label: 'Mountain No-DST (MST — Phoenix)' },
  { id: 'America/Los_Angeles', label: 'Pacific Time (PT — Los Angeles)' },
  { id: 'America/Anchorage', label: 'Alaska Time (AKT — Anchorage)' },
  { id: 'Pacific/Honolulu', label: 'Hawaii Time (HST — Honolulu)' },
] as const;

export const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

export function formatDateTimeInTz(isoUtc: string, timeZone: string): string {
  if (!isoUtc) return '—';
  const d = new Date(isoUtc.endsWith('Z') || isoUtc.includes('+') ? isoUtc : `${isoUtc.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return isoUtc;
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(d);
}

export function formatTimeOnly(isoUtc: string, timeZone: string): string {
  if (!isoUtc) return '';
  const d = new Date(isoUtc.endsWith('Z') || isoUtc.includes('+') ? isoUtc : `${isoUtc.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

export function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function todayIsoInTz(timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
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

export function availabilityMeta(status: string): { label: string; textClass: string } {
  switch (status) {
    case 'available':
      return { label: 'Available', textClass: 'text-emerald-700 font-medium' };
    case 'partially_available':
      return { label: 'Partially Available', textClass: 'text-amber-700 font-medium' };
    default:
      return { label: 'Unavailable', textClass: 'text-red-700 font-medium' };
  }
}

export function interviewStatusMeta(status: string): { label: string; textClass: string } {
  switch (status) {
    case 'confirmed':
      return { label: 'Confirmed', textClass: 'text-emerald-700 font-medium' };
    case 'requested':
      return { label: 'Pending Confirmation', textClass: 'text-amber-700 font-medium' };
    case 'reschedule_requested':
      return { label: 'Reschedule Requested', textClass: 'text-amber-700 font-medium' };
    case 'completed':
      return { label: 'Completed', textClass: 'text-slate-700 font-medium' };
    case 'cancelled':
      return { label: 'Cancelled', textClass: 'text-red-700 font-medium' };
    case 'no_show':
      return { label: 'No-Show', textClass: 'text-red-700 font-medium' };
    default:
      return { label: status, textClass: 'text-slate-600' };
  }
}

export function roleLabel(role: string): string {
  if (role === 'team_lead') return 'Team Lead';
  if (role === 'recruiter') return 'Recruiter';
  return 'Candidate';
}
