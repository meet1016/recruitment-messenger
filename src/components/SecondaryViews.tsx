import React, { useEffect, useState } from 'react';
import {
  Bell,
  Check,
  CheckCircle2,
  Phone,
  PhoneMissed,
  Plus,
  Search,
  ShieldCheck,
  Video,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { apiRequest } from '../lib/api';
import { LoggedInUser } from './LoginView';
import { US_TIMEZONES, formatDateTimeInTz, formatDuration } from '../lib/format';

// ============================================================================
// CALL HISTORY & METADATA VIEW
// ============================================================================

export function CallsView({ user }: { user: LoggedInUser }) {
  const [calls, setCalls] = useState<any[]>([]);
  const [config, setConfig] = useState<any>(null);

  useEffect(() => {
    apiRequest<{ calls: any[]; config: any }>('/api/calls')
      .then((res) => {
        setCalls(res.calls);
        setConfig(res.config);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h2 className="font-display text-xl font-semibold text-slate-900">
          {user.role === 'team_lead' ? 'Call Metadata & History' : 'Voice & Video Call History'}
        </h2>
        <p className="text-sm text-slate-600 mt-0.5">
          Track completed audio/video sessions, call durations, missed calls, and recorded outcomes.
        </p>
      </div>

      {config && (
        <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-start gap-3 text-xs text-slate-600">
          <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
          <div>
            <div className="font-medium text-slate-900">
              Calling Engine: {config.livekitConfigured ? 'LiveKit Managed WebRTC SFU' : 'Built-in 1-to-1 WebRTC (WebSocket Signaling)'}
            </div>
            <div className="mt-0.5">{config.consentNotice}</div>
          </div>
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500 text-left">
                <th className="px-5 py-3 font-medium">Type</th>
                <th className="px-5 py-3 font-medium">Participants</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">Started</th>
                <th className="px-5 py-3 font-medium text-right">Duration</th>
                <th className="px-5 py-3 font-medium">Outcome</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {calls.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3.5 text-xs text-slate-700 capitalize whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      {c.status === 'missed' ? (
                        <PhoneMissed className="w-3.5 h-3.5 text-red-600" />
                      ) : c.call_type === 'video' ? (
                        <Video className="w-3.5 h-3.5 text-blue-600" />
                      ) : (
                        <Phone className="w-3.5 h-3.5 text-slate-500" />
                      )}
                      {c.call_type}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-slate-900 font-medium">
                    {c.caller_name} → {c.callee_name}
                  </td>
                  <td className="px-5 py-3.5 text-xs capitalize">
                    <span
                      className={
                        c.status === 'missed' || c.status === 'declined'
                          ? 'text-red-700 font-medium'
                          : c.status === 'ended'
                          ? 'text-emerald-700 font-medium'
                          : 'text-amber-700 font-medium'
                      }
                    >
                      {c.status}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-xs font-mono tabular-nums text-slate-500 whitespace-nowrap">
                    {formatDateTimeInTz(c.started_at, user.timezone)}
                  </td>
                  <td className="px-5 py-3.5 text-right text-xs font-mono tabular-nums text-slate-700">
                    {formatDuration(c.duration_sec)}
                  </td>
                  <td className="px-5 py-3.5 text-xs text-slate-600">{c.outcome || '—'}</td>
                </tr>
              ))}
              {calls.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-8 text-center text-sm text-slate-500">
                    No calls logged yet. Start an audio or video call from Messages.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// RECRUITER PERSONAL REMINDERS VIEW
// ============================================================================

export function RemindersView({ user }: { user: LoggedInUser }) {
  const [reminders, setReminders] = useState<any[]>([]);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [title, setTitle] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [candidateId, setCandidateId] = useState('');

  const load = async () => {
    const [rRes, cRes] = await Promise.all([
      apiRequest<{ reminders: any[] }>('/api/reminders'),
      apiRequest<{ candidates: any[] }>('/api/candidates'),
    ]);
    setReminders(rRes.reminders);
    setCandidates(cRes.candidates);
  };

  useEffect(() => {
    load().catch(() => {});
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !dueAt) return;
    await apiRequest('/api/reminders', {
      method: 'POST',
      body: { title: title.trim(), dueAt: new Date(dueAt).toISOString(), candidateId: candidateId || null },
    });
    setTitle('');
    setDueAt('');
    await load();
  };

  const toggleDone = async (r: any) => {
    await apiRequest(`/api/reminders/${r.id}`, {
      method: 'PATCH',
      body: { isCompleted: r.is_completed !== 1 },
    });
    await load();
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="font-display text-xl font-semibold text-slate-900">Personal Recruiter Reminders</h2>
        <p className="text-sm text-slate-600 mt-0.5">Track candidate callbacks, interview prep follow-ups, and check-ins.</p>
      </div>

      <form onSubmit={handleCreate} className="bg-white border border-slate-200 rounded-xl p-5 grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
        <div className="md:col-span-2">
          <label htmlFor="rem-title" className="block text-xs font-medium text-slate-700 mb-1">Reminder</label>
          <input
            id="rem-title"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., Confirm interview panel link with candidate"
            className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
          />
        </div>
        <div>
          <label htmlFor="rem-due" className="block text-xs font-medium text-slate-700 mb-1">Due Date & Time</label>
          <input
            id="rem-due"
            type="datetime-local"
            required
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            className="w-full px-2.5 py-2 text-xs font-mono rounded-lg border border-slate-300"
          />
        </div>
        <div>
          <label htmlFor="rem-cand" className="block text-xs font-medium text-slate-700 mb-1">Candidate (Optional)</label>
          <select
            id="rem-cand"
            value={candidateId}
            onChange={(e) => setCandidateId(e.target.value)}
            className="w-full px-2.5 py-2 text-xs rounded-lg border border-slate-300 bg-white"
          >
            <option value="">General</option>
            {candidates.map((c) => <option key={c.id} value={c.id}>{c.full_name}</option>)}
          </select>
        </div>
        <div className="md:col-span-4 flex justify-end">
          <button type="submit" className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 cursor-pointer">
            <Plus className="w-4 h-4" /> Add Reminder
          </button>
        </div>
      </form>

      <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
        {reminders.map((r) => (
          <div key={r.id} className="p-4 flex items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <button
                type="button"
                onClick={() => toggleDone(r)}
                aria-label={r.is_completed ? `Mark "${r.title}" incomplete` : `Mark "${r.title}" complete`}
                className={`mt-0.5 w-5 h-5 rounded border flex items-center justify-center cursor-pointer ${
                  r.is_completed ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-slate-300 text-transparent hover:border-blue-600'
                }`}
              >
                <Check className="w-3.5 h-3.5" />
              </button>
              <div>
                <div className={`text-sm font-medium ${r.is_completed ? 'line-through text-slate-400' : 'text-slate-900'}`}>
                  {r.title}
                </div>
                <div className="text-xs text-slate-500 font-mono tabular-nums mt-0.5">
                  Due {formatDateTimeInTz(r.due_at, user.timezone)}
                  {r.candidate_name && ` · ${r.candidate_name}`}
                </div>
              </div>
            </div>
          </div>
        ))}
        {reminders.length === 0 && <div className="p-8 text-center text-sm text-slate-500">No reminders created yet.</div>}
      </div>
    </div>
  );
}

// ============================================================================
// NOTIFICATIONS & PREFERENCES VIEW
// ============================================================================

export function NotificationsView({
  user,
  onNavigate,
  onReadAll,
}: {
  user: LoggedInUser;
  onNavigate: (tab: string) => void;
  onReadAll: () => void;
}) {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [prefs, setPrefs] = useState<any>({
    browser_push: 1,
    email_alerts: 1,
    message_alerts: 1,
    interview_alerts: 1,
    availability_alerts: 1,
    call_alerts: 1,
  });
  const [savedMsg, setSavedMsg] = useState('');

  const load = async () => {
    const res = await apiRequest<{ notifications: any[]; preferences: any }>('/api/notifications');
    setNotifications(res.notifications);
    if (res.preferences) setPrefs(res.preferences);
  };

  useEffect(() => {
    load().catch(() => {});
  }, []);

  const handleMarkAllRead = async () => {
    await apiRequest('/api/notifications/read-all', { method: 'POST' });
    await load();
    onReadAll();
  };

  const handleTogglePref = async (key: string) => {
    const updated = { ...prefs, [key]: prefs[key] ? 0 : 1 };
    setPrefs(updated);
    await apiRequest('/api/notification-preferences', { method: 'PUT', body: updated });
    setSavedMsg('Notification preferences updated.');
    setTimeout(() => setSavedMsg(''), 2500);
  };

  const requestBrowserNotifications = async () => {
    if ('Notification' in window) {
      await Notification.requestPermission();
      setSavedMsg(`Browser notification permission: ${Notification.permission}`);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 max-w-6xl">
      <div className="lg:col-span-2 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-display text-xl font-semibold text-slate-900">Notification Center</h2>
            <p className="text-sm text-slate-600 mt-0.5">Real-time alerts for messages, interviews, calls, and availability changes.</p>
          </div>
          <button
            type="button"
            onClick={handleMarkAllRead}
            className="px-3.5 py-2 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            Mark All Read
          </button>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
          {notifications.map((n) => (
            <div key={n.id} className={`p-4 flex items-start justify-between gap-4 ${n.is_read ? '' : 'bg-blue-50/40'}`}>
              <div className="flex items-start gap-3">
                <Bell className={`w-4 h-4 mt-0.5 shrink-0 ${n.is_read ? 'text-slate-400' : 'text-blue-600'}`} />
                <div>
                  <div className="text-sm font-medium text-slate-900">{n.title}</div>
                  <p className="text-xs text-slate-600 mt-0.5">{n.body}</p>
                  <div className="text-[11px] font-mono tabular-nums text-slate-400 mt-1">
                    {formatDateTimeInTz(n.created_at, user.timezone)}
                  </div>
                </div>
              </div>
              {n.link_tab && (
                <button
                  type="button"
                  onClick={() => onNavigate(n.link_tab)}
                  className="text-xs font-medium text-blue-600 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Open
                </button>
              )}
            </div>
          ))}
          {notifications.length === 0 && <div className="p-8 text-center text-sm text-slate-500">No notifications yet.</div>}
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-6 h-fit space-y-4">
        <h3 className="font-display text-sm font-semibold text-slate-900">Notification Preferences</h3>
        {savedMsg && <div className="text-xs text-emerald-700">{savedMsg}</div>}
        <div className="space-y-3">
          {[
            { key: 'message_alerts', label: 'New Messages' },
            { key: 'interview_alerts', label: 'Interview Requests & Updates' },
            { key: 'availability_alerts', label: 'Availability Changes' },
            { key: 'call_alerts', label: 'Incoming & Missed Calls' },
            { key: 'browser_push', label: 'Browser Notifications' },
            { key: 'email_alerts', label: 'Email Digests (when SMTP configured)' },
          ].map((item) => (
            <label key={item.key} className="flex items-center justify-between gap-3 text-xs text-slate-700 cursor-pointer">
              <span>{item.label}</span>
              <input
                type="checkbox"
                checked={Boolean(prefs[item.key])}
                onChange={() => handleTogglePref(item.key)}
                className="w-4 h-4 rounded border-slate-300 text-blue-600"
              />
            </label>
          ))}
        </div>
        <button
          type="button"
          onClick={requestBrowserNotifications}
          className="w-full mt-2 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 cursor-pointer"
        >
          Enable Browser Push Permission
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// TEAM LEAD AUDIT LOGS VIEW
// ============================================================================

export function AuditLogsView({ user }: { user: LoggedInUser }) {
  const [logs, setLogs] = useState<any[]>([]);
  const [q, setQ] = useState('');

  const load = async (query = q) => {
    const res = await apiRequest<{ logs: any[] }>(`/api/audit-logs${query ? `?q=${encodeURIComponent(query)}` : ''}`);
    setLogs(res.logs);
  };

  useEffect(() => {
    load().catch(() => {});
  }, [q]);

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h2 className="font-display text-xl font-semibold text-slate-900">Security & Activity Audit Logs</h2>
        <p className="text-sm text-slate-600 mt-0.5">
          Immutable log of logins, candidate/recruiter provisioning, assignments, file access, interview actions, and administrative changes.
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="relative max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="search"
            aria-label="Search audit logs"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by action, actor, entity..."
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500 text-left">
                <th className="px-5 py-3 font-medium">Timestamp</th>
                <th className="px-5 py-3 font-medium">Actor</th>
                <th className="px-5 py-3 font-medium">Action</th>
                <th className="px-5 py-3 font-medium">Record</th>
                <th className="px-5 py-3 font-medium">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {logs.map((l) => (
                <tr key={l.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3 text-xs font-mono tabular-nums text-slate-500 whitespace-nowrap">
                    {formatDateTimeInTz(l.created_at, user.timezone)}
                  </td>
                  <td className="px-5 py-3 text-xs">
                    <div className="font-medium text-slate-900">{l.actor_name || 'System'}</div>
                    <div className="text-slate-500">{l.actor_role || ''}</div>
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-slate-800 whitespace-nowrap">{l.action}</td>
                  <td className="px-5 py-3 text-xs text-slate-600 whitespace-nowrap">
                    {l.entity_type} · {l.entity_id}
                  </td>
                  <td className="px-5 py-3 text-xs font-mono text-slate-500 max-w-md truncate">
                    {l.details_json}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// TEAM LEAD REPORTS VIEW
// ============================================================================

export function ReportsView() {
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    apiRequest('/api/reports').then(setData).catch(() => {});
  }, []);

  if (!data) return <div className="text-sm text-slate-500">Loading organization reports...</div>;

  return (
    <div className="space-y-6 max-w-7xl">
      <div>
        <h2 className="font-display text-xl font-semibold text-slate-900">Communication & Bench Reports</h2>
        <p className="text-sm text-slate-600 mt-0.5">
          Organization-wide interview funnel, visa distribution, and recruiter communication volume.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <h3 className="font-display text-sm font-semibold text-slate-900 mb-4">Interviews by Status</h3>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.interviewsByStatus}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="status" tick={{ fontSize: 11, fill: '#475569' }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#475569' }} />
                <Tooltip />
                <Bar dataKey="count" fill="#2563eb" radius={[6, 6, 0, 0]} maxBarSize={48} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <h3 className="font-display text-sm font-semibold text-slate-900 mb-4">Candidates by Work Authorization</h3>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.candidatesByVisa}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#475569' }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#475569' }} />
                <Tooltip />
                <Bar dataKey="count" fill="#0f172a" radius={[6, 6, 0, 0]} maxBarSize={48} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h3 className="font-display text-sm font-semibold text-slate-900">Recruiter Activity Summary</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500 text-left">
              <th className="px-5 py-3 font-medium">Recruiter</th>
              <th className="px-5 py-3 font-medium text-right">Assigned Candidates</th>
              <th className="px-5 py-3 font-medium text-right">Interviews</th>
              <th className="px-5 py-3 font-medium text-right">Messages Sent</th>
              <th className="px-5 py-3 font-medium text-right">Calls</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.recruiterActivity.map((r: any) => (
              <tr key={r.id}>
                <td className="px-5 py-3 font-medium text-slate-900">{r.full_name}</td>
                <td className="px-5 py-3 text-right font-mono tabular-nums">{r.candidates}</td>
                <td className="px-5 py-3 text-right font-mono tabular-nums">{r.interviews}</td>
                <td className="px-5 py-3 text-right font-mono tabular-nums">{r.messages}</td>
                <td className="px-5 py-3 text-right font-mono tabular-nums">{r.calls}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================================
// ACCOUNT SETTINGS VIEW
// ============================================================================

export function SettingsView({
  user,
  onUserUpdated,
}: {
  user: LoggedInUser;
  onUserUpdated: () => void;
}) {
  const [fullName, setFullName] = useState(user.fullName);
  const [phone, setPhone] = useState(user.phone || '');
  const [timezone, setTimezone] = useState(user.timezone);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    try {
      await apiRequest('/api/account/settings', {
        method: 'PATCH',
        body: { fullName, phone, timezone },
      });
      setNotice('Account settings and timezone preference updated.');
      onUserUpdated();
    } catch (err: any) {
      setError(err.message || 'Update failed.');
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    try {
      await apiRequest('/api/auth/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword },
      });
      setCurrentPassword('');
      setNewPassword('');
      setNotice('Password updated securely.');
    } catch (err: any) {
      setError(err.message || 'Password change failed.');
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="font-display text-xl font-semibold text-slate-900">Account & Security Settings</h2>
        <p className="text-sm text-slate-600 mt-0.5">Configure your display timezone, contact details, and password.</p>
      </div>

      {error && <div role="alert" className="px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}
      {notice && (
        <div className="px-4 py-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          {notice}
        </div>
      )}

      <form onSubmit={handleSaveAccount} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <h3 className="font-display text-sm font-semibold text-slate-900">Profile & Timezone</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="st-name" className="block text-xs font-medium text-slate-700 mb-1">Full Name</label>
            <input id="st-name" required value={fullName} onChange={(e) => setFullName(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300" />
          </div>
          <div>
            <label htmlFor="st-phone" className="block text-xs font-medium text-slate-700 mb-1">Phone</label>
            <input id="st-phone" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300" />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="st-tz" className="block text-xs font-medium text-slate-700 mb-1">Display Timezone (IANA)</label>
            <select id="st-tz" value={timezone} onChange={(e) => setTimezone(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white">
              {US_TIMEZONES.map((tz) => <option key={tz.id} value={tz.id}>{tz.label}</option>)}
            </select>
          </div>
        </div>
        <button type="submit" className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 cursor-pointer">
          Save Preferences
        </button>
      </form>

      <form onSubmit={handleChangePassword} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <h3 className="font-display text-sm font-semibold text-slate-900">Change Password</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="pw-cur" className="block text-xs font-medium text-slate-700 mb-1">Current Password</label>
            <input id="pw-cur" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300" />
          </div>
          <div>
            <label htmlFor="pw-new" className="block text-xs font-medium text-slate-700 mb-1">New Password (min 8 chars)</label>
            <input id="pw-new" type="password" required minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300" />
          </div>
        </div>
        <button type="submit" className="px-4 py-2 text-sm font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 cursor-pointer">
          Update Password
        </button>
      </form>
    </div>
  );
}
