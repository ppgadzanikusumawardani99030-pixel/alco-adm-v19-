import React, { useMemo } from 'react';
import {
  ATPUnitMappingData,
  UnitExecutionPlanData,
  SubjectWeeklySchedule,
  AcademicCalendar,
  CalendarDay,
} from '../types';
import { resolveEffectiveSubjectSlots } from '../services/subjectScheduleService';
import { resolveLearningMeetingSchedule } from '../services/learningMeetingScheduleService';
import { resolveUnitSemesterPlacement } from '../services/unitSemesterPlanningService';
import {
  Calendar,
  AlertTriangle,
  Info,
  CheckCircle2,
  Clock,
  Ban,
  Layers,
} from 'lucide-react';

interface LearningMeetingSchedulePreviewProps {
  semesterPlanId: string;
  semester: 1 | 2;
  mapping?: ATPUnitMappingData;
  unitExecutionPlan?: UnitExecutionPlanData;
  schedule?: SubjectWeeklySchedule;
  expectedWeeklyJP: number | null;
  calendar?: AcademicCalendar;
  calendarDays?: CalendarDay[];
  schoolDaysPerWeek?: number | null;
}

const DAY_NAMES = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const MONTH_NAMES = [
  'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
  'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember',
];

function formatIndonesianDate(isoDate: string): string {
  if (!isoDate) return '-';
  const parts = isoDate.split('-');
  if (parts.length !== 3) return isoDate;
  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);
  const d = new Date(year, month, day);
  const dayName = DAY_NAMES[d.getDay()];
  const monthName = MONTH_NAMES[month];
  return `${dayName}, ${day} ${monthName} ${year}`;
}

function mapExcludedReason(reason: string): string {
  switch (reason) {
    case 'HOLIDAY':
      return 'Libur';
    case 'BREAK':
      return 'Libur/Jeda Semester';
    case 'NON_LEARNING':
      return 'Non-Pembelajaran';
    case 'SCHOOL_EVENT':
      return 'Kegiatan Sekolah';
    case 'ASSESSMENT':
      return 'Asesmen';
    default:
      return reason;
  }
}

export const LearningMeetingSchedulePreview: React.FC<LearningMeetingSchedulePreviewProps> = ({
  semesterPlanId,
  semester,
  mapping,
  unitExecutionPlan,
  schedule,
  expectedWeeklyJP,
  calendar,
  calendarDays = [],
  schoolDaysPerWeek,
}) => {
  // 1. Resolve exact subject slots using existing resolver
  const subjectSlotResult = useMemo(() => {
    return resolveEffectiveSubjectSlots({
      semesterPlanId,
      schedule,
      expectedWeeklyJP,
      calendar,
      calendarDays,
      schoolDaysPerWeek,
    });
  }, [
    semesterPlanId,
    schedule,
    expectedWeeklyJP,
    calendar,
    calendarDays,
    schoolDaysPerWeek,
  ]);

  // 2. Resolve Meeting schedule using existing resolver
  const scheduleResult = useMemo(() => {
    if (!mapping || !unitExecutionPlan) return null;
    return resolveLearningMeetingSchedule({
      semesterPlanId,
      semester,
      mapping,
      unitExecutionPlan,
      subjectSlotResult,
    });
  }, [
    semesterPlanId,
    semester,
    mapping,
    unitExecutionPlan,
    subjectSlotResult,
  ]);

  // 3. Resolve semester placement to get canonical units for target semester
  const placement = useMemo(() => {
    if (!unitExecutionPlan || !mapping) return null;
    return resolveUnitSemesterPlacement(unitExecutionPlan, mapping);
  }, [unitExecutionPlan, mapping]);

  const semesterUnitIds = useMemo(() => {
    if (!placement || !placement.isValid) return new Set<string>();
    return new Set(semester === 1 ? placement.semester1UnitIds : placement.semester2UnitIds);
  }, [placement, semester]);

  const unitMap = useMemo(() => {
    const map = new Map<string, string>();
    mapping?.units?.forEach((u) => map.set(u.id, u.title));
    return map;
  }, [mapping]);

  const mappingUnitOrderMap = useMemo(() => {
    const map = new Map<string, number>();
    mapping?.units?.forEach((u) => map.set(u.id, u.order));
    return map;
  }, [mapping]);

  // 4. Flatten all canonical meetings for this semester
  const semesterMeetings = useMemo(() => {
    if (!unitExecutionPlan || semesterUnitIds.size === 0) return [];
    const units = (unitExecutionPlan.units || [])
      .filter((u) => semesterUnitIds.has(u.unitId))
      .sort((a, b) => {
        const orderA = mappingUnitOrderMap.get(a.unitId) ?? 999;
        const orderB = mappingUnitOrderMap.get(b.unitId) ?? 999;
        return orderA - orderB;
      });

    const flat: Array<{
      meetingId: string;
      meetingTitle: string;
      unitId: string;
      unitTitle: string;
      order: number;
    }> = [];

    for (const u of units) {
      const uTitle = unitMap.get(u.unitId) || `Unit ${u.unitId}`;
      const sortedMeetings = [...(u.meetings || [])].sort((a, b) => a.order - b.order);
      for (const m of sortedMeetings) {
        flat.push({
          meetingId: m.id,
          meetingTitle: m.title,
          unitId: u.unitId,
          unitTitle: uTitle,
          order: m.order,
        });
      }
    }
    return flat;
  }, [unitExecutionPlan, semesterUnitIds, mappingUnitOrderMap, unitMap]);

  // Handle prerequisite check for mapping & execution plan
  if (!mapping || !unitExecutionPlan) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
        <div className="flex items-center gap-2 text-slate-800 font-bold mb-2">
          <Layers className="w-5 h-5 text-indigo-600" />
          <h3>Jadwal Pertemuan Aktual (Pratinjau)</h3>
        </div>
        <p className="text-xs text-slate-500">
          Pemetaan Unit/Bab atau Rencana Pelaksanaan Pertemuan belum tersedia.
        </p>
      </div>
    );
  }

  // Handle case where calendar is not ready / confirmed
  const isCalendarConfirmed = calendar?.workflowStatus === 'CONFIRMED';
  if (!isCalendarConfirmed || !calendar?.startDate || !calendar?.endDate) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
        <div className="flex items-center gap-2 text-slate-800 font-bold mb-3">
          <Calendar className="w-5 h-5 text-indigo-600" />
          <h3>Jadwal Pertemuan Aktual (Pratinjau)</h3>
        </div>
        <div className="p-4 bg-amber-50 rounded-lg border border-amber-200 text-amber-900 text-xs flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Kalender pendidikan belum ditetapkan.</p>
            <p className="mt-0.5 text-amber-800">
              {subjectSlotResult.errors.length > 0
                ? subjectSlotResult.errors.join(' ')
                : 'Tetapkan dan konfirmasi kalender pendidikan semester ini terlebih dahulu agar tanggal slot aktual dapat dihitung.'}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // Handle case where weekday allocation is incomplete
  const hasInvalidDayOfWeek =
    !schedule ||
    schedule.sessions.length === 0 ||
    schedule.sessions.some(
      (s) => !s.dayOfWeek || s.dayOfWeek < 1 || s.dayOfWeek > (schoolDaysPerWeek === 5 ? 5 : 6)
    );

  if (hasInvalidDayOfWeek || !subjectSlotResult.isReady) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs">
        <div className="flex items-center gap-2 text-slate-800 font-bold mb-3">
          <Calendar className="w-5 h-5 text-indigo-600" />
          <h3>Jadwal Pertemuan Aktual (Pratinjau)</h3>
        </div>
        <div className="p-4 bg-amber-50 rounded-lg border border-amber-200 text-amber-900 text-xs flex items-start gap-2.5">
          <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">Jadwal aktual belum dapat dihitung.</p>
            <p className="mt-0.5 text-amber-800">
              Lengkapi dan simpan Hari Mengajar terlebih dahulu.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // When scheduleResult is available
  const scheduledEntryMap = new Map(
    (scheduleResult?.scheduledEntries || []).map((e) => [e.meetingId, e])
  );

  const totalMeetings = scheduleResult?.totalMeetings ?? semesterMeetings.length;
  const totalAvailableSlots = scheduleResult?.totalAvailableSlots ?? subjectSlotResult.totalMeetingSlots;
  const totalScheduledMeetings = scheduleResult?.totalScheduledMeetings ?? 0;
  const totalUnscheduledMeetings = scheduleResult?.totalUnscheduledMeetings ?? 0;
  const totalActualJP = scheduleResult?.totalActualJP ?? 0;
  const totalExcludedOccurrences = scheduleResult?.totalExcludedOccurrences ?? subjectSlotResult.totalExcludedOccurrences;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
        <div className="flex items-center gap-2">
          <Calendar className="w-5 h-5 text-indigo-600" />
          <div>
            <h3 className="font-bold text-slate-800 text-base">
              Pratinjau Jadwal Pertemuan Aktual (Semester {semester})
            </h3>
            <p className="text-xs text-slate-500">
              Pemetaan pertemuan pembelajaran terhadap slot tanggal dan hari mengajar efektif semester
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-2.5 py-1 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg font-semibold text-xs">
            Kapasitas Perencanaan: {totalMeetings} Pertemuan
          </span>
          <span className="px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg font-semibold text-xs">
            Slot Jadwal Aktual: {totalAvailableSlots} Slot
          </span>
        </div>
      </div>

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
          <span className="text-[11px] font-medium text-slate-500 block">Pertemuan Semester</span>
          <span className="text-xl font-bold text-slate-900 mt-0.5 block">{totalMeetings}</span>
        </div>

        <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
          <span className="text-[11px] font-medium text-slate-500 block">Slot Jadwal Aktual</span>
          <span className="text-xl font-bold text-slate-900 mt-0.5 block">{totalAvailableSlots}</span>
        </div>

        <div className="p-3 bg-emerald-50/70 rounded-xl border border-emerald-200">
          <span className="text-[11px] font-medium text-emerald-800 block">Pertemuan Terjadwal</span>
          <span className="text-xl font-bold text-emerald-700 mt-0.5 block">{totalScheduledMeetings}</span>
        </div>

        <div className={`p-3 rounded-xl border ${totalUnscheduledMeetings > 0 ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-slate-50 border-slate-200 text-slate-900'}`}>
          <span className={`text-[11px] font-medium block ${totalUnscheduledMeetings > 0 ? 'text-amber-800' : 'text-slate-500'}`}>
            Belum Terjadwal
          </span>
          <span className={`text-xl font-bold mt-0.5 block ${totalUnscheduledMeetings > 0 ? 'text-amber-700' : 'text-slate-900'}`}>
            {totalUnscheduledMeetings}
          </span>
        </div>

        <div className="p-3 bg-blue-50/70 rounded-xl border border-blue-200">
          <span className="text-[11px] font-medium text-blue-800 block">JP Aktual Terjadwal</span>
          <span className="text-xl font-bold text-blue-700 mt-0.5 block">{totalActualJP} JP</span>
        </div>

        <div className="p-3 bg-rose-50/70 rounded-xl border border-rose-200">
          <span className="text-[11px] font-medium text-rose-800 block">Hari/Tanggal Terblokir</span>
          <span className="text-xl font-bold text-rose-700 mt-0.5 block">{totalExcludedOccurrences}</span>
        </div>
      </div>

      {/* Mismatch Diagnostics */}
      {totalMeetings > totalAvailableSlots && (
        <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-xl text-amber-900 text-xs flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold">
              Terdapat {totalMeetings - totalAvailableSlots} Pertemuan yang belum memperoleh slot jadwal aktual.
            </p>
            <p className="text-amber-800 mt-0.5">
              Pertemuan tidak dihapus atau dipindahkan otomatis.
            </p>
          </div>
        </div>
      )}

      {totalAvailableSlots > totalMeetings && (
        <div className="p-3.5 bg-blue-50 border border-blue-200 rounded-xl text-blue-900 text-xs flex items-start gap-2.5">
          <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
          <p className="font-medium">
            Terdapat {totalAvailableSlots - totalMeetings} slot jadwal aktual yang belum digunakan.
          </p>
        </div>
      )}

      {/* Meeting Schedule Table */}
      <div className="space-y-2">
        <h4 className="font-bold text-slate-800 text-xs tracking-wide uppercase">
          Daftar Pertemuan dan Alokasi Tanggal Aktual
        </h4>
        <div className="overflow-x-auto border border-slate-200 rounded-xl">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-100 text-slate-700 sticky top-0 font-semibold border-b border-slate-200">
              <tr>
                <th className="py-2.5 px-3 w-12 text-center">No</th>
                <th className="py-2.5 px-3 min-w-[140px]">Bab</th>
                <th className="py-2.5 px-3 min-w-[160px]">Pertemuan</th>
                <th className="py-2.5 px-3 min-w-[180px]">Hari/Tanggal</th>
                <th className="py-2.5 px-3 w-20 text-center">JP</th>
                <th className="py-2.5 px-3 w-36 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {semesterMeetings.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-400">
                    Tidak ada pertemuan yang direncanakan untuk Semester {semester}.
                  </td>
                </tr>
              ) : (
                semesterMeetings.map((m, idx) => {
                  const entry = scheduledEntryMap.get(m.meetingId);
                  const isScheduled = Boolean(entry);

                  return (
                    <tr
                      key={m.meetingId}
                      className={isScheduled ? 'hover:bg-slate-50' : 'bg-amber-50/40 hover:bg-amber-50/60'}
                    >
                      <td className="py-2.5 px-3 text-center font-medium text-slate-500">
                        {idx + 1}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-slate-800">
                        {m.unitTitle}
                      </td>
                      <td className="py-2.5 px-3 font-medium text-slate-700">
                        {m.meetingTitle}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap font-medium text-slate-800">
                        {isScheduled && entry?.date ? (
                          <span>{formatIndonesianDate(entry.date)}</span>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-center whitespace-nowrap font-semibold text-slate-700">
                        {isScheduled && entry?.jp ? (
                          `${entry.jp} JP`
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-center whitespace-nowrap">
                        {isScheduled ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-emerald-100 text-emerald-800 border border-emerald-200 rounded-full font-semibold text-[11px]">
                            <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                            Terjadwal
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 bg-amber-100 text-amber-800 border border-amber-200 rounded-full font-semibold text-[11px]">
                            <AlertTriangle className="w-3 h-3 text-amber-600" />
                            Belum mendapat slot
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Excluded Occurrences Section */}
      {scheduleResult?.excludedOccurrences && scheduleResult.excludedOccurrences.length > 0 && (
        <div className="space-y-2 pt-2 border-t border-slate-100">
          <div className="flex items-center gap-2">
            <Ban className="w-4 h-4 text-rose-600" />
            <h4 className="font-bold text-slate-800 text-xs tracking-wide uppercase">
              Hari Mengajar Terblokir Kalender
            </h4>
          </div>
          <div className="overflow-x-auto border border-rose-200 rounded-xl bg-rose-50/20">
            <table className="w-full text-left text-xs text-slate-600">
              <thead className="bg-rose-100/60 text-rose-900 sticky top-0 font-semibold border-b border-rose-200">
                <tr>
                  <th className="py-2 px-3 w-12 text-center">No</th>
                  <th className="py-2 px-3 min-w-[180px]">Tanggal</th>
                  <th className="py-2 px-3 w-28">Sesi</th>
                  <th className="py-2 px-3 w-20 text-center">JP</th>
                  <th className="py-2 px-3 min-w-[200px]">Alasan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rose-100">
                {scheduleResult.excludedOccurrences.map((occ, idx) => (
                  <tr key={`${occ.sessionId}-${occ.date}-${idx}`} className="hover:bg-rose-50/50">
                    <td className="py-2 px-3 text-center font-medium text-slate-500">
                      {idx + 1}
                    </td>
                    <td className="py-2 px-3 font-semibold text-slate-800 whitespace-nowrap">
                      {formatIndonesianDate(occ.date)}
                    </td>
                    <td className="py-2 px-3 font-medium text-slate-700 whitespace-nowrap">
                      Sesi {occ.sessionId}
                    </td>
                    <td className="py-2 px-3 text-center whitespace-nowrap font-medium text-slate-700">
                      {occ.jp} JP
                    </td>
                    <td className="py-2 px-3 font-medium text-rose-800">
                      <span className="px-2 py-0.5 rounded bg-rose-100 border border-rose-200 text-[10px] font-bold">
                        {mapExcludedReason(occ.reason)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
