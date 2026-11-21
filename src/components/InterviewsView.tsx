import React, { useEffect, useState } from 'react';
import { CalendarPlus, ExternalLink, X } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { LoggedInUser } from './LoginView';
import {
  US_TIMEZONES,
  formatDateTimeInTz,
  interviewStatusMeta,
  todayIsoInTz,
} from '../lib/format';

interface InterviewsViewProps {
  user: LoggedInUser;
  preselectCandidateId?: string;
}

export function InterviewsView({ user, preselectCandidateId }: InterviewsViewProps) {
  const [interviews, setInterviews] = useState<any[]>([]);
  const [candidates, setCandidates] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Schedule Modal (Recruiter / Team Lead)
  const [showSchedule, setShowSchedule] = useState(Boolean(preselectCandidateId));
  const [candidateId, setCandidateId] = useState(preselectCandidateId || '');
  const [companyName, setCompanyName] = useState('');
  const [jobPosition, setJobPosition] = useState('');
  const [date, setDate] = useState(() => todayIsoInTz(user.timezone));
  const [startTime, setStartTime] = useState('11:00');
  const [durationMinutes, setDurationMinutes] = useState('45');
  const [timezone, setTimezone] = useState(user.timezone);
  const [interviewType, setInterviewType] = useState<'video' | 'phone' | 'in_person'>('video');
  const [meetingLink, setMeetingLink] = useState('');
  const [instructions, setInstructions] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Feedback Modal (Recruiter / Team Lead)
  const [editingIv, setEditingIv] = useState<any | null>(null);
  const [editStatus, setEditStatus] = useState('');
  const [editOutcome, setEditOutcome] = useState('');
  const [editFeedback, setEditFeedback] = useState('');

  // Candidate Reschedule Request Note
  const [rescheduleIvId, setRescheduleIvId] = useState<string | null>(null);
  const [rescheduleNote, setRescheduleNote] = useState('');

  const loadData = async () => {
    try {
      const ivRes = await apiRequest<{ interviews: any[] }>('/api/interviews');
      setInterviews(ivRes.interviews);
      if (user.role !== 'candidate') {
        const candRes = await apiRequest<{ candidates: any[] }>('/api/candidates');
        setCandidates(candRes.candidates);
        if (!candidateId && candRes.candidates.length > 0) {
          setCandidateId(preselectCandidateId || candRes.candidates[0].id);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load interviews.');
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setSubmitting(true);
    try {
      await apiRequest('/api/interviews', {
        method: 'POST',
        body: {
          candidateId,
          companyName,
          jobPosition,
          date,
          startTime,
          durationMinutes: Number(durationMinutes),
          timezone,
          interviewType,
          meetingLink,
          instructions,
        },
      });
      setShowSchedule(false);
      setCompanyName('');
      setJobPosition('');
      setMeetingLink('');
      setInstructions('');
      setNotice('Interview scheduled and request notification sent to the candidate.');
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Could not schedule interview.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleCandidateRespond = async (ivId: string, action: 'confirm' | 'decline' | 'reschedule', note = '') => {
    setError('');
    setNotice('');
    try {
      await apiRequest(`/api/interviews/${ivId}/respond`, {
        method: 'POST',
        body: { action, note },
      });
      setRescheduleIvId(null);
      setRescheduleNote('');
      setNotice('Your response was recorded and your recruiter was notified.');
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to submit response.');
    }
  };

  const handleUpdateInterview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingIv) return;
    setError('');
    try {
      await apiRequest(`/api/interviews/${editingIv.id}`, {
        method: 'PATCH',
        body: {
          status: editStatus,
          outcome: editOutcome,
          feedback: editFeedback,
        },
      });
      setEditingIv(null);
      setNotice('Interview record updated.');
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Update failed.');
    }
  };

  const filtered = interviews.filter((iv) => {
    if (statusFilter !== 'all' && iv.status !== statusFilter) return false;
    if (search.trim()) {
      const hay = `${iv.company_name} ${iv.job_position} ${iv.candidate_name} ${iv.recruiter_name}`.toLowerCase();
      return hay.includes(search.trim().toLowerCase());
    }
    return true;
  });

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-semibold text-slate-900">
            {user.role === 'team_lead' ? 'Organization Interview Calendar' : 'Interview Schedule'}
          </h2>
          <p className="text-sm text-slate-600 mt-0.5">
            All times automatically displayed in your timezone ({user.timezone}) with automatic conflict detection.
          </p>
        </div>
        {user.role !== 'candidate' && (
          <button
            type="button"
            onClick={() => setShowSchedule(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <CalendarPlus className="w-4 h-4" />
            Schedule Interview
          </button>
        )}
      </div>

      {error && (
        <div role="alert" className="px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}
      {notice && (
        <div className="px-4 py-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">
          {notice}
        </div>
      )}

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
        <input
          type="search"
          aria-label="Filter interviews"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by company, role, candidate, or recruiter..."
          className="w-full sm:w-80 px-3 py-2 text-sm rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
        />

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg overflow-x-auto">
          {[
            { id: 'all', label: 'All' },
            { id: 'requested', label: 'Pending' },
            { id: 'confirmed', label: 'Confirmed' },
            { id: 'reschedule_requested', label: 'Reschedule' },
            { id: 'completed', label: 'Completed' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap cursor-pointer ${
                statusFilter === tab.id ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Interview List */}
      <div className="space-y-4">
        {filtered.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-10 text-center text-sm text-slate-500">
            No interviews match your filter.
          </div>
        ) : (
          filtered.map((iv) => {
            const st = interviewStatusMeta(iv.status);
            return (
              <div key={iv.id} className="bg-white border border-slate-200 rounded-xl p-5">
                <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className={st.textClass}>{st.label}</span>
                      <span aria-hidden="true">·</span>
                      <span className="capitalize">{iv.interview_type.replace('_', ' ')}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums text-slate-700">
                        {formatDateTimeInTz(iv.start_utc, user.timezone)}
                      </span>
                    </div>
                    <h3 className="font-display text-base font-semibold text-slate-900">
                      {iv.company_name} — {iv.job_position}
                    </h3>
                    <div className="text-xs text-slate-600">
                      Candidate: <strong className="font-medium text-slate-800">{iv.candidate_name}</strong>
                      <span aria-hidden="true"> · </span>
                      Recruiter: <strong className="font-medium text-slate-800">{iv.recruiter_name}</strong>
                      <span aria-hidden="true"> · </span>
                      Scheduled TZ: {iv.timezone}
                    </div>
                    {iv.instructions && (
                      <p className="text-xs text-slate-600 pt-1 max-w-2xl leading-relaxed">{iv.instructions}</p>
                    )}
                    {iv.candidate_note && (
                      <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 inline-block mt-1">
                        Candidate note: {iv.candidate_note}
                      </p>
                    )}
                    {(iv.outcome || iv.feedback) && (
                      <div className="text-xs text-slate-700 pt-1">
                        {iv.outcome && <span className="font-medium">Outcome: {iv.outcome}</span>}
                        {iv.outcome && iv.feedback && <span aria-hidden="true"> · </span>}
                        {iv.feedback && <span>Feedback: {iv.feedback}</span>}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    {iv.meeting_link && (
                      <a
                        href={iv.meeting_link}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 text-blue-600 hover:bg-blue-50 whitespace-nowrap"
                      >
                        Join Link
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}

                    {/* Candidate Response Controls */}
                    {user.role === 'candidate' &&
                      (iv.status === 'requested' || iv.status === 'reschedule_requested') && (
                        <>
                          <button
                            type="button"
                            onClick={() => handleCandidateRespond(iv.id, 'confirm')}
                            className="px-3 py-1.5 text-xs font-medium rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 cursor-pointer"
                          >
                            Confirm
                          </button>
                          <button
                            type="button"
                            onClick={() => setRescheduleIvId(iv.id)}
                            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 cursor-pointer"
                          >
                            Request New Time
                          </button>
                          <button
                            type="button"
                            onClick={() => handleCandidateRespond(iv.id, 'decline', 'Declined by candidate')}
                            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-red-200 text-red-700 hover:bg-red-50 cursor-pointer"
                          >
                            Decline
                          </button>
                        </>
                      )}

                    {/* Recruiter / Team Lead Management Controls */}
                    {user.role !== 'candidate' && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingIv(iv);
                          setEditStatus(iv.status);
                          setEditOutcome(iv.outcome || '');
                          setEditFeedback(iv.feedback || '');
                        }}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 cursor-pointer"
                      >
                        Update Status / Feedback
                      </button>
                    )}
                  </div>
                </div>

                {rescheduleIvId === iv.id && (
                  <div className="mt-4 pt-3 border-t border-slate-100 flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={rescheduleNote}
                      onChange={(e) => setRescheduleNote(e.target.value)}
                      placeholder="Suggest an alternate date and time window..."
                      className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-slate-300"
                    />
                    <button
                      type="button"
                      onClick={() => handleCandidateRespond(iv.id, 'reschedule', rescheduleNote)}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 cursor-pointer"
                    >
                      Send Reschedule Request
                    </button>
                    <button
                      type="button"
                      onClick={() => setRescheduleIvId(null)}
                      className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-600 cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Schedule Modal */}
      {showSchedule && (
        <div role="dialog" aria-modal="true" aria-label="Schedule interview" className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="font-display text-base font-semibold text-slate-900">Schedule Interview</h3>
              <button type="button" onClick={() => setShowSchedule(false)} aria-label="Close modal" className="p-1 text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSchedule} className="mt-4 space-y-3.5">
              <div>
                <label htmlFor="iv-cand" className="block text-xs font-medium text-slate-700 mb-1">Candidate</label>
                <select
                  id="iv-cand"
                  required
                  value={candidateId}
                  onChange={(e) => setCandidateId(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
                >
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.full_name} ({c.technology})
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="iv-company" className="block text-xs font-medium text-slate-700 mb-1">Company Name</label>
                  <input
                    id="iv-company"
                    required
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="e.g., Meridian Financial"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                  />
                </div>
                <div>
                  <label htmlFor="iv-role" className="block text-xs font-medium text-slate-700 mb-1">Job Position</label>
                  <input
                    id="iv-role"
                    required
                    value={jobPosition}
                    onChange={(e) => setJobPosition(e.target.value)}
                    placeholder="e.g., Senior Cloud Architect"
                    className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                  />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label htmlFor="iv-date" className="block text-xs font-medium text-slate-700 mb-1">Date</label>
                  <input
                    id="iv-date"
                    type="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs font-mono rounded-lg border border-slate-300"
                  />
                </div>
                <div>
                  <label htmlFor="iv-time" className="block text-xs font-medium text-slate-700 mb-1">Start Time</label>
                  <input
                    id="iv-time"
                    type="time"
                    required
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs font-mono rounded-lg border border-slate-300"
                  />
                </div>
                <div>
                  <label htmlFor="iv-dur" className="block text-xs font-medium text-slate-700 mb-1">Duration</label>
                  <select
                    id="iv-dur"
                    value={durationMinutes}
                    onChange={(e) => setDurationMinutes(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs rounded-lg border border-slate-300 bg-white"
                  >
                    <option value="30">30 min</option>
                    <option value="45">45 min</option>
                    <option value="60">60 min</option>
                    <option value="90">90 min</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="iv-tz" className="block text-xs font-medium text-slate-700 mb-1">Timezone</label>
                  <select
                    id="iv-tz"
                    value={timezone}
                    onChange={(e) => setTimezone(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white"
                  >
                    {US_TIMEZONES.map((tz) => (
                      <option key={tz.id} value={tz.id}>{tz.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="iv-type" className="block text-xs font-medium text-slate-700 mb-1">Interview Type</label>
                  <select
                    id="iv-type"
                    value={interviewType}
                    onChange={(e) => setInterviewType(e.target.value as any)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white"
                  >
                    <option value="video">Video</option>
                    <option value="phone">Phone</option>
                    <option value="in_person">In-Person</option>
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="iv-link" className="block text-xs font-medium text-slate-700 mb-1">Meeting Link (optional)</label>
                <input
                  id="iv-link"
                  type="url"
                  value={meetingLink}
                  onChange={(e) => setMeetingLink(e.target.value)}
                  placeholder="https://meet.example.com/interview-room"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                />
              </div>
              <div>
                <label htmlFor="iv-inst" className="block text-xs font-medium text-slate-700 mb-1">Interview Instructions</label>
                <textarea
                  id="iv-inst"
                  rows={3}
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="Panelists, focus topics, or coding prep..."
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowSchedule(false)}
                  className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-700 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
                >
                  {submitting ? 'Scheduling...' : 'Send Interview Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Update Status & Feedback Modal */}
      {editingIv && (
        <div role="dialog" aria-modal="true" aria-label="Update interview status and feedback" className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="font-display text-base font-semibold text-slate-900">
                Update Interview — {editingIv.company_name}
              </h3>
              <button type="button" onClick={() => setEditingIv(null)} aria-label="Close modal" className="p-1 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleUpdateInterview} className="mt-4 space-y-3.5">
              <div>
                <label htmlFor="edit-iv-status" className="block text-xs font-medium text-slate-700 mb-1">Status</label>
                <select
                  id="edit-iv-status"
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
                >
                  <option value="requested">Requested</option>
                  <option value="confirmed">Confirmed</option>
                  <option value="reschedule_requested">Reschedule Requested</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                  <option value="no_show">No-Show</option>
                </select>
              </div>
              <div>
                <label htmlFor="edit-iv-outcome" className="block text-xs font-medium text-slate-700 mb-1">Outcome</label>
                <input
                  id="edit-iv-outcome"
                  value={editOutcome}
                  onChange={(e) => setEditOutcome(e.target.value)}
                  placeholder="e.g., Advanced to Final Round, Offer Extended"
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                />
              </div>
              <div>
                <label htmlFor="edit-iv-feedback" className="block text-xs font-medium text-slate-700 mb-1">Client / Recruiter Feedback</label>
                <textarea
                  id="edit-iv-feedback"
                  rows={3}
                  value={editFeedback}
                  onChange={(e) => setEditFeedback(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                />
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setEditingIv(null)} className="px-4 py-2 text-sm rounded-lg border border-slate-200 cursor-pointer">
                  Cancel
                </button>
                <button type="submit" className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 cursor-pointer">
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
