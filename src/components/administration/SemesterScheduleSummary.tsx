import React, { useMemo, useState } from 'react';
import { Calendar, Clock, BookOpen, AlertCircle, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';
import {
  AcademicSetting,
  ATPUnitMappingData,
  UnitExecutionPlanData,
  LearningMeetingScheduleData,
  TPData,
  ATPData,
} from '../../types';
import { resolveScheduledLearningMeetings } from '../../services/scheduledLearningMeetingProjectionService';

interface SemesterScheduleSummaryProps {
  academicSetting: AcademicSetting;
  atpUnitMapping?: ATPUnitMappingData;
  unitExecutionPlan?: UnitExecutionPlanData;
  learningMeetingSchedules?: {
    semesterPlanId: string;
    semester: 1 | 2;
    schedule: LearningMeetingScheduleData;
  }[];
  tp?: TPData;
  atp?: ATPData;
}

export const SemesterScheduleSummary: React.FC<SemesterScheduleSummaryProps> = ({
  academicSetting,
  atpUnitMapping,
  unitExecutionPlan,
  learningMeetingSchedules = [],
  tp,
  atp,
}) => {
  const [isOpen, setIsOpen] = useState(false);

  const activeSemesterNum = useMemo(() => {
    return academicSetting?.semester?.includes('1') ||
      academicSetting?.semester?.toLowerCase().includes('ganjil')
      ? 1
      : 2;
  }, [academicSetting]);

  const projection = useMemo(() => {
    if (!atpUnitMapping || !unitExecutionPlan || !learningMeetingSchedules || learningMeetingSchedules.length === 0) {
      return {
        rows: [],
        isReady: false,
        errors: ['Prasyarat Perencanaan Tahunan (Step 08) belum lengkap. Silakan selesaikan Jadwal Aktual terlebih dahulu.'],
      };
    }

    try {
      const result = resolveScheduledLearningMeetings({
        mapping: atpUnitMapping,
        unitExecutionPlan,
        schedules: learningMeetingSchedules,
        tp,
        atp,
      });

      return {
        rows: result.rows,
        isReady: result.isValid && result.rows.length > 0,
        errors: result.errors,
      };
    } catch (err: any) {
      return {
        rows: [],
        isReady: false,
        errors: [err.message || 'Gagal meresolusi proyeksi jadwal.'],
      };
    }
  }, [atpUnitMapping, unitExecutionPlan, learningMeetingSchedules, tp, atp]);

  const activeRows = useMemo(() => {
    return projection.rows.filter((r) => r.semester === activeSemesterNum);
  }, [projection.rows, activeSemesterNum]);

  const totalJP = useMemo(() => {
    return activeRows.reduce((sum, r) => sum + r.jp, 0);
  }, [activeRows]);

  const sortedRows = useMemo(() => {
    return [...activeRows].sort((a, b) => {
      const dateCompare = a.date.localeCompare(b.date);
      if (dateCompare !== 0) return dateCompare;
      const unitCompare = a.unitOrder - b.unitOrder;
      if (unitCompare !== 0) return unitCompare;
      return a.meetingOrder - b.meetingOrder;
    });
  }, [activeRows]);

  const isK13Curriculum =
    academicSetting.curriculumType === 'K13' || academicSetting.curriculum?.includes('2013');

  if (isK13Curriculum) {
    return null;
  }

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '-';
    try {
      const options: Intl.DateTimeFormatOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
      return new Date(dateStr).toLocaleDateString('id-ID', options);
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs mb-6">
      {/* Header Bar */}
      <div
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between p-4 bg-slate-50 cursor-pointer hover:bg-slate-100/80 transition-colors"
      >
        <div className="flex items-center gap-3">
          <Calendar className="w-5 h-5 text-indigo-600 shrink-0" />
          <div>
            <h3 className="text-sm font-bold text-slate-800">
              Ringkasan Jadwal &amp; Alokasi Waktu Semester {activeSemesterNum} (Read-Only)
            </h3>
            <p className="text-xs text-slate-500">
              Menggunakan jadwal aktual terencana dari Step 08 sebagai otoritas tunggal.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {projection.isReady ? (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs font-semibold">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>Jadwal Aktif Terkonfirmasi</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-rose-50 text-rose-800 border border-rose-200 text-xs font-semibold">
              <AlertCircle className="w-3.5 h-3.5 text-rose-600" />
              <span>Jadwal Belum Siap</span>
            </span>
          )}
          {isOpen ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </div>
      </div>

      {/* Main Stats Block */}
      <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-4 border-t border-slate-100 bg-white">
        <div className="p-3 rounded-lg bg-slate-50/60 border border-slate-100">
          <span className="text-xs font-medium text-slate-500 block">Total Pertemuan Efektif</span>
          <span className="text-xl font-bold text-slate-800 mt-1 block">
            {projection.isReady ? `${activeRows.length} Pertemuan` : 'Belum dihitung'}
          </span>
        </div>
        <div className="p-3 rounded-lg bg-slate-50/60 border border-slate-100">
          <span className="text-xs font-medium text-slate-500 block">Total Beban Jam Pelajaran (JP)</span>
          <span className="text-xl font-bold text-indigo-600 mt-1 block">
            {projection.isReady ? `${totalJP} JP` : 'Belum dihitung'}
          </span>
        </div>
        <div className="p-3 rounded-lg bg-indigo-50/20 border border-indigo-100">
          <span className="text-xs font-medium text-indigo-700 block">Otoritas Perencanaan</span>
          <span className="text-xs text-indigo-900 font-semibold mt-1 block leading-relaxed">
            Perubahan hari mengajar atau jadwal aktual hanya dapat disesuaikan pada Step 08 Rencana Tahunan.
          </span>
        </div>
      </div>

      {/* Error Block */}
      {!projection.isReady && (
        <div className="p-4 bg-rose-50/50 border-t border-slate-100 text-xs text-rose-800 space-y-1">
          <div className="font-bold flex items-center gap-1 text-rose-900">
            <AlertCircle className="w-4 h-4" />
            <span>Perencanaan Waktu Tidak Valid</span>
          </div>
          <ul className="list-disc pl-5 mt-1 space-y-0.5">
            {projection.errors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Expandable Schedule Row List */}
      {isOpen && projection.isReady && (
        <div className="border-t border-slate-100 max-h-96 overflow-y-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 text-slate-700 font-semibold border-b border-slate-100 sticky top-0">
              <tr>
                <th className="py-2.5 px-4 w-12 text-center">No</th>
                <th className="py-2.5 px-3">Tanggal / Hari</th>
                <th className="py-2.5 px-3">Unit / Bab &amp; Pertemuan</th>
                <th className="py-2.5 px-3">Materi Pembelajaran</th>
                <th className="py-2.5 px-4 text-center w-20">Alokasi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sortedRows.map((row, index) => (
                <tr key={row.meetingId} className="hover:bg-slate-50/50 transition-colors">
                  <td className="py-2.5 px-4 text-center text-slate-400 font-semibold">{index + 1}</td>
                  <td className="py-2.5 px-3 font-medium text-slate-800 whitespace-nowrap">
                    <div>{formatDate(row.date)}</div>
                    <div className="text-[10px] text-slate-400 font-normal">Pekan {row.weekIndex}</div>
                  </td>
                  <td className="py-2.5 px-3">
                    <div className="font-semibold text-indigo-950">{row.unitTitle}</div>
                    <div className="text-[11px] text-slate-500 font-medium">{row.meetingTitle}</div>
                  </td>
                  <td className="py-2.5 px-3 text-slate-600 font-medium">
                    {row.materials && row.materials.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {row.materials.map((m) => (
                          <span key={m.id} className="px-1.5 py-0.5 bg-slate-100 text-slate-700 rounded text-[10px] border border-slate-200">
                            {m.title}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-slate-400 italic">Materi Kegiatan Belajar</span>
                    )}
                  </td>
                  <td className="py-2.5 px-4 text-center font-bold text-indigo-700">{row.jp} JP</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
