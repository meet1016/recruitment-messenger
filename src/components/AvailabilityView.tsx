import React, { useEffect, useState } from 'react';
import { CalendarClock, CheckCircle2, Plus, Trash2 } from 'lucide-react';
import { apiRequest } from '../lib/api';
import { Avatar } from './Avatar';
import { LoggedInUser } from './LoginView';
import {
  DAY_NAMES,
  US_TIMEZONES,
  availabilityMeta,
  todayIsoInTz,
} from '../lib/format';

interface AvailabilityViewProps {
  user: LoggedInUser;
  onScheduleInterviewForCandidate?: (candidateId: string) => void;
}

interface Slot {
  start: string;
  end: string;
}

interface WeeklyRuleItem {
  dayOfWeek: number;
  isAvailable: boolean;
  slots: Slot[];
}

export function AvailabilityView({ user, onScheduleInterviewForCandidate }: AvailabilityViewProps) {
  const [selectedDate, setSelectedDate] = useState(() => todayIsoInTz(user.timezone));
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Candidate editor state
  const [candidateTz, setCandidateTz] = useState(user.timezone);
  const [weeklyRules, setWeeklyRules] = useState<WeeklyRuleItem[]>([]);
  const [exceptions, setExceptions] = useState<any[]>([]);
  const [resolvedToday, setResolvedToday] = useState<any>(null);
  const [savingWeekly, setSavingWeekly] = useState(false);

  // Daily custom exception form
  const [excDate, setExcDate] = useState(() => todayIsoInTz(user.timezone));
  const [excUnavailable, setExcUnavailable] = useState(false);
  const [excSlots, setExcSlots] = useState<Slot[]>([{ start: '10:00', end: '13:00' }]);
  const [excNote, setExcNote] = useState('');
  const [savingExc, setSavingExc] = useState(false);

  // Recruiter / Team Lead overview state
  const [overviewItems, setOverviewItems] = useState<any[]>([]);
  const [recruiters, setRecruiters] = useState<any[]>([]);
  const [recruiterFilter, setRecruiterFilter] = useState('');
  const [techFilter, setTechFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');

  const loadCandidateData = async () => {
    setError('');
    try {
      const res = await apiRequest(`/api/availability/${user.id}?date=${encodeURIComponent(selectedDate)}`);
      setCandidateTz(res.candidateTimezone);
      const byDay = new Map<number, WeeklyRuleItem>();
      for (let d = 0; d <= 6; d++) {
        byDay.set(d, { dayOfWeek: d, isAvailable: false, slots: [] });
      }
      for (const r of res.weeklyRules || []) {
        byDay.set(r.dayOfWeek, r);
      }
      // Order Monday (1) .. Saturday (6), Sunday (0)
      const ordered = [1, 2, 3, 4, 5, 6, 0].map((d) => byDay.get(d)!);
      setWeeklyRules(ordered);
      setExceptions(res.dailyExceptions || []);
      setResolvedToday(res);
    } catch (err: any) {
      setError(err.message || 'Failed to load availability.');
    }
  };

  const loadOverviewData = async () => {
    setError('');
    try {
      const params = new URLSearchParams({ date: selectedDate });
      if (recruiterFilter) params.set('recruiterId', recruiterFilter);
      if (techFilter.trim()) params.set('technology', techFilter.trim());
      const res = await apiRequest<{ items: any[] }>(`/api/availability/overview?${params.toString()}`);
      setOverviewItems(res.items);

      if (user.role === 'team_lead' && recruiters.length === 0) {
        const recRes = await apiRequest<{ recruiters: any[] }>('/api/recruiters');
        setRecruiters(recRes.recruiters);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load availability overview.');
    }
  };

  useEffect(() => {
    if (user.role === 'candidate') {
      loadCandidateData();
    } else {
      loadOverviewData();
    }
  }, [selectedDate, recruiterFilter, techFilter]);

  // Candidate weekly helpers
  const toggleDay = (dow: number) => {
    setWeeklyRules((prev) =>
      prev.map((r) =>
        r.dayOfWeek === dow
          ? {
              ...r,
              isAvailable: !r.isAvailable,
              slots: !r.isAvailable && r.slots.length === 0 ? [{ start: '09:00', end: '12:00' }] : r.slots,
            }
          : r
      )
    );
  };

  const addWeeklySlot = (dow: number) => {
    setWeeklyRules((prev) =>
      prev.map((r) =>
        r.dayOfWeek === dow
          ? { ...r, isAvailable: true, slots: [...r.slots, { start: '14:00', end: '17:00' }] }
          : r
      )
    );
  };

  const updateWeeklySlot = (dow: number, idx: number, field: 'start' | 'end', value: string) => {
    setWeeklyRules((prev) =>
      prev.map((r) =>
        r.dayOfWeek === dow
          ? { ...r, slots: r.slots.map((s, i) => (i === idx ? { ...s, [field]: value } : s)) }
          : r
      )
    );
  };

  const removeWeeklySlot = (dow: number, idx: number) => {
    setWeeklyRules((prev) =>
      prev.map((r) =>
        r.dayOfWeek === dow ? { ...r, slots: r.slots.filter((_, i) => i !== idx) } : r
      )
    );
  };

  const handleSaveWeekly = async () => {
    setSavingWeekly(true);
    setError('');
    setNotice('');
    try {
      await apiRequest(`/api/availability/${user.id}/weekly`, {
        method: 'PUT',
        body: { timezone: candidateTz, rules: weeklyRules },
      });
      setNotice('Weekly recurring availability saved and your assigned recruiter was notified.');
      await loadCandidateData();
    } catch (err: any) {
      setError(err.message || 'Failed to save weekly schedule.');
    } finally {
      setSavingWeekly(false);
    }
  };

  const handleSaveException = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingExc(true);
    setError('');
    setNotice('');
    try {
      await apiRequest(`/api/availability/${user.id}/exceptions`, {
        method: 'POST',
        body: {
          date: excDate,
          isUnavailable: excUnavailable,
          slots: excUnavailable ? [] : excSlots,
          note: excNote,
        },
      });
      setNotice(`Custom daily override saved for ${excDate}. It supersedes your weekly recurring schedule.`);
      setExcNote('');
      await loadCandidateData();
    } catch (err: any) {
      setError(err.message || 'Failed to save daily exception.');
    } finally {
      setSavingExc(false);
    }
  };

  const handleDeleteException = async (date: string) => {
    try {
      await apiRequest(`/api/availability/${user.id}/exceptions/${encodeURIComponent(date)}`, {
        method: 'DELETE',
      });
      setNotice(`Removed custom override for ${date}; reverted to recurring weekly schedule.`);
      await loadCandidateData();
    } catch (err: any) {
      setError(err.message || 'Failed to remove override.');
    }
  };

  const handleQuickToday = async () => {
    setError('');
    setNotice('');
    try {
      await apiRequest(`/api/availability/${user.id}/quick-today`, { method: 'POST' });
      setNotice('Marked Available for Interview Today — your recruiter has been notified.');
      await loadCandidateData();
    } catch (err: any) {
      setError(err.message || 'Could not update availability.');
    }
  };

  // =========================================================================
  // CANDIDATE AVAILABILITY CALENDAR
  // =========================================================================
  if (user.role === 'candidate') {
    const resolvedStatus = resolvedToday ? availabilityMeta(resolvedToday.resolved.status) : null;
    return (
      <div className="space-y-6 max-w-6xl">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-xl font-semibold text-slate-900">My Interview Availability</h2>
            <p className="text-sm text-slate-600 mt-0.5">
              Set your repeating Monday–Sunday schedule and add specific date overrides. Recruiters see slots automatically converted to their US timezone.
            </p>
          </div>
          <button
            type="button"
            onClick={handleQuickToday}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <CheckCircle2 className="w-4 h-4" />
            Available for Interview Today
          </button>
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

        {/* Active Date Resolution Preview + Timezone Selector */}
        <div className="bg-white border border-slate-200 rounded-xl p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-4">
            <div>
              <label htmlFor="cand-tz" className="block text-xs font-medium text-slate-600 mb-1">
                Your IANA Timezone
              </label>
              <select
                id="cand-tz"
                value={candidateTz}
                onChange={(e) => setCandidateTz(e.target.value)}
                className="px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              >
                {US_TIMEZONES.map((tz) => (
                  <option key={tz.id} value={tz.id}>
                    {tz.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="preview-date" className="block text-xs font-medium text-slate-600 mb-1">
                Preview Effective Schedule For
              </label>
              <input
                id="preview-date"
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 bg-white text-slate-900"
              />
            </div>
          </div>

          {resolvedToday && resolvedStatus && (
            <div className="text-sm md:text-right">
              <div className="text-xs text-slate-500">
                Effective on {selectedDate} (
                {resolvedToday.resolved.source === 'custom_exception'
                  ? 'Daily Custom Override'
                  : 'Weekly Recurring'}
                )
              </div>
              <div className={`mt-0.5 ${resolvedStatus.textClass}`}>{resolvedStatus.label}</div>
              <div className="text-xs font-mono tabular-nums text-slate-600 mt-0.5">
                {resolvedToday.convertedSlots.length > 0
                  ? resolvedToday.convertedSlots
                      .map((s: any) => `${s.converted.startLabel}–${s.converted.endLabel} ${s.converted.tzAbbr}`)
                      .join(', ')
                  : 'No interview slots'}
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Weekly Recurring Availability */}
          <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-display text-base font-semibold text-slate-900">
                  1. Weekly Recurring Schedule
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Repeats automatically every week unless overridden by a daily custom date.
                </p>
              </div>
              <button
                type="button"
                disabled={savingWeekly}
                onClick={handleSaveWeekly}
                className="px-4 py-2 text-xs font-medium rounded-lg bg-slate-900 text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap cursor-pointer"
              >
                {savingWeekly ? 'Saving...' : 'Save Weekly Schedule'}
              </button>
            </div>

            <div className="divide-y divide-slate-100">
              {weeklyRules.map((rule) => (
                <div key={rule.dayOfWeek} className="py-3.5 flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="flex items-center gap-3 w-36 shrink-0 pt-1">
                    <input
                      id={`day-${rule.dayOfWeek}`}
                      type="checkbox"
                      checked={rule.isAvailable}
                      onChange={() => toggleDay(rule.dayOfWeek)}
                      className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                    />
                    <label htmlFor={`day-${rule.dayOfWeek}`} className="text-sm font-medium text-slate-800">
                      {DAY_NAMES[rule.dayOfWeek]}
                    </label>
                  </div>

                  <div className="flex-1 space-y-2">
                    {rule.isAvailable ? (
                      <>
                        {rule.slots.map((slot, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <input
                              type="time"
                              aria-label={`${DAY_NAMES[rule.dayOfWeek]} start time ${idx + 1}`}
                              value={slot.start}
                              onChange={(e) => updateWeeklySlot(rule.dayOfWeek, idx, 'start', e.target.value)}
                              className="px-2.5 py-1.5 text-xs font-mono rounded-lg border border-slate-300"
                            />
                            <span className="text-xs text-slate-400">to</span>
                            <input
                              type="time"
                              aria-label={`${DAY_NAMES[rule.dayOfWeek]} end time ${idx + 1}`}
                              value={slot.end}
                              onChange={(e) => updateWeeklySlot(rule.dayOfWeek, idx, 'end', e.target.value)}
                              className="px-2.5 py-1.5 text-xs font-mono rounded-lg border border-slate-300"
                            />
                            {rule.slots.length > 1 && (
                              <button
                                type="button"
                                onClick={() => removeWeeklySlot(rule.dayOfWeek, idx)}
                                aria-label={`Remove slot ${idx + 1} on ${DAY_NAMES[rule.dayOfWeek]}`}
                                className="p-1.5 text-slate-400 hover:text-red-600 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={() => addWeeklySlot(rule.dayOfWeek)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          Add time slot
                        </button>
                      </>
                    ) : (
                      <span className="text-xs text-slate-400 pt-1 inline-block">Unavailable</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Daily Custom Availability Overrides */}
          <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
            <div>
              <h3 className="font-display text-base font-semibold text-slate-900">
                2. Daily Custom Override
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Override any single date with custom slots or mark the entire day unavailable.
              </p>
            </div>

            <form onSubmit={handleSaveException} className="space-y-3.5">
              <div>
                <label htmlFor="exc-date" className="block text-xs font-medium text-slate-700 mb-1">
                  Specific Date
                </label>
                <input
                  id="exc-date"
                  type="date"
                  required
                  value={excDate}
                  onChange={(e) => setExcDate(e.target.value)}
                  className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-slate-300"
                />
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-700">
                <input
                  type="checkbox"
                  checked={excUnavailable}
                  onChange={(e) => setExcUnavailable(e.target.checked)}
                  className="w-4 h-4 rounded border-slate-300 text-blue-600"
                />
                Mark entire day unavailable
              </label>

              {!excUnavailable && (
                <div className="space-y-2">
                  <div className="text-xs font-medium text-slate-700">Custom Time Slots</div>
                  {excSlots.map((s, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="time"
                        aria-label={`Custom slot start ${idx + 1}`}
                        value={s.start}
                        onChange={(e) =>
                          setExcSlots((prev) =>
                            prev.map((x, i) => (i === idx ? { ...x, start: e.target.value } : x))
                          )
                        }
                        className="flex-1 px-2 py-1.5 text-xs font-mono rounded-lg border border-slate-300"
                      />
                      <span className="text-xs text-slate-400">–</span>
                      <input
                        type="time"
                        aria-label={`Custom slot end ${idx + 1}`}
                        value={s.end}
                        onChange={(e) =>
                          setExcSlots((prev) =>
                            prev.map((x, i) => (i === idx ? { ...x, end: e.target.value } : x))
                          )
                        }
                        className="flex-1 px-2 py-1.5 text-xs font-mono rounded-lg border border-slate-300"
                      />
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setExcSlots((prev) => [...prev, { start: '15:00', end: '17:30' }])}
                    className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" /> Add another slot
                  </button>
                </div>
              )}

              <div>
                <label htmlFor="exc-note" className="block text-xs font-medium text-slate-700 mb-1">
                  Optional Note
                </label>
                <input
                  id="exc-note"
                  type="text"
                  value={excNote}
                  onChange={(e) => setExcNote(e.target.value)}
                  placeholder="e.g., Available after client demo"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300"
                />
              </div>

              <button
                type="submit"
                disabled={savingExc}
                className="w-full px-4 py-2 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
              >
                {savingExc ? 'Saving Override...' : 'Save Daily Override'}
              </button>
            </form>

            <div className="border-t border-slate-200 pt-4">
              <h4 className="font-display text-xs font-semibold text-slate-900">Active Custom Overrides</h4>
              {exceptions.length === 0 ? (
                <p className="text-xs text-slate-500 mt-2">No date overrides configured.</p>
              ) : (
                <div className="mt-2.5 space-y-2">
                  {exceptions.map((ex) => (
                    <div key={ex.date} className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 flex items-start justify-between gap-2 text-xs">
                      <div>
                        <div className="font-mono font-medium text-slate-900">{ex.date}</div>
                        <div className={ex.isUnavailable ? 'text-red-700' : 'text-emerald-700'}>
                          {ex.isUnavailable
                            ? 'Marked Unavailable'
                            : (ex.slots || []).map((s: Slot) => `${s.start}–${s.end}`).join(', ')}
                        </div>
                        {ex.note && <div className="text-slate-500 mt-0.5">{ex.note}</div>}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDeleteException(ex.date)}
                        aria-label={`Remove override for ${ex.date}`}
                        className="p-1 text-slate-400 hover:text-red-600 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // RECRUITER & TEAM LEAD AVAILABILITY OVERVIEW
  // =========================================================================
  const filteredItems = overviewItems.filter((item) => {
    if (statusFilter === 'all') return true;
    return item.availability.resolved.status === statusFilter;
  });

  return (
    <div className="space-y-6 max-w-7xl">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-semibold text-slate-900">
            {user.role === 'team_lead' ? 'Organization Availability Overview' : 'Assigned Candidate Availability'}
          </h2>
          <p className="text-sm text-slate-600 mt-0.5">
            All candidate slots are automatically converted into your timezone ({user.timezone}). Daily custom overrides take precedence over weekly rules.
          </p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 flex flex-wrap items-end gap-4">
        <div>
          <label htmlFor="avail-date" className="block text-xs font-medium text-slate-600 mb-1">
            Target Date
          </label>
          <input
            id="avail-date"
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-2 text-sm font-mono rounded-lg border border-slate-300 bg-white"
          />
        </div>

        {user.role === 'team_lead' && (
          <div>
            <label htmlFor="avail-recruiter" className="block text-xs font-medium text-slate-600 mb-1">
              Recruiter
            </label>
            <select
              id="avail-recruiter"
              value={recruiterFilter}
              onChange={(e) => setRecruiterFilter(e.target.value)}
              className="px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
            >
              <option value="">All Recruiters</option>
              {recruiters.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.full_name}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label htmlFor="avail-tech" className="block text-xs font-medium text-slate-600 mb-1">
            Technology / Skill
          </label>
          <input
            id="avail-tech"
            type="search"
            value={techFilter}
            onChange={(e) => setTechFilter(e.target.value)}
            placeholder="e.g., Java, Kubernetes, React"
            className="px-3 py-2 text-sm rounded-lg border border-slate-300 bg-white"
          />
        </div>

        <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg ml-auto">
          {[
            { id: 'all', label: 'All' },
            { id: 'available', label: 'Available' },
            { id: 'partially_available', label: 'Partial' },
            { id: 'unavailable', label: 'Unavailable' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                statusFilter === tab.id
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Availability Table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs text-slate-500 text-left">
                <th className="px-5 py-3 font-medium">Candidate</th>
                <th className="px-5 py-3 font-medium">Status ({selectedDate})</th>
                <th className="px-5 py-3 font-medium">Slots in Your Timezone</th>
                <th className="px-5 py-3 font-medium">Source & Candidate TZ</th>
                {user.role === 'team_lead' && <th className="px-5 py-3 font-medium">Recruiter</th>}
                <th className="px-5 py-3 font-medium text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredItems.map((item) => {
                const av = availabilityMeta(item.availability.resolved.status);
                return (
                  <tr key={item.id} className="hover:bg-slate-50">
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3">
                        <Avatar name={item.full_name} src={item.avatar_url} size="sm" />
                        <div>
                          <div className="font-medium text-slate-900">{item.full_name}</div>
                          <div className="text-xs text-slate-500">
                            {item.technology} · {item.visa_status}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      <span className={`text-xs ${av.textClass}`}>{av.label}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      {item.availability.convertedSlots.length > 0 ? (
                        <div className="space-y-1 font-mono text-xs tabular-nums text-slate-800">
                          {item.availability.convertedSlots.map((s: any, i: number) => (
                            <div key={i}>
                              {s.converted.startLabel} – {s.converted.endLabel} {s.converted.tzAbbr}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">No slots open</span>
                      )}
                      {item.availability.resolved.note && (
                        <div className="text-xs text-slate-500 mt-1">{item.availability.resolved.note}</div>
                      )}
                    </td>
                    <td className="px-5 py-3.5 text-xs text-slate-600">
                      <div>
                        {item.availability.resolved.source === 'custom_exception'
                          ? 'Daily Custom Override'
                          : 'Weekly Recurring'}
                      </div>
                      <div className="text-slate-400 font-mono">{item.timezone}</div>
                    </td>
                    {user.role === 'team_lead' && (
                      <td className="px-5 py-3.5 text-xs text-slate-700 whitespace-nowrap">
                        {item.recruiter_name || 'Unassigned'}
                      </td>
                    )}
                    <td className="px-5 py-3.5 text-right whitespace-nowrap">
                      {item.availability.resolved.status !== 'unavailable' && onScheduleInterviewForCandidate && (
                        <button
                          type="button"
                          onClick={() => onScheduleInterviewForCandidate(item.id)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-100 cursor-pointer"
                        >
                          <CalendarClock className="w-3.5 h-3.5" />
                          Request Slot
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filteredItems.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-sm text-slate-500">
                    No candidates match the selected availability filter for {selectedDate}.
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
