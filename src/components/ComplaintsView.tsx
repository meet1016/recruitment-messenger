import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Eye,
  EyeOff,
  MessageSquare,
  Send,
  Shield,
  UserCheck,
} from 'lucide-react';
import { apiRequest, realtimeClient } from '../lib/api';
import { Avatar } from './Avatar';
import { LoggedInUser } from './LoginView';
import { formatDateTimeInTz } from '../lib/format';

interface ComplaintsViewProps {
  user: LoggedInUser;
  onOpenCandidateChat?: (candidateId: string) => void;
  onOpenDirectChat?: (targetUserId: string) => void;
  onComplaintsUpdated?: () => void;
}

const CATEGORY_LABELS: Record<string, string> = {
  communication: 'Communication',
  scheduling: 'Interview Scheduling',
  conduct: 'Professional Conduct',
  rate_terms: 'Rate & Terms',
  other: 'Other',
};

const PRIORITY_STYLES: Record<string, { label: string; textClass: string }> = {
  low: { label: 'Low Priority', textClass: 'text-slate-600' },
  normal: { label: 'Normal Priority', textClass: 'text-blue-700 font-medium' },
  high: { label: 'High Priority', textClass: 'text-amber-700 font-medium' },
  urgent: { label: 'Urgent', textClass: 'text-red-700 font-semibold' },
};

const STATUS_STYLES: Record<string, { label: string; textClass: string }> = {
  open: { label: 'Open', textClass: 'text-red-700 font-semibold' },
  in_review: { label: 'Under Review', textClass: 'text-amber-700 font-semibold' },
  resolved: { label: 'Resolved', textClass: 'text-emerald-700 font-semibold' },
  dismissed: { label: 'Dismissed', textClass: 'text-slate-500 font-medium' },
};

export function ComplaintsView({
  user,
  onOpenCandidateChat,
  onOpenDirectChat,
  onComplaintsUpdated,
}: ComplaintsViewProps) {
  const [complaints, setComplaints] = useState<any[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Candidate filing form state
  const [category, setCategory] = useState('communication');
  const [priority, setPriority] = useState('normal');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Team Lead per-complaint edit drafts
  const [drafts, setDrafts] = useState<
    Record<string, { status: string; response: string; visibleToRecruiter: boolean }>
  >({});
  const [savingId, setSavingId] = useState<string | null>(null);

  const loadComplaints = async (filter = statusFilter) => {
    setLoading(true);
    setError('');
    try {
      const res = await apiRequest<{ complaints: any[] }>(
        `/api/complaints${filter ? `?status=${encodeURIComponent(filter)}` : ''}`
      );
      setComplaints(res.complaints);
      const nextDrafts: Record<string, { status: string; response: string; visibleToRecruiter: boolean }> = {};
      for (const c of res.complaints) {
        nextDrafts[c.id] = {
          status: c.status,
          response: c.team_lead_response || '',
          visibleToRecruiter: c.visible_to_recruiter === 1,
        };
      }
      setDrafts(nextDrafts);
      onComplaintsUpdated?.();
    } catch (err: any) {
      setError(err.message || 'Failed to load complaints.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadComplaints(statusFilter);
  }, [statusFilter]);

  useEffect(() => {
    return realtimeClient.subscribe((evt) => {
      if (evt.type === 'complaint:new' || evt.type === 'complaint:updated') {
        loadComplaints(statusFilter);
      }
    });
  }, [statusFilter]);

  const handleCandidateSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    if (!subject.trim()) {
      setError('Please enter a brief subject for your complaint.');
      return;
    }
    if (description.trim().length < 10) {
      setError('Please provide at least 10 characters describing your concern.');
      return;
    }

    setSubmitting(true);
    try {
      await apiRequest('/api/complaints', {
        method: 'POST',
        body: {
          category,
          priority,
          subject: subject.trim(),
          description: description.trim(),
        },
      });
      setSubject('');
      setDescription('');
      setPriority('normal');
      setCategory('communication');
      setNotice(
        'Your complaint has been sent directly to the Team Lead. Visibility is strictly restricted to leadership and your assigned recruiter.'
      );
      await loadComplaints(statusFilter);
    } catch (err: any) {
      setError(err.message || 'Unable to submit complaint.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleTeamLeadSave = async (complaintId: string) => {
    const draft = drafts[complaintId];
    if (!draft) return;
    setSavingId(complaintId);
    setError('');
    setNotice('');
    try {
      await apiRequest(`/api/complaints/${complaintId}`, {
        method: 'PATCH',
        body: {
          status: draft.status,
          teamLeadResponse: draft.response,
          visibleToRecruiter: draft.visibleToRecruiter,
        },
      });
      setNotice('Complaint status, response, and recruiter visibility saved.');
      await loadComplaints(statusFilter);
    } catch (err: any) {
      setError(err.message || 'Could not update complaint.');
    } finally {
      setSavingId(null);
    }
  };

  const updateDraft = (
    id: string,
    patch: Partial<{ status: string; response: string; visibleToRecruiter: boolean }>
  ) => {
    setDrafts((prev) => ({
      ...prev,
      [id]: {
        status: prev[id]?.status || 'open',
        response: prev[id]?.response || '',
        visibleToRecruiter: prev[id]?.visibleToRecruiter ?? true,
        ...patch,
      },
    }));
  };

  return (
    <div className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-semibold text-slate-900">
            {user.role === 'candidate'
              ? 'Candidate Complaints & Escalations'
              : user.role === 'team_lead'
              ? 'Candidate Complaints Console'
              : 'Assigned Candidate Complaints'}
          </h2>
          <p className="text-sm text-slate-500 mt-1">
            {user.role === 'candidate'
              ? 'Complaints go directly to the Team Lead for review and are visible only to leadership and your assigned recruiter.'
              : user.role === 'team_lead'
              ? 'Review candidate concerns sent directly to leadership, manage recruiter visibility, and step into any chat thread.'
              : 'Escalated candidate complaints routed directly to the Team Lead and scoped exclusively to your assigned candidates.'}
          </p>
        </div>

        {user.role !== 'candidate' && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {[
              { id: '', label: 'All' },
              { id: 'open', label: 'Open' },
              { id: 'in_review', label: 'Under Review' },
              { id: 'resolved', label: 'Resolved' },
            ].map((tab) => (
              <button
                key={tab.id || 'all'}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                  statusFilter === tab.id
                    ? 'bg-slate-900 text-white border-slate-900'
                    : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Role-specific Routing & Privacy Notice */}
      <div className="px-4 py-3 rounded-xl bg-white border border-slate-200 flex items-start gap-3 text-xs text-slate-600">
        <Shield className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
        <div>
          {user.role === 'candidate' && (
            <>
              <strong className="text-slate-900">Direct Team Lead Routing:</strong> Your complaint is delivered
              immediately to the Team Lead&apos;s queue. Only the Team Lead and your assigned recruiter (unless
              restricted by the Team Lead) can view it—never other candidates or other recruiters.
            </>
          )}
          {user.role === 'team_lead' && (
            <>
              <strong className="text-slate-900">Team Lead Escalation Authority:</strong> All candidate complaints arrive
              directly here. Only you can update resolution status, post official responses, or toggle whether the
              assigned recruiter can view a complaint.
            </>
          )}
          {user.role === 'recruiter' && (
            <>
              <strong className="text-slate-900">Scoped Visibility (Read-Only):</strong> Candidate complaints are sent
              directly to the Team Lead and displayed only to the assigned recruiter. Other recruiters cannot view your
              candidates&apos; complaints.
            </>
          )}
        </div>
      </div>

      {error && (
        <div role="alert" className="px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">
          {error}
        </div>
      )}
      {notice && (
        <div className="px-4 py-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      {/* Candidate Submission Form */}
      {user.role === 'candidate' && (
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <h3 className="font-display text-sm font-semibold text-slate-900">
              Submit a Complaint Directly to the Team Lead
            </h3>
          </div>

          <form onSubmit={handleCandidateSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="complaint-category" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Category
                </label>
                <select
                  id="complaint-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  <option value="communication">Communication / Responsiveness</option>
                  <option value="scheduling">Interview Scheduling</option>
                  <option value="conduct">Professional Conduct</option>
                  <option value="rate_terms">Rate &amp; Engagement Terms</option>
                  <option value="other">Other Concern</option>
                </select>
              </div>

              <div>
                <label htmlFor="complaint-priority" className="block text-xs font-medium text-slate-700 mb-1.5">
                  Priority
                </label>
                <select
                  id="complaint-priority"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
            </div>

            <div>
              <label htmlFor="complaint-subject" className="block text-xs font-medium text-slate-700 mb-1.5">
                Subject
              </label>
              <input
                id="complaint-subject"
                type="text"
                maxLength={160}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Brief summary of your concern..."
                className="w-full px-3.5 py-2 text-sm rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div>
              <label htmlFor="complaint-description" className="block text-xs font-medium text-slate-700 mb-1.5">
                Details
              </label>
              <textarea
                id="complaint-description"
                rows={4}
                maxLength={4000}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what happened, relevant dates or interviews, and how the Team Lead can help..."
                className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
              <span className="text-xs text-slate-500">
                Routed directly to leadership · Only your assigned recruiter can see this record.
              </span>
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
              >
                <Send className="w-4 h-4" />
                {submitting ? 'Submitting...' : 'Submit Complaint to Team Lead'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Complaints List */}
      <div className="space-y-4">
        <h3 className="font-display text-sm font-semibold text-slate-900">
          {user.role === 'candidate'
            ? `My Submitted Complaints (${complaints.length})`
            : `Complaints Queue (${complaints.length})`}
        </h3>

        {loading ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
            Loading complaints...
          </div>
        ) : complaints.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center text-sm text-slate-500">
            {user.role === 'candidate'
              ? 'You have not submitted any complaints.'
              : user.role === 'recruiter'
              ? 'No complaints have been escalated for your assigned candidates.'
              : 'No candidate complaints match this filter.'}
          </div>
        ) : (
          complaints.map((cmp) => {
            const statusMeta = STATUS_STYLES[cmp.status] || STATUS_STYLES.open;
            const priorityMeta = PRIORITY_STYLES[cmp.priority] || PRIORITY_STYLES.normal;
            const draft = drafts[cmp.id] || {
              status: cmp.status,
              response: cmp.team_lead_response || '',
              visibleToRecruiter: cmp.visible_to_recruiter === 1,
            };

            return (
              <div key={cmp.id} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="space-y-1.5 min-w-0">
                    <div className="flex items-center flex-wrap gap-2 text-xs">
                      <span className={statusMeta.textClass}>{statusMeta.label}</span>
                      <span className="text-slate-300" aria-hidden="true">·</span>
                      <span className={priorityMeta.textClass}>{priorityMeta.label}</span>
                      <span className="text-slate-300" aria-hidden="true">·</span>
                      <span className="text-slate-600">{CATEGORY_LABELS[cmp.category] || cmp.category}</span>
                      <span className="text-slate-300" aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums text-slate-500">
                        {formatDateTimeInTz(cmp.created_at, user.timezone)}
                      </span>
                    </div>

                    <h4 className="font-display text-base font-semibold text-slate-900">{cmp.subject}</h4>

                    <div className="flex items-center flex-wrap gap-3 text-xs text-slate-600 pt-0.5">
                      <span className="inline-flex items-center gap-1.5">
                        <Avatar name={cmp.candidate_name} src={cmp.candidate_avatar} size="xs" />
                        <strong className="text-slate-800">{cmp.candidate_name}</strong>
                        {cmp.candidate_technology ? ` (${cmp.candidate_technology})` : ''}
                      </span>
                      {cmp.recruiter_name && (
                        <>
                          <span className="text-slate-300" aria-hidden="true">·</span>
                          <span className="inline-flex items-center gap-1">
                            <UserCheck className="w-3.5 h-3.5 text-slate-400" />
                            Assigned Recruiter: <strong className="text-slate-800">{cmp.recruiter_name}</strong>
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Quick Chat Actions */}
                  <div className="flex items-center gap-2 shrink-0 flex-wrap">
                    {user.role === 'team_lead' && onOpenCandidateChat && (
                      <button
                        type="button"
                        onClick={() => onOpenCandidateChat(cmp.candidate_id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 cursor-pointer"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        Open Shared Chat
                      </button>
                    )}
                    {user.role === 'team_lead' && onOpenDirectChat && (
                      <button
                        type="button"
                        onClick={() => onOpenDirectChat(cmp.candidate_id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 cursor-pointer"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        Chat Candidate Directly
                      </button>
                    )}
                    {user.role === 'recruiter' && onOpenCandidateChat && (
                      <button
                        type="button"
                        onClick={() => onOpenCandidateChat(cmp.candidate_id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 cursor-pointer"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        Open Candidate Chat
                      </button>
                    )}
                  </div>
                </div>

                <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed bg-slate-50 border border-slate-200/80 rounded-lg p-3.5">
                  {cmp.description}
                </p>

                {/* Read-only Team Lead response for Candidate & Recruiter */}
                {user.role !== 'team_lead' && cmp.team_lead_response && (
                  <div className="rounded-lg bg-blue-50/70 border border-blue-200/80 p-3.5 text-xs">
                    <div className="font-semibold text-blue-950 mb-1">Team Lead Response</div>
                    <p className="text-blue-900 whitespace-pre-wrap leading-relaxed">{cmp.team_lead_response}</p>
                  </div>
                )}

                {/* Team Lead Management Controls */}
                {user.role === 'team_lead' && (
                  <div className="border-t border-slate-200 pt-4 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div>
                        <label
                          htmlFor={`cmp-status-${cmp.id}`}
                          className="block text-xs font-medium text-slate-700 mb-1"
                        >
                          Review Status
                        </label>
                        <select
                          id={`cmp-status-${cmp.id}`}
                          value={draft.status}
                          onChange={(e) => updateDraft(cmp.id, { status: e.target.value })}
                          className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                        >
                          <option value="open">Open</option>
                          <option value="in_review">Under Review</option>
                          <option value="resolved">Resolved</option>
                          <option value="dismissed">Dismissed</option>
                        </select>
                      </div>

                      <div className="md:col-span-2 flex items-end">
                        <label className="inline-flex items-center gap-2 text-xs text-slate-700 cursor-pointer select-none py-2">
                          <input
                            type="checkbox"
                            checked={draft.visibleToRecruiter}
                            onChange={(e) =>
                              updateDraft(cmp.id, { visibleToRecruiter: e.target.checked })
                            }
                            className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                          />
                          {draft.visibleToRecruiter ? (
                            <Eye className="w-3.5 h-3.5 text-emerald-600" />
                          ) : (
                            <EyeOff className="w-3.5 h-3.5 text-slate-400" />
                          )}
                          <span>
                            Visible to Assigned Recruiter ({cmp.recruiter_name || 'Unassigned'}) only
                          </span>
                        </label>
                      </div>
                    </div>

                    <div>
                      <label
                        htmlFor={`cmp-resp-${cmp.id}`}
                        className="block text-xs font-medium text-slate-700 mb-1"
                      >
                        Team Lead Resolution / Response Note
                      </label>
                      <textarea
                        id={`cmp-resp-${cmp.id}`}
                        rows={2}
                        value={draft.response}
                        onChange={(e) => updateDraft(cmp.id, { response: e.target.value })}
                        placeholder="Write your official follow-up response to the candidate and recruiter..."
                        className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <span className="text-[11px] text-slate-500">
                        {draft.visibleToRecruiter
                          ? `Shown only to Team Lead and ${cmp.recruiter_name || 'assigned recruiter'}.`
                          : 'Restricted strictly to Team Lead (hidden from assigned recruiter).'}
                      </span>
                      <button
                        type="button"
                        disabled={savingId === cmp.id}
                        onClick={() => handleTeamLeadSave(cmp.id)}
                        className="px-3.5 py-1.5 text-xs font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
                      >
                        {savingId === cmp.id ? 'Saving...' : 'Save Review Update'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
