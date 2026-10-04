import React, { useState, useMemo, useEffect } from 'react';
import {
  SubjectWeeklySchedule,
  SubjectWeeklyScheduleSession,
  SubjectScheduleDay,
  AcademicCalendar,
  CalendarDay,
} from '../types';
import {
  validateSubjectWeeklySchedule,
  resolveEffectiveSubjectSlots,
} from '../services/subjectScheduleService';
import {
  Calendar,
  Clock,
  Plus,
  Trash2,
  Save,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Info,
  Layers,
} from 'lucide-react';

export interface SubjectWeeklyScheduleManagerProps {
  semesterPlanId: string;
  expectedWeeklyJP: number | null;
  schoolDaysPerWeek?: number | null;
  schedule?: SubjectWeeklySchedule;
  calendar?: AcademicCalendar;
  calendarDays?: CalendarDay[];
  onSave: (schedule: SubjectWeeklySchedule) => boolean;
}

const DAY_LABELS: Record<SubjectScheduleDay, string> = {
  1: 'Senin',
  2: 'Selasa',
  3: 'Rabu',
  4: 'Kamis',
  5: 'Jumat',
  6: 'Sabtu',
};

function generateStableId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `sess-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

export const SubjectWeeklyScheduleManager: React.FC<SubjectWeeklyScheduleManagerProps> = ({
  semesterPlanId,
  expectedWeeklyJP,
  schoolDaysPerWeek,
  schedule,
  calendar,
  calendarDays = [],
  onSave,
}) => {
  // Local draft state
  const [draft, setDraft] = useState<SubjectWeeklySchedule>(() => {
    if (schedule && schedule.semesterPlanId === semesterPlanId) {
      return JSON.parse(JSON.stringify(schedule));
    }
    return {
      semesterPlanId,
      sessions: [
        {
          id: generateStableId(),
          dayOfWeek: 0 as any, // sentinel "Pilih hari..."
          jp: expectedWeeklyJP && expectedWeeklyJP > 0 ? expectedWeeklyJP : 0,
          order: 1,
        },
      ],
      basedOnWeeklyJP: expectedWeeklyJP || 0,
      updatedAt: new Date().toISOString(),
    };
  });

  const [saveNotice, setSaveNotice] = useState<{
    type: 'success' | 'error' | 'warning';
    message: string;
  } | null>(null);

  // Sync draft only when persisted schedule genuinely changes (stable dependency on updatedAt and semesterPlanId)
  useEffect(() => {
    if (schedule && schedule.semesterPlanId === semesterPlanId) {
      setDraft(JSON.parse(JSON.stringify(schedule)));
    } else {
      setDraft((prev) => {
        if (prev.semesterPlanId === semesterPlanId) {
          // Parent refresh or expectedWeeklyJP updated without persisted schedule. Keep local edits!
          const updatedSessions = prev.sessions.map((s, idx) => {
            if (s.jp <= 0 && idx === 0 && expectedWeeklyJP && expectedWeeklyJP > 0) {
              return { ...s, jp: expectedWeeklyJP };
            }
            return s;
          });
          return {
            ...prev,
            sessions: updatedSessions,
            basedOnWeeklyJP: expectedWeeklyJP || 0,
          };
        }
        return {
          semesterPlanId,
          sessions: [
            {
              id: generateStableId(),
              dayOfWeek: 0 as any,
              jp: expectedWeeklyJP && expectedWeeklyJP > 0 ? expectedWeeklyJP : 0,
              order: 1,
            },
          ],
          basedOnWeeklyJP: expectedWeeklyJP || 0,
          updatedAt: new Date().toISOString(),
        };
      });
    }
  }, [semesterPlanId, schedule?.semesterPlanId, schedule?.updatedAt, expectedWeeklyJP]);

  // Persisted Validation (stale authority check on stored data)
  const persistedValidation = useMemo(() => {
    if (!schedule) return null;
    return validateSubjectWeeklySchedule(schedule, expectedWeeklyJP, schoolDaysPerWeek);
  }, [schedule, expectedWeeklyJP, schoolDaysPerWeek]);

  // Candidate Schedule (draft targeted to current expectedWeeklyJP)
  const candidateSchedule = useMemo(() => {
    return {
      ...draft,
      basedOnWeeklyJP:
        expectedWeeklyJP && expectedWeeklyJP > 0
          ? expectedWeeklyJP
          : draft.basedOnWeeklyJP
    };
  }, [draft, expectedWeeklyJP]);

  // Candidate Validation (validates edits targeted to expectedWeeklyJP)
  const candidateValidation = useMemo(() => {
    return validateSubjectWeeklySchedule(candidateSchedule, expectedWeeklyJP, schoolDaysPerWeek);
  }, [candidateSchedule, expectedWeeklyJP, schoolDaysPerWeek]);

  // Effective slots resolution using candidateSchedule (allows instant previews of corrected schedule before saving!)
  const slotResult = useMemo(() => {
    return resolveEffectiveSubjectSlots({
      semesterPlanId,
      schedule: candidateSchedule,
      expectedWeeklyJP,
      calendar,
      calendarDays,
      schoolDaysPerWeek,
    });
  }, [semesterPlanId, candidateSchedule, expectedWeeklyJP, calendar, calendarDays, schoolDaysPerWeek]);

  // Dirty state calculation
  const isDirty = useMemo(() => {
    if (!schedule) return true;
    return JSON.stringify(draft.sessions) !== JSON.stringify(schedule.sessions) || draft.basedOnWeeklyJP !== schedule.basedOnWeeklyJP;
  }, [draft, schedule]);

  const maxDay = schoolDaysPerWeek === 5 ? 5 : 6;

  const handleAddSession = () => {
    setDraft((prev) => {
      const nextOrder = prev.sessions.length + 1;
      const newSession: SubjectWeeklyScheduleSession = {
        id: generateStableId(),
        dayOfWeek: 0 as any, // sentinel "Pilih hari..."
        jp: 0, // sentinel 0
        order: nextOrder,
      };
      return {
        ...prev,
        sessions: [...prev.sessions, newSession],
        updatedAt: new Date().toISOString(),
      };
    });
  };

  const handleUpdateSession = (sessionId: string, updates: Partial<SubjectWeeklyScheduleSession>) => {
    setDraft((prev) => {
      const newSessions = prev.sessions.map((s) => {
        if (s.id !== sessionId) return s;
        return { ...s, ...updates };
      });
      return {
        ...prev,
        sessions: newSessions,
        updatedAt: new Date().toISOString(),
      };
    });
  };

  const handleDeleteSession = (sessionId: string) => {
    setDraft((prev) => {
      const filtered = prev.sessions.filter((s) => s.id !== sessionId);
      const reordered = filtered.map((s, idx) => ({ ...s, order: idx + 1 }));
      return {
        ...prev,
        sessions: reordered,
        updatedAt: new Date().toISOString(),
      };
    });
  };

  const handleSave = () => {
    if (!expectedWeeklyJP || expectedWeeklyJP <= 0) {
      setSaveNotice({ type: 'error', message: 'JP mingguan canonical belum ditentukan.' });
      return;
    }

    const toSave: SubjectWeeklySchedule = {
      ...draft,
      basedOnWeeklyJP: expectedWeeklyJP,
      updatedAt: new Date().toISOString(),
    };

    const finalVal = validateSubjectWeeklySchedule(toSave, expectedWeeklyJP, schoolDaysPerWeek);
    if (!finalVal.isValid || !finalVal.isComplete || finalVal.isStale) {
      setSaveNotice({ type: 'error', message: 'Pola jadwal belum lengkap atau tidak valid sesuai JP mingguan.' });
      return;
    }

    const success = onSave(toSave);
    if (success) {
      setSaveNotice({ type: 'success', message: 'Pola jadwal mapel berhasil disimpan.' });
      setTimeout(() => setSaveNotice(null), 4000);
    } else {
      setSaveNotice({ type: 'error', message: 'Gagal menyimpan pola jadwal.' });
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden mb-8">
      {/* Header */}
      <div className="p-5 sm:p-6 bg-slate-900 text-white flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Clock className="w-5 h-5 text-blue-400" />
            <h2 className="text-lg font-bold">Pola Jadwal Mapel</h2>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-semibold border border-blue-400/30">
              Subject Weekly Schedule
            </span>
          </div>
          <p className="text-xs text-slate-300">
            Tentukan hari dan jumlah JP setiap sesi mapel. Total seluruh sesi harus sama dengan JP mingguan.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="text-right">
            <span className="block text-[10px] uppercase tracking-wider text-slate-400 font-bold">
              JP Mingguan Canonical
            </span>
            <span className="text-sm font-bold text-blue-400">
              {expectedWeeklyJP !== null ? `${expectedWeeklyJP} JP / minggu` : 'Belum Ditetapkan'}
            </span>
          </div>

          <button
            type="button"
            onClick={handleSave}
            disabled={!expectedWeeklyJP || expectedWeeklyJP <= 0 || !candidateValidation.isComplete || !isDirty}
            className={`px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 transition-all cursor-pointer ${
              !expectedWeeklyJP || expectedWeeklyJP <= 0 || !candidateValidation.isComplete || !isDirty
                ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                : 'bg-blue-600 text-white hover:bg-blue-500 shadow-md shadow-blue-600/20'
            }`}
          >
            <Save className="w-4 h-4" />
            <span>Simpan Pola Jadwal</span>
          </button>
        </div>
      </div>

      {/* Save Notice */}
      {saveNotice && (
        <div
          className={`px-5 py-3 text-xs font-medium border-b flex items-center justify-between ${
            saveNotice.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : saveNotice.type === 'warning'
              ? 'bg-amber-50 text-amber-800 border-amber-200'
              : 'bg-rose-50 text-rose-800 border-rose-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {saveNotice.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : saveNotice.type === 'warning' ? (
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{saveNotice.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setSaveNotice(null)}
            className="text-[11px] font-bold underline hover:opacity-80 cursor-pointer"
          >
            Tutup
          </button>
        </div>
      )}

      {/* Persisted Stale Warning */}
      {persistedValidation?.isStale && (
        <div className="mx-5 mt-4 p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-bold">Perubahan JP Mingguan Terdeteksi</p>
            <p className="mt-0.5">
              JP mingguan berubah dari {schedule?.basedOnWeeklyJP ?? 0} menjadi {expectedWeeklyJP ?? 0} JP.
              Sesuaikan pola jadwal lalu simpan ulang.
            </p>
          </div>
        </div>
      )}

      {/* Validation Errors / Stale Notice */}
      {candidateValidation.errors.length > 0 && (
        <div className="mx-5 mt-4 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs">
          <ul className="list-disc pl-5 space-y-0.5">
            {candidateValidation.errors.map((err, idx) => (
              <li key={idx}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Schedule Table & Editor */}
      <div className="p-5 sm:p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-xs font-bold text-slate-700 uppercase tracking-wider">
            Sesi Mengajar dalam Seminggu ({draft.sessions.length} Sesi)
          </div>
          <button
            type="button"
            onClick={handleAddSession}
            className="px-3 py-1.5 rounded-xl bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold text-xs flex items-center gap-1.5 border border-blue-200 cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Tambah Sesi</span>
          </button>
        </div>

        <div className="space-y-3">
          {draft.sessions.map((session, idx) => (
            <div key={session.id} className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3 flex-1">
                <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center shrink-0">
                  {idx + 1}
                </span>

                <div className="flex flex-col sm:flex-row sm:items-center gap-3 flex-1">
                  <div className="flex-1">
                    <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Hari</label>
                    <select
                      value={session.dayOfWeek || 0}
                      onChange={(e) =>
                        handleUpdateSession(session.id, {
                          dayOfWeek: Number(e.target.value) as SubjectScheduleDay,
                        })
                      }
                      className="w-full text-xs font-semibold bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-600"
                    >
                      <option value={0} disabled>Pilih hari...</option>
                      {[1, 2, 3, 4, 5, 6].filter((d) => d <= maxDay).map((d) => (
                        <option key={d} value={d}>
                          {DAY_LABELS[d as SubjectScheduleDay]}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="w-32">
                    <label className="block text-[10px] uppercase font-bold text-slate-500 mb-1">Jumlah JP</label>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={session.jp > 0 ? session.jp : ''}
                      onChange={(e) => {
                        const val = parseInt(e.target.value, 10);
                        handleUpdateSession(session.id, {
                          jp: isNaN(val) ? 0 : Math.max(0, val),
                        });
                      }}
                      placeholder="JP..."
                      className="w-full text-xs font-semibold bg-white border border-slate-300 rounded-lg px-2.5 py-1.5 text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => handleDeleteSession(session.id)}
                  disabled={draft.sessions.length <= 1}
                  className="p-2 rounded-lg text-rose-500 hover:bg-rose-50 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                  title="Hapus Sesi"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Total Summary Bar */}
        <div className="p-4 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-between text-xs font-bold text-slate-800">
          <span>Total Jadwal Sesi:</span>
          <span className={`${candidateValidation.totalWeeklyJP === expectedWeeklyJP ? 'text-emerald-700' : 'text-rose-700'}`}>
            {candidateValidation.totalWeeklyJP} / {expectedWeeklyJP || 0} JP
          </span>
        </div>
      </div>

      {/* Effective Slot Summary Section */}
      <div className="p-5 sm:p-6 bg-slate-50 border-t border-slate-200 space-y-3">
        <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
          <Calendar className="w-4 h-4 text-blue-600" />
          <span>Pratinjau Slot Pertemuan Efektif Kalender</span>
        </h3>

        {!slotResult.isReady ? (
          <div className="p-4 rounded-xl border border-rose-200 bg-rose-50 text-rose-900 text-xs space-y-1">
            <p className="font-bold flex items-center gap-1.5 text-rose-800">
              <AlertTriangle className="w-4 h-4 text-rose-600" />
              <span>Gagal Menghitung Slot Pertemuan Efektif</span>
            </p>
            <p className="font-semibold mt-0.5">
              {schedule && slotResult.errors && slotResult.errors.length > 0
                ? slotResult.errors[0]
                : !calendar || calendar.workflowStatus !== 'CONFIRMED'
                ? 'Simpan dan tetapkan Kalender Pendidikan untuk menghitung jumlah Pertemuan efektif.'
                : 'Lengkapi pola jadwal dan pastikan Kalender Pendidikan valid untuk melihat jumlah Pertemuan efektif.'}
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {isDirty ? (
              <div className="p-3.5 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-xs flex items-start gap-2.5 shadow-2xs">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div>
                  <p className="font-bold">Pratinjau draf — belum menjadi jadwal tersimpan</p>
                  <p className="text-[11px] text-amber-800 mt-0.5">
                    Klik <strong>Simpan Pola Jadwal</strong> untuk menyelesaikan tahap Waktu Semester.
                  </p>
                </div>
              </div>
            ) : schedule ? (
              <div className="p-3.5 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-950 text-xs flex items-center gap-2 shadow-2xs">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span className="font-bold">Jadwal tersimpan</span>
              </div>
            ) : null}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-1">
                <span className="text-[10px] text-slate-500 font-bold uppercase">Pertemuan Efektif</span>
                <p className="text-base font-extrabold text-blue-600">{slotResult.totalMeetingSlots}</p>
              </div>
              <div className="p-3 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-1">
                <span className="text-[10px] text-slate-500 font-bold uppercase">JP Aktual</span>
                <p className="text-base font-extrabold text-emerald-600">{slotResult.totalJP} JP</p>
              </div>
              <div className="p-3 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-1">
                <span className="text-[10px] text-slate-500 font-bold uppercase">Sesi / Minggu</span>
                <p className="text-base font-extrabold text-indigo-600">{draft.sessions.length}</p>
              </div>
              <div className="p-3 rounded-xl bg-white border border-slate-200 shadow-2xs space-y-1">
                <span className="text-[10px] text-slate-500 font-bold uppercase">Sesi Terdampak (Libur)</span>
                <p className="text-base font-extrabold text-amber-600">{slotResult.totalExcludedOccurrences}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
