import React, { useEffect, useRef, useState } from 'react';
import { Download, FileText, Lock, Upload } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { LoggedInUser } from './LoginView';
import { US_TIMEZONES, formatBytes, formatDateTimeInTz } from '../lib/format';

interface DocumentsAndProfileViewProps {
  user: LoggedInUser;
  mode: 'documents' | 'profile';
  onUserUpdated: () => void;
}

export function DocumentsAndProfileView({ user, mode, onUserUpdated }: DocumentsAndProfileViewProps) {
  const [documents, setDocuments] = useState<any[]>([]);
  const [profile, setProfile] = useState<any | null>(null);
  const [uploading, setUploading] = useState(false);
  const [category, setCategory] = useState<'resume' | 'document'>('resume');
  const [versionLabel, setVersionLabel] = useState('v4');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  const [form, setForm] = useState({
    fullName: user.fullName,
    phone: user.phone || '',
    timezone: user.timezone,
    location: '',
    technology: '',
    experienceYears: '0',
    visaStatus: '',
    hourlyRate: '',
    availabilitySummary: '',
    linkedinUrl: '',
  });

  const loadData = async () => {
    setError('');
    try {
      const [docRes, candRes] = await Promise.all([
        apiRequest<{ documents: any[] }>(`/api/documents/${user.id}`),
        apiRequest<{ candidate: any }>(`/api/candidates/${user.id}`),
      ]);
      setDocuments(docRes.documents);
      setProfile(candRes.candidate);
      setForm({
        fullName: candRes.candidate.full_name || '',
        phone: candRes.candidate.phone || '',
        timezone: candRes.candidate.timezone || 'America/New_York',
        location: candRes.candidate.location || '',
        technology: candRes.candidate.technology || '',
        experienceYears: String(candRes.candidate.experience_years ?? 0),
        visaStatus: candRes.candidate.visa_status || '',
        hourlyRate: candRes.candidate.hourly_rate || '',
        availabilitySummary: candRes.candidate.availability_summary || '',
        linkedinUrl: candRes.candidate.linkedin_url || '',
      });
    } catch (err: any) {
      setError(err.message || 'Failed to load data.');
    }
  };

  useEffect(() => {
    loadData();
  }, [mode]);

  const handleUpload = async (file: File) => {
    setUploading(true);
    setError('');
    setNotice('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('candidateId', user.id);
      fd.append('category', category);
      fd.append('versionLabel', versionLabel.trim() || 'v1');
      await apiRequest('/api/uploads', { method: 'POST', body: fd, isFormData: true });
      setNotice(`Uploaded ${file.name} securely to private vault.`);
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await apiRequest(`/api/candidates/${user.id}`, {
        method: 'PATCH',
        body: {
          ...form,
          experienceYears: Number(form.experienceYears) || 0,
        },
      });
      setNotice('Profile changes saved.');
      onUserUpdated();
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Could not update profile.');
    } finally {
      setSaving(false);
    }
  };

  if (mode === 'documents') {
    return (
      <div className="space-y-6 max-w-5xl">
        <div>
          <h2 className="font-display text-xl font-semibold text-slate-900">My Documents & Resumes</h2>
          <p className="text-sm text-slate-600 mt-0.5">
            Files are stored privately with short-lived signed download URLs accessible only to you, your assigned recruiter, and authorized Team Leads.
          </p>
        </div>

        {error && <div role="alert" className="px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}
        {notice && <div className="px-4 py-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">{notice}</div>}

        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <h3 className="font-display text-sm font-semibold text-slate-900">Upload New Document or Resume Version</h3>
          <div className="mt-4 flex flex-wrap items-end gap-4">
            <div>
              <label htmlFor="doc-cat" className="block text-xs font-medium text-slate-700 mb-1">Document Type</label>
              <select
                id="doc-cat"
                value={category}
                onChange={(e) => setCategory(e.target.value as any)}
                className="px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
              >
                <option value="resume">Resume</option>
                <option value="document">Supporting Document</option>
              </select>
            </div>
            <div>
              <label htmlFor="doc-ver" className="block text-xs font-medium text-slate-700 mb-1">Version Label</label>
              <input
                id="doc-ver"
                value={versionLabel}
                onChange={(e) => setVersionLabel(e.target.value)}
                placeholder="e.g., v4 (Updated)"
                className="px-3 py-2 text-sm rounded-lg border border-slate-300"
              />
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleUpload(f);
                e.target.value = '';
              }}
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              {uploading ? 'Uploading...' : 'Select File (PDF, DOC, DOCX)'}
            </button>
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500 text-left">
                <th className="px-5 py-3 font-medium">File Name</th>
                <th className="px-5 py-3 font-medium">Type & Version</th>
                <th className="px-5 py-3 font-medium">Uploaded</th>
                <th className="px-5 py-3 font-medium text-right">Size</th>
                <th className="px-5 py-3 font-medium text-right">Download</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {documents.map((d) => (
                <tr key={d.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2.5">
                      <FileText className="w-4 h-4 text-slate-400 shrink-0" />
                      <span className="font-medium text-slate-900">{d.original_name}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-xs text-slate-600 capitalize">
                    {d.category} · {d.version_label} · <span className="text-emerald-700">{d.status}</span>
                  </td>
                  <td className="px-5 py-3.5 text-xs font-mono tabular-nums text-slate-500">
                    {formatDateTimeInTz(d.created_at, user.timezone)}
                  </td>
                  <td className="px-5 py-3.5 text-right text-xs font-mono tabular-nums text-slate-600">
                    {formatBytes(d.size_bytes)}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <a
                      href={d.signedUrl}
                      download={d.original_name}
                      className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Download
                    </a>
                  </td>
                </tr>
              ))}
              {documents.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-5 py-8 text-center text-sm text-slate-500">
                    No documents uploaded yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h2 className="font-display text-xl font-semibold text-slate-900">My Profile</h2>
        <p className="text-sm text-slate-600 mt-0.5">
          Keep your contact details, skill set, and work authorization current. Assigned recruiter changes are managed by Team Leads.
        </p>
      </div>

      {error && <div role="alert" className="px-4 py-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>}
      {notice && <div className="px-4 py-3 rounded-lg bg-emerald-50 border border-emerald-200 text-sm text-emerald-800">{notice}</div>}

      <form onSubmit={handleSaveProfile} className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="pf-name" className="block text-xs font-medium text-slate-700 mb-1">Full Name</label>
            <input id="pf-name" required value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300" />
          </div>
          <div>
            <label htmlFor="pf-email" className="block text-xs font-medium text-slate-700 mb-1">Email Address (Read-only)</label>
            <input id="pf-email" disabled value={user.email} className="w-full px-3 py-2 text-sm rounded-lg border border-slate-200 bg-slate-50 text-slate-500" />
          </div>
          <div>
            <label htmlFor="pf-phone" className="block text-xs font-medium text-slate-700 mb-1">Phone Number</label>
            <input id="pf-phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300" />
          </div>
          <div>
            <label htmlFor="pf-loc" className="block text-xs font-medium text-slate-700 mb-1">Current Location</label>
            <input id="pf-loc" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300" />
          </div>
          <div>
            <label htmlFor="pf-tech" className="block text-xs font-medium text-slate-700 mb-1">Technology / Skill Set</label>
            <input id="pf-tech" value={form.technology} onChange={(e) => setForm({ ...form, technology: e.target.value })} className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300" />
          </div>
          <div>
            <label htmlFor="pf-exp" className="block text-xs font-medium text-slate-700 mb-1">Total Experience (Years)</label>
            <input id="pf-exp" type="number" step="0.5" value={form.experienceYears} onChange={(e) => setForm({ ...form, experienceYears: e.target.value })} className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300" />
          </div>
          <div>
            <label htmlFor="pf-visa" className="block text-xs font-medium text-slate-700 mb-1">Visa / Work Authorization</label>
            <input id="pf-visa" value={form.visaStatus} onChange={(e) => setForm({ ...form, visaStatus: e.target.value })} className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300" />
          </div>
          <div>
            <label htmlFor="pf-rate" className="block text-xs font-medium text-slate-700 mb-1">Target Rate (if applicable)</label>
            <input id="pf-rate" value={form.hourlyRate} onChange={(e) => setForm({ ...form, hourlyRate: e.target.value })} className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300" />
          </div>
          <div>
            <label htmlFor="pf-tz" className="block text-xs font-medium text-slate-700 mb-1">Timezone</label>
            <select id="pf-tz" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white">
              {US_TIMEZONES.map((tz) => <option key={tz.id} value={tz.id}>{tz.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="pf-rec" className="block text-xs font-medium text-slate-700 mb-1">
              Assigned Recruiter (Managed by Team Lead)
            </label>
            <div className="flex items-center gap-2 px-3 py-2 text-sm rounded-lg border border-slate-200 bg-slate-50 text-slate-600">
              <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span>{profile?.assigned_recruiter_name || 'Unassigned'}</span>
            </div>
          </div>
        </div>

        <div className="pt-2 flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="px-5 py-2.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
          >
            {saving ? 'Saving...' : 'Save Profile'}
          </button>
        </div>
      </form>
    </div>
  );
}
