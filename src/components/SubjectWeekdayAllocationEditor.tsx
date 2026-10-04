import React, { useState, useEffect, useMemo } from 'react';
import { SubjectWeeklySchedule, SubjectWeeklyScheduleSession, SubjectScheduleDay } from '../types';
import { AlertCircle, CheckCircle2, Save } from 'lucide-react';

interface Props {
  semesterPlanId: string;
  schedule?: SubjectWeeklySchedule;
  schoolDaysPerWeek: number | null;
  onSaveSubjectWeeklySchedule: (schedule: SubjectWeeklySchedule, semesterPlanId: string) => void;
}

const DAYS: { id: SubjectScheduleDay; label: string }[] = [
  { id: 1, label: 'Senin' },
  { id: 2, label: 'Selasa' },
  { id: 3, label: 'Rabu' },
  { id: 4, label: 'Kamis' },
  { id: 5, label: 'Jumat' },
  { id: 6, label: 'Sabtu' },
];

export function SubjectWeekdayAllocationEditor({
  semesterPlanId,
  schedule,
  schoolDaysPerWeek,
  onSaveSubjectWeeklySchedule,
}: Props) {
  const [draftSessions, setDraftSessions] = useState<SubjectWeeklyScheduleSession[]>([]);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');

  useEffect(() => {
    if (schedule?.sessions) {
      setDraftSessions(JSON.parse(JSON.stringify(schedule.sessions)));
      setSaveStatus('idle');
    }
  }, [schedule]);

  const availableDays = useMemo(() => {
    if (schoolDaysPerWeek === 5) return DAYS.slice(0, 5);
    return DAYS;
  }, [schoolDaysPerWeek]);

  const isDirty = useMemo(() => {
    if (!schedule?.sessions) return false;
    return JSON.stringify(draftSessions) !== JSON.stringify(schedule.sessions);
  }, [draftSessions, schedule]);

  const isComplete = useMemo(() => {
    return draftSessions.every(s => s.dayOfWeek !== undefined && s.dayOfWeek !== null);
  }, [draftSessions]);

  const handleDayChange = (sessionId: string, day: SubjectScheduleDay) => {
    setDraftSessions(prev =>
      prev.map(s => (s.id === sessionId ? { ...s, dayOfWeek: day } : s))
    );
    setSaveStatus('idle');
  };

  const handleSave = () => {
    if (!schedule || !isComplete) return;
    try {
      const updatedSchedule: SubjectWeeklySchedule = {
        ...schedule,
        sessions: draftSessions,
        updatedAt: new Date().toISOString(),
      };
      onSaveSubjectWeeklySchedule(updatedSchedule, semesterPlanId);
      setSaveStatus('success');
    } catch {
      setSaveStatus('error');
    }
  };

  if (!schedule) {
    return (
      <div className="p-4 bg-amber-50 rounded-lg text-amber-800 text-sm border border-amber-200">
        Pola Pertemuan Mingguan belum tersedia. Selesaikan Waktu Semester terlebih dahulu.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h4 className="font-bold text-slate-900">Alokasi Hari Mengajar Sesi</h4>
      <div className="space-y-3">
        {draftSessions.sort((a, b) => a.order - b.order).map(session => (
          <div key={session.id} className="flex items-center gap-4 bg-white p-3 rounded-lg border border-slate-200">
            <span className="font-semibold text-sm text-slate-700 w-24">Sesi {session.order}</span>
            <span className="text-xs text-slate-500 w-16">{session.jp} JP</span>
            <div className="flex flex-wrap gap-1">
              {availableDays.map(day => (
                <button
                  key={day.id}
                  type="button"
                  onClick={() => handleDayChange(session.id, day.id)}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition ${
                    session.dayOfWeek === day.id
                      ? 'bg-blue-900 text-white'
                      : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                  }`}
                >
                  {day.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {!isComplete && (
        <p className="text-xs text-amber-700 flex items-center gap-1.5 mt-2">
          <AlertCircle className="w-3.5 h-3.5" />
          Hari mengajar belum lengkap. Pilih hari untuk seluruh sesi pertemuan mingguan.
        </p>
      )}

      <div className="flex items-center gap-3 pt-2">
        <button
          type="button"
          disabled={!isDirty || !isComplete}
          onClick={handleSave}
          className={`px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2 transition ${
            isDirty && isComplete
              ? 'bg-blue-900 hover:bg-blue-950 text-white shadow-sm'
              : 'bg-slate-200 text-slate-400 cursor-not-allowed'
          }`}
        >
          <Save className="w-4 h-4" />
          Simpan Hari Mengajar
        </button>
        {saveStatus === 'success' && (
          <span className="text-xs text-emerald-700 flex items-center gap-1">
            <CheckCircle2 className="w-3.5 h-3.5" /> Hari mengajar berhasil disimpan.
          </span>
        )}
        {saveStatus === 'error' && (
          <span className="text-xs text-red-700 flex items-center gap-1">
            <AlertCircle className="w-3.5 h-3.5" /> Gagal menyimpan hari mengajar.
          </span>
        )}
      </div>
    </div>
  );
}
