import React, { useEffect, useState } from 'react';
import { ArrowRight, Lock, MessageSquare, ShieldCheck, Calendar, PhoneCall } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { Avatar } from './Avatar';
import { roleLabel } from '../lib/format';

export interface LoggedInUser {
  id: string;
  email: string;
  role: 'candidate' | 'recruiter' | 'team_lead';
  fullName: string;
  phone?: string;
  avatarUrl?: string;
  timezone: string;
}

interface SandboxPersona {
  id: string;
  email: string;
  role: 'candidate' | 'recruiter' | 'team_lead';
  full_name: string;
  avatar_url: string;
  timezone: string;
  technology?: string;
  title?: string;
}

interface LoginViewProps {
  onAuthenticated: (token: string, user: LoggedInUser) => void;
}

export function LoginView({ onAuthenticated }: LoginViewProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [personas, setPersonas] = useState<SandboxPersona[]>([]);
  const [sandboxEnabled, setSandboxEnabled] = useState(false);
  const [loadingPersonaId, setLoadingPersonaId] = useState<string | null>(null);

  useEffect(() => {
    apiRequest<{ enabled: boolean; personas: SandboxPersona[] }>('/api/auth/sandbox-personas')
      .then((res) => {
        setSandboxEnabled(res.enabled);
        setPersonas(res.personas || []);
      })
      .catch(() => {
        setSandboxEnabled(false);
      });
  }, []);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password) {
      setError('Enter both your work email and password.');
      return;
    }
    setSubmitting(true);
    try {
      const res = await apiRequest<{ token: string; user: LoggedInUser }>('/api/auth/login', {
        method: 'POST',
        body: { email: email.trim(), password },
      });
      onAuthenticated(res.token, res.user);
    } catch (err: any) {
      setError(err.message || 'Sign in failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSandboxSignIn = async (personaId: string) => {
    setError('');
    setLoadingPersonaId(personaId);
    try {
      const res = await apiRequest<{ token: string; user: LoggedInUser }>('/api/auth/sandbox-signin', {
        method: 'POST',
        body: { userId: personaId },
      });
      onAuthenticated(res.token, res.user);
    } catch (err: any) {
      setError(err.message || 'Unable to sign in.');
    } finally {
      setLoadingPersonaId(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row">
      {/* Left Enterprise Brand Column */}
      <div className="lg:w-[44%] bg-slate-900 text-slate-100 p-8 lg:p-14 flex flex-col justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center text-white">
              <MessageSquare className="w-5 h-5" />
            </div>
            <span className="font-display text-lg font-semibold tracking-tight text-white">
              Recruitment Messenger
            </span>
          </div>

          <div className="mt-12 max-w-md">
            <h1 className="font-display text-3xl lg:text-4xl font-semibold tracking-tight text-white leading-tight [text-wrap:balance]">
              Organized, private communication for US IT staffing teams.
            </h1>
            <p className="mt-4 text-slate-300 text-sm leading-relaxed">
              Unify private candidate-recruiter messaging, timezone-accurate interview availability,
              verified resume sharing, WebRTC calling, and Team Lead oversight in one secure workspace.
            </p>
          </div>

          <div className="mt-10 space-y-5 border-t border-slate-800 pt-8 max-w-md">
            <div className="flex items-start gap-3.5">
              <ShieldCheck className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-sm font-medium text-white">Strict Assignment Isolation</h2>
                <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                  Every candidate connects strictly with their primary assigned recruiter while Team Leads retain transparent, audited oversight.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3.5">
              <Calendar className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-sm font-medium text-white">US Timezone Availability Engine</h2>
                <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                  Recurring weekly schedules and daily custom overrides automatically convert across ET, CT, MT, and PT with conflict prevention.
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3.5">
              <PhoneCall className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-sm font-medium text-white">Direct Audio, Video & Private Files</h2>
                <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                  In-app WebRTC calling, voice notes, and short-lived signed downloads keep resumes and interviews organized.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-12 pt-6 border-t border-slate-800 text-xs text-slate-400 flex items-center justify-between">
          <span>BenchBridge Staffing Operations</span>
          <span>Role-Based Access Control</span>
        </div>
      </div>

      {/* Right Sign-In & Role Access Column */}
      <div className="flex-1 flex items-center justify-center p-6 lg:p-14">
        <div className="w-full max-w-lg">
          <div className="bg-white border border-slate-200 rounded-xl p-6 lg:p-8">
            <h2 className="font-display text-2xl font-semibold text-slate-900">Sign in to your account</h2>
            <p className="text-sm text-slate-600 mt-1">
              Enter your assigned credentials to open your Candidate, Recruiter, or Team Lead portal.
            </p>

            {error && (
              <div
                role="alert"
                className="mt-4 px-3.5 py-2.5 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700"
              >
                {error}
              </div>
            )}

            <form onSubmit={handlePasswordSubmit} className="mt-6 space-y-4">
              <div>
                <label htmlFor="login-email" className="block text-sm font-medium text-slate-700 mb-1.5">
                  Work Email
                </label>
                <input
                  id="login-email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@benchbridge.io"
                  className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                />
              </div>

              <div>
                <label htmlFor="login-password" className="block text-sm font-medium text-slate-700 mb-1.5">
                  Password
                </label>
                <input
                  id="login-password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full px-3.5 py-2.5 text-sm rounded-lg border border-slate-300 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                />
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-60 transition-colors cursor-pointer"
              >
                <Lock className="w-4 h-4" />
                {submitting ? 'Signing in...' : 'Sign In'}
              </button>
            </form>
          </div>

          {/* Interactive Role Evaluation Panel */}
          {sandboxEnabled && personas.length > 0 && (
            <div className="mt-6 bg-white border border-slate-200 rounded-xl p-6">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-sm font-semibold text-slate-900">
                  Workspace Role Quick Access
                </h3>
                <span className="text-xs text-slate-500">Live Server Sessions</span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Switch between seeded Team Lead, Recruiter, and Candidate accounts to test real permissions and isolation.
              </p>

              <div className="mt-4 divide-y divide-slate-100">
                {personas.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    disabled={loadingPersonaId !== null}
                    onClick={() => handleSandboxSignIn(p.id)}
                    className="w-full py-2.5 px-2 -mx-2 rounded-lg flex items-center justify-between gap-3 text-left hover:bg-slate-50 transition-colors cursor-pointer disabled:opacity-60"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Avatar name={p.full_name} src={p.avatar_url} size="sm" />
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-slate-900 truncate">{p.full_name}</div>
                        <div className="text-xs text-slate-500 truncate">
                          {roleLabel(p.role)}
                          <span aria-hidden="true"> · </span>
                          {p.role === 'candidate'
                            ? p.technology || 'IT Consultant'
                            : p.title || 'Bench Operations'}
                        </div>
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 whitespace-nowrap shrink-0">
                      {loadingPersonaId === p.id ? 'Opening...' : 'Open'}
                      <ArrowRight className="w-3.5 h-3.5" />
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
