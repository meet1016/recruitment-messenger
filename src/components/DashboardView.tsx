import { useEffect, useState } from 'react';
import {
  Calendar,
  CheckCircle2,
  Clock,
  Mail,
  MessageSquare,
  Phone,
  ArrowUpRight,
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
import { Avatar } from './Avatar';
import { LoggedInUser } from './LoginView';
import { availabilityMeta, formatDateTimeInTz, interviewStatusMeta } from '../lib/format';

interface DashboardViewProps {
  user: LoggedInUser;
  onNavigate: (tab: string, context?: { candidateId?: string }) => void;
  refreshTick: number;
}

export function DashboardView({ user, onNavigate, refreshTick }: DashboardViewProps) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [quickBusy, setQuickBusy] = useState(false);
  const [quickNotice, setQuickNotice] = useState('');

  const loadDashboard = async () => {
    setError('');
    try {
      const res = await apiRequest('/api/dashboard');
      setData(res);
    } catch (err: any) {
      setError(err.message || 'Failed to load dashboard.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, [refreshTick]);

  const handleAvailableToday = async () => {
    setQuickBusy(true);
    setQuickNotice('');
    try {
      await apiRequest(`/api/availability/${user.id}/quick-today`, { method: 'POST' });
      setQuickNotice('Availability set for today and your assigned recruiter has been notified.');
      await loadDashboard();
    } catch (err: any) {
      setError(err.message || 'Could not update availability.');
    } finally {
      setQuickBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((n) => (
            <div key={n} className="h-24 bg-white border border-slate-200 rounded-xl animate-pulse" />
          ))}
        </div>
        <div className="h-64 bg-white border border-slate-200 rounded-xl animate-pulse" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-white border border-red-200 rounded-xl p-6 text-sm text-red-700">
        {error || 'Dashboard data unavailable.'}
      </div>
    );
  }

  // =========================================================================
  // CANDIDATE DASHBOARD
  // =========================================================================
  if (user.role === 'candidate') {
    const avMeta = availabilityMeta(data.stats.todayStatus);
    return (
      <div className="space-y-6 max-w-6xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-semibold text-slate-900">
              Welcome back, {user.fullName}
            </h2>
            <p className="text-sm text-slate-600 mt-0.5">
              Manage your interview availability, respond to requests, and message your assigned recruiter.
            </p>
          </div>
          <button
            type="button"
            disabled={quickBusy}
            onClick={handleAvailableToday}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4" />
            {quickBusy ? 'Updating...' : 'Available for Interview Today'}
          </button>
        </div>

        {quickNotice && (
          <div className="px-4 py-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
            {quickNotice}
          </div>
        )}

        {/* KPI Strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="text-xs text-slate-500">Today&apos;s Availability</div>
            <div className={`mt-2 text-lg font-display font-semibold ${avMeta.textClass}`}>
              {avMeta.label}
            </div>
            <button
              type="button"
              onClick={() => onNavigate('availability')}
              className="mt-2 text-xs text-blue-600 hover:underline cursor-pointer"
            >
              Edit schedule
            </button>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="text-xs text-slate-500">Unread Messages</div>
            <div className="mt-2 text-2xl font-display font-semibold text-slate-900 tabular-nums">
              {data.stats.unreadMessages}
            </div>
            <button
              type="button"
              onClick={() => onNavigate('messages')}
              className="mt-2 text-xs text-blue-600 hover:underline cursor-pointer"
            >
              Open inbox
            </button>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="text-xs text-slate-500">Upcoming Interviews</div>
            <div className="mt-2 text-2xl font-display font-semibold text-slate-900 tabular-nums">
              {data.stats.upcomingInterviews}
            </div>
            <div className="mt-2 text-xs text-slate-500">
              {data.stats.pendingRequests} pending response
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="text-xs text-slate-500">Missed Calls</div>
            <div
              className={`mt-2 text-2xl font-display font-semibold tabular-nums ${
                data.stats.missedCalls > 0 ? 'text-red-600' : 'text-slate-900'
              }`}
            >
              {data.stats.missedCalls}
            </div>
            <div className="mt-2 text-xs text-slate-500">Direct 1-to-1 calls</div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Assigned Recruiter Card */}
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h3 className="font-display text-sm font-semibold text-slate-900">Your Assigned Recruiter</h3>
            {data.assignedRecruiter ? (
              <div className="mt-4">
                <div className="flex items-center gap-3.5">
                  <Avatar
                    name={data.assignedRecruiter.full_name}
                    src={data.assignedRecruiter.avatar_url}
                    size="lg"
                  />
                  <div className="min-w-0">
                    <div className="font-medium text-slate-900 truncate">
                      {data.assignedRecruiter.full_name}
                    </div>
                    <div className="text-xs text-slate-500 truncate">
                      {data.assignedRecruiter.title || 'Assigned Recruiter'}
                    </div>
                    <div className="text-xs text-slate-500 truncate">
                      {data.assignedRecruiter.department}
                    </div>
                  </div>
                </div>

                <div className="mt-5 space-y-2.5 text-xs text-slate-600 border-t border-slate-100 pt-4">
                  <div className="flex items-center gap-2">
                    <Mail className="w-3.5 h-3.5 text-slate-400" />
                    <span className="truncate">{data.assignedRecruiter.email}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Phone className="w-3.5 h-3.5 text-slate-400" />
                    <span className="font-mono tabular-nums">{data.assignedRecruiter.phone || 'Not listed'}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5 text-slate-400" />
                    <span>{data.assignedRecruiter.timezone}</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => onNavigate('messages')}
                  className="mt-5 w-full inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 text-slate-800 hover:bg-slate-50 transition-colors cursor-pointer"
                >
                  <MessageSquare className="w-4 h-4" />
                  Message Recruiter
                </button>
              </div>
            ) : (
              <p className="mt-3 text-sm text-slate-500">No recruiter is currently assigned.</p>
            )}
          </div>

          {/* Upcoming Interviews & Pending Requests */}
          <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-6">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-semibold text-slate-900">
                Upcoming Interviews & Requests
              </h3>
              <button
                type="button"
                onClick={() => onNavigate('interviews')}
                className="text-xs font-medium text-blue-600 hover:underline cursor-pointer"
              >
                View all
              </button>
            </div>

            {data.upcomingInterviews.length === 0 ? (
              <p className="mt-6 text-sm text-slate-500">No upcoming interviews scheduled right now.</p>
            ) : (
              <div className="mt-4 divide-y divide-slate-100">
                {data.upcomingInterviews.map((iv: any) => {
                  const st = interviewStatusMeta(iv.status);
                  return (
                    <div key={iv.id} className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <div className="text-sm font-medium text-slate-900">
                          {iv.company_name} — {iv.job_position}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5 font-mono tabular-nums">
                          {formatDateTimeInTz(iv.start_utc, user.timezone)}
                          <span aria-hidden="true"> · </span>
                          {iv.interview_type.replace('_', ' ')}
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <span className={`text-xs ${st.textClass}`}>{st.label}</span>
                        <button
                          type="button"
                          onClick={() => onNavigate('interviews')}
                          className="text-xs font-medium text-blue-600 hover:underline whitespace-nowrap cursor-pointer"
                        >
                          Manage
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // RECRUITER DASHBOARD
  // =========================================================================
  if (user.role === 'recruiter') {
    const s = data.stats;
    return (
      <div className="space-y-6 max-w-7xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-semibold text-slate-900">
              Recruiter Overview
            </h2>
            <p className="text-sm text-slate-600 mt-0.5">
              Showing metrics exclusively for candidates actively assigned to you ({data.today}).
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => onNavigate('messages')}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 whitespace-nowrap cursor-pointer"
            >
              Open Messages
            </button>
            <button
              type="button"
              onClick={() => onNavigate('interviews')}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 whitespace-nowrap cursor-pointer"
            >
              Schedule Interview
            </button>
          </div>
        </div>

        {/* KPI Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { label: 'Assigned Candidates', value: s.totalAssignedCandidates, sub: `${s.availableToday} available today` },
            { label: 'Unread Messages', value: s.unreadMessages, sub: 'Active candidate threads' },
            { label: 'Upcoming Interviews', value: s.upcomingInterviews, sub: `${s.pendingConfirmations} pending confirmation` },
            { label: 'Missed Calls', value: s.missedCalls, sub: `${s.unavailableCandidates} unavailable today`, alert: s.missedCalls > 0 },
          ].map((k) => (
            <div key={k.label} className="bg-white border border-slate-200 rounded-xl p-5">
              <div className="text-xs text-slate-500">{k.label}</div>
              <div
                className={`mt-2 text-2xl font-display font-semibold tabular-nums ${
                  k.alert ? 'text-red-600' : 'text-slate-900'
                }`}
              >
                {k.value}
              </div>
              <div className="mt-1 text-xs text-slate-500">{k.sub}</div>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Candidates Available Today */}
          <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-6">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-semibold text-slate-900">
                Assigned Candidates Available Today (Your Timezone)
              </h3>
              <button
                type="button"
                onClick={() => onNavigate('availability')}
                className="text-xs font-medium text-blue-600 hover:underline cursor-pointer"
              >
                Full calendar
              </button>
            </div>
            {data.availableTodayList.length === 0 ? (
              <p className="mt-5 text-sm text-slate-500">No assigned candidates have open slots today.</p>
            ) : (
              <div className="mt-4 divide-y divide-slate-100">
                {data.availableTodayList.map((c: any) => {
                  const av = availabilityMeta(c.status);
                  return (
                    <div key={c.id} className="py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <Avatar name={c.full_name} src={c.avatar_url} size="sm" />
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-slate-900 truncate">{c.full_name}</div>
                          <div className="text-xs text-slate-500 truncate">
                            {c.technology} <span aria-hidden="true">·</span> {c.visa_status}
                          </div>
                        </div>
                      </div>
                      <div className="text-left sm:text-right">
                        <div className={`text-xs ${av.textClass}`}>{av.label}</div>
                        <div className="text-xs text-slate-600 font-mono tabular-nums mt-0.5">
                          {c.convertedSlots
                            .map((s: any) => `${s.converted.startLabel}–${s.converted.endLabel} ${s.converted.tzAbbr}`)
                            .join(', ')}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Personal Reminders */}
          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-sm font-semibold text-slate-900">Personal Reminders</h3>
              <button
                type="button"
                onClick={() => onNavigate('reminders')}
                className="text-xs font-medium text-blue-600 hover:underline cursor-pointer"
              >
                Manage
              </button>
            </div>
            {data.reminders.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500">All caught up on reminders.</p>
            ) : (
              <ul className="mt-4 divide-y divide-slate-100">
                {data.reminders.map((r: any) => (
                  <li key={r.id} className="py-3">
                    <div className="text-sm text-slate-800">{r.title}</div>
                    <div className="text-xs text-slate-500 mt-1 font-mono tabular-nums">
                      Due {formatDateTimeInTz(r.due_at, user.timezone)}
                      {r.candidate_name && ` · ${r.candidate_name}`}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // TEAM LEAD ADMIN DASHBOARD
  // =========================================================================
  const s = data.stats;
  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-semibold text-slate-900">
            Organization Operations Overview
          </h2>
          <p className="text-sm text-slate-600 mt-0.5">
            Real-time communication health, bench availability, recruiter assignments, and interview pipeline.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onNavigate('assignments')}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 whitespace-nowrap cursor-pointer"
          >
            Manage Assignments
          </button>
          <button
            type="button"
            onClick={() => onNavigate('candidates')}
            className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 whitespace-nowrap cursor-pointer"
          >
            Add Candidate
          </button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {[
          { label: 'Total Candidates', value: s.totalCandidates, sub: `${s.activeCandidates} active` },
          { label: 'Active Recruiters', value: s.totalRecruiters, sub: `${s.totalConversations} live threads` },
          { label: 'Available Today', value: s.availableCandidates, sub: `${s.unavailableCandidates} unavailable`, tone: 'emerald' },
          { label: 'Interviews Scheduled', value: s.interviewsScheduled, sub: `${s.upcomingInterviews} upcoming` },
          { label: 'Unread / Missed Calls', value: `${s.unreadMessages} / ${s.missedCalls}`, sub: 'Unread msgs / missed calls', tone: s.missedCalls > 0 ? 'red' : undefined },
        ].map((item) => (
          <div key={item.label} className="bg-white border border-slate-200 rounded-xl p-5">
            <div className="text-xs text-slate-500">{item.label}</div>
            <div
              className={`mt-2 text-2xl font-display font-semibold tabular-nums ${
                item.tone === 'emerald'
                  ? 'text-emerald-700'
                  : item.tone === 'red'
                  ? 'text-red-600'
                  : 'text-slate-900'
              }`}
            >
              {item.value}
            </div>
            <div className="mt-1 text-xs text-slate-500">{item.sub}</div>
          </div>
        ))}
      </div>

      {/* Charts + Recruiter Workload */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display text-sm font-semibold text-slate-900">
              Bench Availability Breakdown ({data.today})
            </h3>
            <button
              type="button"
              onClick={() => onNavigate('availability')}
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline cursor-pointer"
            >
              Overview <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.availabilityBreakdown} margin={{ top: 8, right: 12, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#475569' }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#475569' }} axisLine={false} tickLine={false} />
                <Tooltip />
                <Bar dataKey="count" fill="#2563eb" radius={[6, 6, 0, 0]} maxBarSize={56} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-display text-sm font-semibold text-slate-900">Recruiter Workload & Activity</h3>
            <button
              type="button"
              onClick={() => onNavigate('recruiters')}
              className="text-xs font-medium text-blue-600 hover:underline cursor-pointer"
            >
              Manage team
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500 text-left">
                  <th className="py-2 font-medium">Recruiter</th>
                  <th className="py-2 font-medium text-right">Candidates</th>
                  <th className="py-2 font-medium text-right">Interviews</th>
                  <th className="py-2 font-medium text-right">Messages</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.recruiterWorkload.map((r: any) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="py-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={r.full_name} src={r.avatar_url} size="xs" />
                        <div>
                          <div className="font-medium text-slate-900">{r.full_name}</div>
                          <div className="text-xs text-slate-500">{r.department}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 text-right font-mono tabular-nums text-slate-800">{r.active_candidates}</td>
                    <td className="py-3 text-right font-mono tabular-nums text-slate-800">{r.active_interviews}</td>
                    <td className="py-3 text-right font-mono tabular-nums text-slate-800">{r.messages_sent}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Recent System Activity */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-sm font-semibold text-slate-900">Recent System Audit Activity</h3>
          <button
            type="button"
            onClick={() => onNavigate('audit')}
            className="text-xs font-medium text-blue-600 hover:underline cursor-pointer"
          >
            View full audit trail
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-xs text-slate-500 text-left">
                <th className="py-2 font-medium">Timestamp</th>
                <th className="py-2 font-medium">User</th>
                <th className="py-2 font-medium">Action</th>
                <th className="py-2 font-medium">Entity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.recentActivity.slice(0, 6).map((a: any) => (
                <tr key={a.id} className="hover:bg-slate-50">
                  <td className="py-2.5 text-xs font-mono tabular-nums text-slate-500 whitespace-nowrap">
                    {formatDateTimeInTz(a.created_at, user.timezone)}
                  </td>
                  <td className="py-2.5 text-slate-900 font-medium">{a.actor_name || 'System'}</td>
                  <td className="py-2.5 font-mono text-xs text-slate-700">{a.action}</td>
                  <td className="py-2.5 text-xs text-slate-500">
                    {a.entity_type} · {a.entity_id}
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
