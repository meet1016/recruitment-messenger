import React, { useEffect, useState } from 'react';
import {
  Download,
  GitCompareArrows,
  KeyRound,
  MessageSquare,
  Plus,
  Search,
  UserCheck,
  UserX,
  X,
} from 'lucide-react';
import { apiRequest } from '../lib/api';
import { Avatar } from './Avatar';
import { LoggedInUser } from './LoginView';
import {
  US_TIMEZONES,
  availabilityMeta,
  formatDateTimeInTz,
} from '../lib/format';

interface DirectoryViewProps {
  user: LoggedInUser;
  mode: 'candidates' | 'recruiters' | 'assignments';
  onOpenChatForCandidate: (candidateId: string) => void;
}

export function DirectoryView({ user, mode, onOpenChatForCandidate }: DirectoryViewProps) {
  const [candidates, setCandidates] = useState<any[]>([]);
  const [recruiters, setRecruiters] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [credentialsBanner, setCredentialsBanner] = useState<{
    title: string;
    email?: string;
    password: string;
  } | null>(null);

  // Selected candidate profile drawer
  const [profileDetail, setProfileDetail] = useState<any | null>(null);

  // Create Candidate Modal
  const [showCreateCand, setShowCreateCand] = useState(false);
  const [candForm, setCandForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    timezone: 'America/New_York',
    location: '',
    technology: '',
    experienceYears: '6',
    visaStatus: 'H-1B',
    hourlyRate: '$85/hr C2C',
    recruiterId: '',
  });

  // Create Recruiter Modal
  const [showCreateRec, setShowCreateRec] = useState(false);
  const [recForm, setRecForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    timezone: 'America/New_York',
    title: 'Technical Recruiter',
    department: 'US IT Bench Sales',
    location: 'Dallas, TX',
  });

  // Reassignment Form
  const [reassignCandId, setReassignCandId] = useState('');
  const [reassignRecId, setReassignRecId] = useState('');
  const [reassignReason, setReassignReason] = useState('Account coverage rebalancing');
  const [reassignBusy, setReassignBusy] = useState(false);

  const loadAll = async () => {
    setError('');
    try {
      const candRes = await apiRequest<{ candidates: any[] }>(
        `/api/candidates${search ? `?q=${encodeURIComponent(search)}` : ''}`
      );
      setCandidates(candRes.candidates);

      if (user.role === 'team_lead') {
        const [recRes, asgRes] = await Promise.all([
          apiRequest<{ recruiters: any[] }>('/api/recruiters'),
          apiRequest<{ assignments: any[] }>('/api/assignments'),
        ]);
        setRecruiters(recRes.recruiters);
        setAssignments(asgRes.assignments);

        if (!candForm.recruiterId && recRes.recruiters.length > 0) {
          setCandForm((f) => ({ ...f, recruiterId: recRes.recruiters[0].id }));
        }
        if (!reassignCandId && candRes.candidates.length > 0) {
          setReassignCandId(candRes.candidates[0].id);
        }
        if (!reassignRecId && recRes.recruiters.length > 0) {
          setReassignRecId(recRes.recruiters[0].id);
        }
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load directory.');
    }
  };

  useEffect(() => {
    loadAll();
  }, [mode, search]);

  const openCandidateProfile = async (candId: string) => {
    try {
      const [detail, docs] = await Promise.all([
        apiRequest(`/api/candidates/${candId}`),
        apiRequest(`/api/documents/${candId}`),
      ]);
      setProfileDetail({ ...detail, signedDocuments: docs.documents });
    } catch (err: any) {
      setError(err.message || 'Unable to load candidate profile.');
    }
  };

  const handleCreateCandidate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const res = await apiRequest('/api/candidates', { method: 'POST', body: candForm });
      setShowCreateCand(false);
      setCredentialsBanner({
        title: `Candidate account created for ${candForm.fullName}`,
        email: res.initialCredentials.email,
        password: res.initialCredentials.temporaryPassword,
      });
      setCandForm({
        ...candForm,
        fullName: '',
        email: '',
        phone: '',
        location: '',
        technology: '',
      });
      await loadAll();
    } catch (err: any) {
      setError(err.message || 'Could not create candidate.');
    }
  };

  const handleCreateRecruiter = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const res = await apiRequest('/api/recruiters', { method: 'POST', body: recForm });
      setShowCreateRec(false);
      setCredentialsBanner({
        title: `Recruiter account created for ${recForm.fullName}`,
        email: res.initialCredentials.email,
        password: res.initialCredentials.temporaryPassword,
      });
      setRecForm({ ...recForm, fullName: '', email: '', phone: '' });
      await loadAll();
    } catch (err: any) {
      setError(err.message || 'Could not create recruiter.');
    }
  };

  const handleToggleRecruiterActive = async (rec: any) => {
    try {
      await apiRequest(`/api/recruiters/${rec.id}`, {
        method: 'PATCH',
        body: { isActive: rec.is_active !== 1 },
      });
      setNotice(`${rec.full_name} account ${rec.is_active === 1 ? 'deactivated' : 'activated'}.`);
      await loadAll();
    } catch (err: any) {
      setError(err.message || 'Action failed.');
    }
  };

  const handleResetRecruiterPassword = async (rec: any) => {
    try {
      const res = await apiRequest<{ temporaryPassword: string }>(`/api/recruiters/${rec.id}/reset-password`, {
        method: 'POST',
      });
      setCredentialsBanner({
        title: `Temporary password generated for ${rec.full_name}`,
        email: rec.email,
        password: res.temporaryPassword,
      });
    } catch (err: any) {
      setError(err.message || 'Password reset failed.');
    }
  };

  const handleReassign = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setReassignBusy(true);
    try {
      await apiRequest('/api/assignments/reassign', {
        method: 'POST',
        body: {
          candidateId: reassignCandId,
          newRecruiterId: reassignRecId,
          reason: reassignReason,
        },
      });
      setNotice(
        'Candidate reassigned successfully. Previous recruiter active access was revoked immediately and the historical assignment record has been preserved.'
      );
      await loadAll();
    } catch (err: any) {
      setError(err.message || 'Reassignment failed.');
    } finally {
      setReassignBusy(false);
    }
  };

  return (
    <div className="space-y-6 max-w-7xl">
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
      {credentialsBanner && (
        <div className="p-4 rounded-xl bg-blue-50 border border-blue-200 flex items-start justify-between gap-4">
          <div className="text-sm text-blue-950">
            <div className="font-semibold">{credentialsBanner.title}</div>
            <div className="mt-1 font-mono text-xs">
              Email: {credentialsBanner.email} · Initial Password: <strong>{credentialsBanner.password}</strong>
            </div>
            <div className="text-xs text-blue-800 mt-1">
              Copy and deliver these login instructions securely. This temporary password is only displayed once.
            </div>
          </div>
          <button
            type="button"
            onClick={() => setCredentialsBanner(null)}
            aria-label="Dismiss credentials banner"
            className="p-1 text-blue-600 hover:text-blue-900"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* =================================================================== */}
      {/* CANDIDATES VIEW */}
      {/* =================================================================== */}
      {mode === 'candidates' && (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-xl font-semibold text-slate-900">
                {user.role === 'team_lead' ? 'All Organization Candidates' : 'My Assigned Candidates'}
              </h2>
              <p className="text-sm text-slate-600 mt-0.5">
                {user.role === 'team_lead'
                  ? 'Manage candidate profiles, documents, availability, and recruiter assignments.'
                  : 'Strictly scoped to candidates actively assigned to your bench.'}
              </p>
            </div>
            {user.role === 'team_lead' && (
              <button
                type="button"
                onClick={() => setShowCreateCand(true)}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                Create Candidate
              </button>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <div className="relative max-w-md">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                aria-label="Search candidates"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, technology, location, visa..."
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500 text-left">
                    <th className="px-5 py-3 font-medium">Candidate</th>
                    <th className="px-5 py-3 font-medium">Skills & Experience</th>
                    <th className="px-5 py-3 font-medium">Visa & Location</th>
                    <th className="px-5 py-3 font-medium">Today</th>
                    {user.role === 'team_lead' && <th className="px-5 py-3 font-medium">Assigned Recruiter</th>}
                    <th className="px-5 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {candidates.map((c) => {
                    const av = availabilityMeta(c.availabilityStatus);
                    return (
                      <tr key={c.id} className="hover:bg-slate-50">
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3">
                            <Avatar name={c.full_name} src={c.avatar_url} size="sm" online={c.online} />
                            <div>
                              <div className="font-medium text-slate-900">{c.full_name}</div>
                              <div className="text-xs text-slate-500">{c.email}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="text-slate-800">{c.technology}</div>
                          <div className="text-xs text-slate-500 font-mono tabular-nums">
                            {c.experience_years} yrs · {c.hourly_rate || 'Rate TBD'}
                          </div>
                        </td>
                        <td className="px-5 py-3.5 text-xs text-slate-600">
                          <div className="font-medium text-slate-800">{c.visa_status}</div>
                          <div>{c.location}</div>
                        </td>
                        <td className="px-5 py-3.5 text-xs whitespace-nowrap">
                          <span className={av.textClass}>{av.label}</span>
                        </td>
                        {user.role === 'team_lead' && (
                          <td className="px-5 py-3.5 text-xs text-slate-700 whitespace-nowrap">
                            {c.assigned_recruiter_name || 'Unassigned'}
                          </td>
                        )}
                        <td className="px-5 py-3.5 text-right whitespace-nowrap space-x-2">
                          <button
                            type="button"
                            onClick={() => openCandidateProfile(c.id)}
                            className="px-2.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100 cursor-pointer"
                          >
                            Profile
                          </button>
                          <button
                            type="button"
                            onClick={() => onOpenChatForCandidate(c.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 cursor-pointer"
                          >
                            <MessageSquare className="w-3.5 h-3.5" />
                            Chat
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  {candidates.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-5 py-10 text-center text-sm text-slate-500">
                        No candidates found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* =================================================================== */}
      {/* RECRUITERS VIEW (Team Lead Only) */}
      {/* =================================================================== */}
      {mode === 'recruiters' && user.role === 'team_lead' && (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-xl font-semibold text-slate-900">Recruiter Accounts</h2>
              <p className="text-sm text-slate-600 mt-0.5">
                Provision individual recruiter logins, reset passwords, manage account status, and monitor workload.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowCreateRec(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              Create Recruiter
            </button>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500 text-left">
                    <th className="px-5 py-3 font-medium">Recruiter</th>
                    <th className="px-5 py-3 font-medium">Practice / Location</th>
                    <th className="px-5 py-3 font-medium text-right">Assigned Candidates</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium text-right">Admin Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recruiters.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3.5">
                        <div className="flex items-center gap-3">
                          <Avatar name={r.full_name} src={r.avatar_url} size="sm" />
                          <div>
                            <div className="font-medium text-slate-900">{r.full_name}</div>
                            <div className="text-xs text-slate-500">{r.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-xs text-slate-600">
                        <div className="font-medium text-slate-800">{r.department}</div>
                        <div>{r.location} · {r.timezone}</div>
                      </td>
                      <td className="px-5 py-3.5 text-right font-mono tabular-nums text-slate-900">
                        {r.assigned_count}
                      </td>
                      <td className="px-5 py-3.5 text-xs">
                        <span className={r.is_active === 1 ? 'text-emerald-700 font-medium' : 'text-red-700 font-medium'}>
                          {r.is_active === 1 ? 'Active' : 'Deactivated'}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-right whitespace-nowrap space-x-2">
                        <button
                          type="button"
                          onClick={() => handleResetRecruiterPassword(r)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100 cursor-pointer"
                        >
                          <KeyRound className="w-3.5 h-3.5" />
                          Reset Password
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleRecruiterActive(r)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100 cursor-pointer"
                        >
                          {r.is_active === 1 ? <UserX className="w-3.5 h-3.5" /> : <UserCheck className="w-3.5 h-3.5" />}
                          {r.is_active === 1 ? 'Deactivate' : 'Activate'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* =================================================================== */}
      {/* ASSIGNMENTS & REASSIGNMENT AUDIT TRAIL (Team Lead Only) */}
      {/* =================================================================== */}
      {mode === 'assignments' && user.role === 'team_lead' && (
        <>
          <div>
            <h2 className="font-display text-xl font-semibold text-slate-900">
              Candidate Assignments & Audit History
            </h2>
            <p className="text-sm text-slate-600 mt-0.5">
              Every candidate has exactly one primary assigned recruiter. Reassigning immediately revokes the previous recruiter&apos;s workspace access while preserving full history.
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-6">
            <h3 className="font-display text-sm font-semibold text-slate-900 flex items-center gap-2">
              <GitCompareArrows className="w-4 h-4 text-blue-600" />
              Reassign Candidate to Recruiter
            </h3>
            <form onSubmit={handleReassign} className="mt-4 grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
              <div>
                <label htmlFor="asg-cand" className="block text-xs font-medium text-slate-700 mb-1">
                  Candidate
                </label>
                <select
                  id="asg-cand"
                  value={reassignCandId}
                  onChange={(e) => setReassignCandId(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
                >
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.full_name} (Current: {c.assigned_recruiter_name || 'None'})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="asg-rec" className="block text-xs font-medium text-slate-700 mb-1">
                  New Primary Recruiter
                </label>
                <select
                  id="asg-rec"
                  value={reassignRecId}
                  onChange={(e) => setReassignRecId(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
                >
                  {recruiters
                    .filter((r) => r.is_active === 1)
                    .map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.full_name}
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label htmlFor="asg-reason" className="block text-xs font-medium text-slate-700 mb-1">
                  Audit Reason
                </label>
                <input
                  id="asg-reason"
                  required
                  value={reassignReason}
                  onChange={(e) => setReassignReason(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300"
                />
              </div>
              <button
                type="submit"
                disabled={reassignBusy}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 whitespace-nowrap cursor-pointer"
              >
                {reassignBusy ? 'Reassigning...' : 'Reassign Candidate'}
              </button>
            </form>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200">
              <h3 className="font-display text-sm font-semibold text-slate-900">
                Complete Assignment History (Active & Historical)
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500 text-left">
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3 font-medium">Candidate</th>
                    <th className="px-5 py-3 font-medium">Recruiter</th>
                    <th className="px-5 py-3 font-medium">Reason</th>
                    <th className="px-5 py-3 font-medium">Assigned By & Timeline</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {assignments.map((a) => (
                    <tr key={a.id} className="hover:bg-slate-50">
                      <td className="px-5 py-3 text-xs whitespace-nowrap">
                        <span className={a.is_active === 1 ? 'text-emerald-700 font-medium' : 'text-slate-500'}>
                          {a.is_active === 1 ? 'Active' : 'Historical'}
                        </span>
                      </td>
                      <td className="px-5 py-3 font-medium text-slate-900">
                        {a.candidate_name}
                        <div className="text-xs font-normal text-slate-500">{a.technology}</div>
                      </td>
                      <td className="px-5 py-3 text-slate-800">{a.recruiter_name}</td>
                      <td className="px-5 py-3 text-xs text-slate-600">{a.reason}</td>
                      <td className="px-5 py-3 text-xs text-slate-500 font-mono tabular-nums">
                        <div>By {a.assigned_by_name} · {formatDateTimeInTz(a.assigned_at, user.timezone)}</div>
                        {a.unassigned_at && (
                          <div className="text-slate-400">
                            Ended {formatDateTimeInTz(a.unassigned_at, user.timezone)}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* Candidate Profile Drawer */}
      {profileDetail && (
        <div role="dialog" aria-modal="true" aria-label="Candidate profile details" className="fixed inset-0 z-50 bg-slate-900/50 flex justify-end">
          <div className="bg-white w-full max-w-lg h-full overflow-y-auto p-6 space-y-6 border-l border-slate-200">
            <div className="flex items-center justify-between pb-4 border-b border-slate-200">
              <div className="flex items-center gap-3">
                <Avatar name={profileDetail.candidate.full_name} src={profileDetail.candidate.avatar_url} size="md" />
                <div>
                  <h3 className="font-display text-base font-semibold text-slate-900">
                    {profileDetail.candidate.full_name}
                  </h3>
                  <div className="text-xs text-slate-500">{profileDetail.candidate.email}</div>
                </div>
              </div>
              <button type="button" onClick={() => setProfileDetail(null)} aria-label="Close profile drawer" className="p-1.5 text-slate-400 hover:text-slate-700">
                <X className="w-5 h-5" />
              </button>
            </div>

            <dl className="grid grid-cols-2 gap-4 text-xs">
              <div><dt className="text-slate-500">Technology</dt><dd className="font-medium text-slate-900 mt-0.5">{profileDetail.candidate.technology}</dd></div>
              <div><dt className="text-slate-500">Experience</dt><dd className="font-mono text-slate-900 mt-0.5">{profileDetail.candidate.experience_years} years</dd></div>
              <div><dt className="text-slate-500">Visa Status</dt><dd className="font-medium text-slate-900 mt-0.5">{profileDetail.candidate.visa_status}</dd></div>
              <div><dt className="text-slate-500">Location</dt><dd className="text-slate-900 mt-0.5">{profileDetail.candidate.location}</dd></div>
              <div><dt className="text-slate-500">Rate</dt><dd className="font-mono text-slate-900 mt-0.5">{profileDetail.candidate.hourly_rate || '—'}</dd></div>
              <div><dt className="text-slate-500">Assigned Recruiter</dt><dd className="text-slate-900 mt-0.5">{profileDetail.candidate.assigned_recruiter_name}</dd></div>
            </dl>

            <div className="border-t border-slate-200 pt-4">
              <h4 className="font-display text-xs font-semibold text-slate-900">Private Documents (Signed URLs)</h4>
              <div className="mt-2 space-y-2">
                {(profileDetail.signedDocuments || []).map((doc: any) => (
                  <a
                    key={doc.id}
                    href={doc.signedUrl}
                    download={doc.original_name}
                    className="flex items-center justify-between px-3 py-2 rounded-lg border border-slate-200 text-xs hover:bg-slate-50"
                  >
                    <span className="truncate font-medium text-slate-800">{doc.original_name}</span>
                    <Download className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                  </a>
                ))}
              </div>
            </div>

            {profileDetail.internalNotes && (
              <div className="border-t border-slate-200 pt-4">
                <h4 className="font-display text-xs font-semibold text-slate-900">Private Internal Notes</h4>
                <div className="mt-2 space-y-2">
                  {profileDetail.internalNotes.map((n: any) => (
                    <div key={n.id} className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs">
                      <p className="text-slate-800">{n.content}</p>
                      <div className="mt-1 text-slate-500">{n.author_name} · {formatDateTimeInTz(n.created_at, user.timezone)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create Candidate Modal */}
      {showCreateCand && (
        <div role="dialog" aria-modal="true" aria-label="Create candidate account" className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="font-display text-base font-semibold text-slate-900">Create Candidate Account</h3>
              <button type="button" onClick={() => setShowCreateCand(false)} aria-label="Close modal" className="p-1 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateCandidate} className="mt-4 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="nc-name" className="block text-xs font-medium text-slate-700 mb-1">Full Name</label>
                  <input id="nc-name" required value={candForm.fullName} onChange={(e) => setCandForm({ ...candForm, fullName: e.target.value })} className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300" />
                </div>
                <div>
                  <label htmlFor="nc-email" className="block text-xs font-medium text-slate-700 mb-1">Email</label>
                  <input id="nc-email" type="email" required value={candForm.email} onChange={(e) => setCandForm({ ...candForm, email: e.target.value })} className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="nc-tech" className="block text-xs font-medium text-slate-700 mb-1">Technology / Skill Set</label>
                  <input id="nc-tech" required value={candForm.technology} onChange={(e) => setCandForm({ ...candForm, technology: e.target.value })} placeholder="Python, AWS, FastAPI" className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300" />
                </div>
                <div>
                  <label htmlFor="nc-loc" className="block text-xs font-medium text-slate-700 mb-1">Location</label>
                  <input id="nc-loc" value={candForm.location} onChange={(e) => setCandForm({ ...candForm, location: e.target.value })} placeholder="Dallas, TX" className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label htmlFor="nc-exp" className="block text-xs font-medium text-slate-700 mb-1">Exp (yrs)</label>
                  <input id="nc-exp" type="number" step="0.5" value={candForm.experienceYears} onChange={(e) => setCandForm({ ...candForm, experienceYears: e.target.value })} className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300" />
                </div>
                <div>
                  <label htmlFor="nc-visa" className="block text-xs font-medium text-slate-700 mb-1">Visa Status</label>
                  <input id="nc-visa" value={candForm.visaStatus} onChange={(e) => setCandForm({ ...candForm, visaStatus: e.target.value })} className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300" />
                </div>
                <div>
                  <label htmlFor="nc-rate" className="block text-xs font-medium text-slate-700 mb-1">Rate</label>
                  <input id="nc-rate" value={candForm.hourlyRate} onChange={(e) => setCandForm({ ...candForm, hourlyRate: e.target.value })} className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="nc-tz" className="block text-xs font-medium text-slate-700 mb-1">Timezone</label>
                  <select id="nc-tz" value={candForm.timezone} onChange={(e) => setCandForm({ ...candForm, timezone: e.target.value })} className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white">
                    {US_TIMEZONES.map((tz) => <option key={tz.id} value={tz.id}>{tz.label}</option>)}
                  </select>
                </div>
                <div>
                  <label htmlFor="nc-rec" className="block text-xs font-medium text-slate-700 mb-1">Primary Assigned Recruiter</label>
                  <select id="nc-rec" required value={candForm.recruiterId} onChange={(e) => setCandForm({ ...candForm, recruiterId: e.target.value })} className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white">
                    {recruiters.filter((r) => r.is_active === 1).map((r) => (
                      <option key={r.id} value={r.id}>{r.full_name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setShowCreateCand(false)} className="px-4 py-2 text-sm rounded-lg border border-slate-200 cursor-pointer">Cancel</button>
                <button type="submit" className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 cursor-pointer">Create & Generate Credentials</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Create Recruiter Modal */}
      {showCreateRec && (
        <div role="dialog" aria-modal="true" aria-label="Create recruiter account" className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between pb-3 border-b border-slate-200">
              <h3 className="font-display text-base font-semibold text-slate-900">Create Recruiter Account</h3>
              <button type="button" onClick={() => setShowCreateRec(false)} aria-label="Close modal" className="p-1 text-slate-400">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreateRecruiter} className="mt-4 space-y-3">
              <div>
                <label htmlFor="nr-name" className="block text-xs font-medium text-slate-700 mb-1">Full Name</label>
                <input id="nr-name" required value={recForm.fullName} onChange={(e) => setRecForm({ ...recForm, fullName: e.target.value })} className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300" />
              </div>
              <div>
                <label htmlFor="nr-email" className="block text-xs font-medium text-slate-700 mb-1">Work Email</label>
                <input id="nr-email" type="email" required value={recForm.email} onChange={(e) => setRecForm({ ...recForm, email: e.target.value })} className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="nr-dept" className="block text-xs font-medium text-slate-700 mb-1">Department</label>
                  <input id="nr-dept" value={recForm.department} onChange={(e) => setRecForm({ ...recForm, department: e.target.value })} className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300" />
                </div>
                <div>
                  <label htmlFor="nr-tz" className="block text-xs font-medium text-slate-700 mb-1">Timezone</label>
                  <select id="nr-tz" value={recForm.timezone} onChange={(e) => setRecForm({ ...recForm, timezone: e.target.value })} className="w-full px-2.5 py-2 text-xs rounded-lg border border-slate-300 bg-white">
                    {US_TIMEZONES.map((tz) => <option key={tz.id} value={tz.id}>{tz.label}</option>)}
                  </select>
                </div>
              </div>
              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setShowCreateRec(false)} className="px-4 py-2 text-sm rounded-lg border border-slate-200 cursor-pointer">Cancel</button>
                <button type="submit" className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 cursor-pointer">Create Recruiter</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
