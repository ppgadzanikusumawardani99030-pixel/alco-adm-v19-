import React, { useState, useMemo } from 'react';
import {
  CalendarRange,
  ArrowRight,
  ArrowLeft,
  Calendar,
  CheckCircle2,
  AlertCircle,
  Layers,
} from 'lucide-react';
import {
  SchoolData,
  TeacherProfile,
  AcademicSetting,
  AcademicCalendar,
  CalendarDay,
  TimeAllocation,
  SemesterPlan,
  YearPlan,
  ATPData,
  TPData,
  ATPUnitMappingData,
  UnitExecutionPlanData,
  K13Analysis,
  SubjectWeeklySchedule,
} from '../types';
import {
  AnnualPlanningTaskRail,
  AnnualPlanningTaskRailItem,
  AnnualPlanningTaskStatus,
} from './AnnualPlanningTaskRail';
import { getSemesterDataV5, loadStorageV5 } from '../services/storageV5';
import { resolveSemesterCapacityV5, getSubjectJP } from '../services/jpEngine';
import { TimePlanningManager } from './administration/TimePlanningManager';
import { UnitExecutionPlanManager } from './UnitExecutionPlanManager';
import { UnitSemesterPlanningManager } from './UnitSemesterPlanningManager';
import {
  validateUnitExecutionPlan,
  createEmptyUnitExecutionPlanData,
} from '../services/unitExecutionPlanService';
import { resolveUnitSemesterPlacement } from '../services/unitSemesterPlanningService';
import { resolveEffectiveSubjectSlots } from '../services/subjectScheduleService';

export interface AnnualPlanningManagerProps {
  school: SchoolData;
  profile: TeacherProfile;
  academicSetting: AcademicSetting;
  yearPlan?: YearPlan;
  semesterPlans: SemesterPlan[];
  mapping?: ATPUnitMappingData;
  unitExecutionPlan?: UnitExecutionPlanData;
  tp?: TPData;
  atp?: ATPData;
  k13Analysis?: K13Analysis;
  onSaveCalendar: (calendar: AcademicCalendar, days: CalendarDay[], explicitSemesterPlanId?: string) => boolean;
  onSaveSemesterJPSetting?: (actualWeeklyJP: number | null, explicitSemesterPlanId?: string) => boolean;
  onSaveTimeAllocations: (allocations: TimeAllocation[], explicitSemesterPlanId?: string) => boolean;
  onSaveUnitExecutionPlan?: (plan: UnitExecutionPlanData) => boolean;
  onSaveSubjectWeeklySchedule?: (schedule: SubjectWeeklySchedule, explicitSemesterPlanId?: string) => boolean;
  onNextStep: () => void;
  onBackToMapping: () => void;
}

export const AnnualPlanningManager: React.FC<AnnualPlanningManagerProps> = ({
  school,
  profile,
  academicSetting,
  yearPlan,
  semesterPlans,
  mapping,
  unitExecutionPlan,
  tp,
  atp,
  k13Analysis,
  onSaveCalendar,
  onSaveSemesterJPSetting,
  onSaveTimeAllocations,
  onSaveUnitExecutionPlan,
  onSaveSubjectWeeklySchedule,
  onNextStep,
  onBackToMapping,
}) => {
  // Identify Semester 1 and Semester 2 plans from the year hierarchy
  const sem1Plan = useMemo(() => {
    return semesterPlans.find((sp) => sp.semester === 1);
  }, [semesterPlans]);

  const sem2Plan = useMemo(() => {
    return semesterPlans.find((sp) => sp.semester === 2);
  }, [semesterPlans]);

  // Selected semester tab in the annual planning workspace (defaults to Semester 1)
  const [activeTabSemester, setActiveTabSemester] = useState<1 | 2>(1);

  // Official benchmark rule
  const officialRule = useMemo(() => {
    return getSubjectJP({
      curriculum: academicSetting.curriculum,
      level: academicSetting.level,
      grade: academicSetting.grade,
      subject: academicSetting.subject,
    });
  }, [academicSetting]);

  // Resolve V5 storage state reactively
  const v5State = useMemo(() => {
    try {
      return loadStorageV5();
    } catch {
      return { semesterPlans: [], semesterData: { academicCalendar: [], timeAllocation: [] }, semesterJPSettings: [] };
    }
  }, [semesterPlans, academicSetting]);

  // Semester 1 data and capacity
  const s1Data = useMemo(() => {
    if (!sem1Plan) return null;
    try {
      return getSemesterDataV5(sem1Plan.id);
    } catch {
      return null;
    }
  }, [sem1Plan, v5State]);

  const s1Capacity = useMemo(() => {
    if (!sem1Plan) return null;
    try {
      return resolveSemesterCapacityV5(sem1Plan.id, v5State);
    } catch {
      return null;
    }
  }, [sem1Plan, v5State, s1Data]);

  // Semester 2 data and capacity
  const s2Data = useMemo(() => {
    if (!sem2Plan) return null;
    try {
      return getSemesterDataV5(sem2Plan.id);
    } catch {
      return null;
    }
  }, [sem2Plan, v5State]);

  const s2Capacity = useMemo(() => {
    if (!sem2Plan) return null;
    try {
      return resolveSemesterCapacityV5(sem2Plan.id, v5State);
    } catch {
      return null;
    }
  }, [sem2Plan, v5State, s2Data]);

  // Total planned annual JP
  const totalAnnualAvailableJP = useMemo(() => {
    const s1 = s1Capacity?.availableJP ?? 0;
    const s2 = s2Capacity?.availableJP ?? 0;
    if (!s1Capacity?.isReady && !s2Capacity?.isReady) return null;
    return s1 + s2;
  }, [s1Capacity, s2Capacity]);

  const activeSelectedPlan = activeTabSemester === 1 ? sem1Plan : sem2Plan;
  const activeSelectedData = activeTabSemester === 1 ? s1Data : s2Data;

  const hasS1SavedAllocation = useMemo(() => {
    const allocs = s1Data?.timeAllocation;
    if (!Array.isArray(allocs) || allocs.length === 0) return false;
    const total = allocs.reduce((sum, a) => sum + (Number(a.allocatedJP ?? a.jp) || 0), 0);
    if (total <= 0) return false;
    if (s1Capacity?.availableJP !== null && s1Capacity?.availableJP !== undefined && s1Capacity.availableJP > 0 && total > s1Capacity.availableJP) {
      return false;
    }
    return true;
  }, [s1Data?.timeAllocation, s1Capacity?.availableJP]);

  const hasS2SavedAllocation = useMemo(() => {
    const allocs = s2Data?.timeAllocation;
    if (!Array.isArray(allocs) || allocs.length === 0) return false;
    const total = allocs.reduce((sum, a) => sum + (Number(a.allocatedJP ?? a.jp) || 0), 0);
    if (total <= 0) return false;
    if (s2Capacity?.availableJP !== null && s2Capacity?.availableJP !== undefined && s2Capacity.availableJP > 0 && total > s2Capacity.availableJP) {
      return false;
    }
    return true;
  }, [s2Data?.timeAllocation, s2Capacity?.availableJP]);

  const meetingValidation = useMemo(() => {
    if (!mapping) return null;
    return validateUnitExecutionPlan(
      unitExecutionPlan || createEmptyUnitExecutionPlanData(mapping),
      mapping,
      atp || null,
      tp || null
    );
  }, [unitExecutionPlan, mapping, atp, tp]);

  const effectiveUnitExecutionPlan = useMemo(() => {
    if (!mapping) return null;
    return unitExecutionPlan ?? createEmptyUnitExecutionPlanData(mapping);
  }, [unitExecutionPlan, mapping]);

  const placementValidation = useMemo(() => {
    if (!mapping || !effectiveUnitExecutionPlan) return null;
    return resolveUnitSemesterPlacement(effectiveUnitExecutionPlan, mapping);
  }, [effectiveUnitExecutionPlan, mapping]);

  const placementReady = Boolean(
    effectiveUnitExecutionPlan?.semesterPlacement &&
    placementValidation &&
    placementValidation.isComplete
  );

  const s1SubjectSlots = useMemo(() => {
    if (!sem1Plan || !s1Data?.academicCalendar || !s1Data?.subjectWeeklySchedule || !s1Capacity?.actualScheduledWeeklyJP) {
      return { isReady: false, totalMeetingSlots: 0, totalJP: 0 };
    }
    return resolveEffectiveSubjectSlots({
      semesterPlanId: sem1Plan.id,
      schedule: s1Data.subjectWeeklySchedule,
      expectedWeeklyJP: s1Capacity.actualScheduledWeeklyJP,
      calendar: s1Data.academicCalendar.calendar,
      calendarDays: s1Data.academicCalendar.days,
      schoolDaysPerWeek: s1Data.academicCalendar.calendar.schoolDaysPerWeek,
    });
  }, [sem1Plan, s1Data, s1Capacity]);

  const s2SubjectSlots = useMemo(() => {
    if (!sem2Plan || !s2Data?.academicCalendar || !s2Data?.subjectWeeklySchedule || !s2Capacity?.actualScheduledWeeklyJP) {
      return { isReady: false, totalMeetingSlots: 0, totalJP: 0 };
    }
    return resolveEffectiveSubjectSlots({
      semesterPlanId: sem2Plan.id,
      schedule: s2Data.subjectWeeklySchedule,
      expectedWeeklyJP: s2Capacity.actualScheduledWeeklyJP,
      calendar: s2Data.academicCalendar.calendar,
      calendarDays: s2Data.academicCalendar.days,
      schoolDaysPerWeek: s2Data.academicCalendar.calendar.schoolDaysPerWeek,
    });
  }, [sem2Plan, s2Data, s2Capacity]);

  const isK13Curriculum = academicSetting.curriculumType === 'K13' || academicSetting.curriculum?.includes('2013');

  const meetingCounts = useMemo(() => {
    const empty = { semester1: 0, semester2: 0 };
    if (!effectiveUnitExecutionPlan || !placementValidation?.isComplete) return empty;

    const s1UnitIds = new Set(placementValidation.semester1UnitIds);
    return (effectiveUnitExecutionPlan.units || []).reduce((acc, unit) => {
      const count = unit.meetings?.length || 0;
      if (s1UnitIds.has(unit.unitId)) {
        acc.semester1 += count;
      } else {
        acc.semester2 += count;
      }
      return acc;
    }, empty);
  }, [effectiveUnitExecutionPlan, placementValidation]);

  const s1TimeReady = Boolean(s1Capacity?.isReady && s1SubjectSlots.isReady);
  const s2TimeReady = Boolean(s2Capacity?.isReady && s2SubjectSlots.isReady);
  const s1MeetingCountMatches = meetingCounts.semester1 === s1SubjectSlots.totalMeetingSlots;
  const s2MeetingCountMatches = meetingCounts.semester2 === s2SubjectSlots.totalMeetingSlots;
  const meetingCountDetail = `S1 ${meetingCounts.semester1}/${s1SubjectSlots.totalMeetingSlots} • S2 ${meetingCounts.semester2}/${s2SubjectSlots.totalMeetingSlots} Pertemuan`;
  const meetingCoverageComplete = Boolean(placementReady && meetingValidation?.isComplete);
  const meetingExactReady = Boolean(
    meetingCoverageComplete &&
    s1SubjectSlots.isReady &&
    s2SubjectSlots.isReady &&
    s1MeetingCountMatches &&
    s2MeetingCountMatches
  );

  const baseTaskStatuses = useMemo(() => {
    const statuses: AnnualPlanningTaskStatus[] = [
      s1TimeReady ? 'COMPLETE' : 'PENDING',
      s2TimeReady ? 'COMPLETE' : 'PENDING',
      placementReady ? 'COMPLETE' : 'PENDING',
      meetingExactReady
        ? 'COMPLETE'
        : meetingCoverageComplete
        ? 'NEEDS_REVIEW'
        : 'PENDING',
      hasS1SavedAllocation && hasS2SavedAllocation ? 'COMPLETE' : 'PENDING',
    ];
    const currentIndex = statuses.findIndex((status) => status !== 'COMPLETE');
    if (currentIndex >= 0) {
      if (statuses[currentIndex] === 'PENDING') {
        statuses[currentIndex] = 'CURRENT';
      }
    }
    return statuses;
  }, [
    s1TimeReady,
    s2TimeReady,
    placementReady,
    meetingExactReady,
    meetingCoverageComplete,
    hasS1SavedAllocation,
    hasS2SavedAllocation,
  ]);

  const annualTasks: AnnualPlanningTaskRailItem[] = useMemo(() => [
    {
      id: 'time-s1',
      title: 'Waktu Semester 1',
      status: baseTaskStatuses[0],
      detail: s1SubjectSlots.isReady
        ? `${s1SubjectSlots.totalMeetingSlots} Pertemuan • ${s1SubjectSlots.totalJP} JP`
        : 'Belum dihitung',
    },
    {
      id: 'time-s2',
      title: 'Waktu Semester 2',
      status: baseTaskStatuses[1],
      detail: s2SubjectSlots.isReady
        ? `${s2SubjectSlots.totalMeetingSlots} Pertemuan • ${s2SubjectSlots.totalJP} JP`
        : 'Belum dihitung',
    },
    {
      id: 'placement',
      title: 'Pembagian Bab',
      status: baseTaskStatuses[2],
    },
    {
      id: 'meetings',
      title: 'Struktur Pertemuan',
      status: baseTaskStatuses[3],
      detail: meetingCountDetail,
    },
    {
      id: 'time-allocation',
      title: 'Alokasi Waktu',
      status: baseTaskStatuses[4],
    },
  ], [baseTaskStatuses, s1SubjectSlots, s2SubjectSlots, meetingCountDetail]);

  const isAnnualReady = annualTasks.every((task) => task.status === 'COMPLETE');

  const handleSelectTask = (taskId: string) => {
    let targetId = 'time-planning-container';
    if (taskId === 'time-s1') {
      setActiveTabSemester(1);
    } else if (taskId === 'time-s2') {
      setActiveTabSemester(2);
    } else if (taskId === 'placement') {
      targetId = 'annual-section-semester-placement';
    } else if (taskId === 'meetings') {
      targetId = 'annual-section-meetings';
    } else if (taskId === 'time-allocation') {
      setActiveTabSemester(hasS1SavedAllocation ? 2 : 1);
      targetId = 'annual-section-time-allocation';
    }

    window.setTimeout(() => {
      document.getElementById(targetId)?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }, 0);
  };

  const step09Guidance = useMemo(() => {
    if (isAnnualReady) return null;
    const firstOpenTask = annualTasks.find((task) => task.status !== 'COMPLETE');
    if (firstOpenTask?.id === 'time-s1') {
      return 'Lengkapi Waktu Semester 1: Kalender, JP Mingguan, dan Jadwal Mapel.';
    }
    if (firstOpenTask?.id === 'time-s2') {
      return 'Lengkapi Waktu Semester 2: Kalender, JP Mingguan, dan Jadwal Mapel.';
    }
    if (firstOpenTask?.id === 'placement') {
      return 'Tetapkan pembagian Unit/Bab ke Semester 1 dan Semester 2.';
    }
    if (firstOpenTask?.id === 'meetings') {
      return 'Lengkapi Struktur Pertemuan sesuai kapasitas kalender.';
    }
    if (firstOpenTask?.id === 'time-allocation') {
      return 'Susun dan simpan Alokasi Waktu Semester 1 dan Semester 2.';
    }
    return null;
  }, [isAnnualReady, annualTasks]);

  const afterTimeSetup = (
    <>
      {mapping && effectiveUnitExecutionPlan && onSaveUnitExecutionPlan && (
        <div id="annual-section-semester-placement">
          <UnitSemesterPlanningManager
            mapping={mapping}
            unitExecutionPlan={effectiveUnitExecutionPlan}
            s1AvailableJP={s1Capacity?.availableJP ?? null}
            s2AvailableJP={s2Capacity?.availableJP ?? null}
            onSave={onSaveUnitExecutionPlan}
          />
        </div>
      )}

      {mapping && atp && tp && onSaveUnitExecutionPlan && (
        <div id="annual-section-meetings">
          <UnitExecutionPlanManager
            mapping={mapping}
            unitExecutionPlan={unitExecutionPlan}
            atp={atp}
            tp={tp}
            onSave={onSaveUnitExecutionPlan}
            meetingCapacity={{
              semester1: {
                isReady: Boolean(s1SubjectSlots.isReady),
                targetMeetingCount:
                  s1SubjectSlots.isReady
                    ? s1SubjectSlots.totalMeetingSlots
                    : 0,
                totalJP:
                  s1SubjectSlots.isReady
                    ? s1SubjectSlots.totalJP
                    : 0,
              },
              semester2: {
                isReady: Boolean(s2SubjectSlots.isReady),
                targetMeetingCount:
                  s2SubjectSlots.isReady
                    ? s2SubjectSlots.totalMeetingSlots
                    : 0,
                totalJP:
                  s2SubjectSlots.isReady
                    ? s2SubjectSlots.totalJP
                    : 0,
              },
            }}
          />
        </div>
      )}
    </>
  );

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-lg bg-blue-100 text-blue-900 text-xs font-bold flex items-center justify-center">
                08
              </span>
              <h3 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
                <CalendarRange className="w-5 h-5 text-blue-700" />
                <span>Perencanaan Tahunan — Pertemuan, Kalender & Alokasi Waktu</span>
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-1 max-w-3xl leading-relaxed">
              Siapkan <strong>Waktu Semester</strong>, <strong>Pembagian Bab</strong>, <strong>Struktur Pertemuan</strong>, serta <strong>Alokasi Waktu</strong> untuk Semester 1 & 2 secara terpadu sebelum memilih semester aktif.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isAnnualReady ? (
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>Rencana Tahunan Siap</span>
              </div>
            ) : (
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-bold">
                <AlertCircle className="w-4 h-4 text-amber-600" />
                <span>Belum Lengkap</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-5 items-start">
        <AnnualPlanningTaskRail tasks={annualTasks} onSelectTask={handleSelectTask} />

        <div className="min-w-0 flex-1 space-y-6">
      {/* Annual Summary & Both Semesters Overview Bar */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Semester 1 Overview Card */}
        <div
          onClick={() => setActiveTabSemester(1)}
          className={`p-4 rounded-2xl border transition cursor-pointer ${
            activeTabSemester === 1
              ? 'bg-blue-50/70 border-blue-400 ring-2 ring-blue-500/20 shadow-xs'
              : 'bg-white border-slate-200/80 hover:bg-slate-50 shadow-2xs'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-blue-700" />
              <span>Waktu Semester 1</span>
            </span>
            {s1Capacity?.isReady ? (
              <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                Siap
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 text-[10px] font-bold">
                Perlu Dilengkapi
              </span>
            )}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div className="bg-white/80 p-2 rounded-xl border border-slate-200/60">
              <div className="text-[10px] text-slate-500 font-medium">Hari / Pekan Efektif</div>
              <div className="font-bold text-slate-800 mt-0.5">
                {s1Capacity?.effectiveLearningDays ?? '-'} Hari • {s1Capacity?.effectiveWeeks ?? '-'} Pekan
              </div>
            </div>
            <div className="bg-white/80 p-2 rounded-xl border border-slate-200/60">
              <div className="text-[10px] text-slate-500 font-medium">JP Aktual • Tersedia</div>
              <div className="font-bold text-blue-900 mt-0.5">
                {!isK13Curriculum ? (
                  s1SubjectSlots.isReady ? (
                  <span>{s1SubjectSlots.totalMeetingSlots} Pertemuan • {s1SubjectSlots.totalJP} JP Aktual</span>
                  ) : (
                    <span>Belum dihitung</span>
                  )
                ) : (
                  <span>{s1Capacity?.actualScheduledWeeklyJP ?? '-'} JP/mgg • {s1Capacity?.availableJP ?? '-'} Total JP</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Semester 2 Overview Card */}
        <div
          onClick={() => setActiveTabSemester(2)}
          className={`p-4 rounded-2xl border transition cursor-pointer ${
            activeTabSemester === 2
              ? 'bg-blue-50/70 border-blue-400 ring-2 ring-blue-500/20 shadow-xs'
              : 'bg-white border-slate-200/80 hover:bg-slate-50 shadow-2xs'
          }`}
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5 text-blue-700" />
              <span>Waktu Semester 2</span>
            </span>
            {s2Capacity?.isReady ? (
              <span className="px-2 py-0.5 rounded-md bg-emerald-100 text-emerald-800 text-[10px] font-bold">
                Siap
              </span>
            ) : (
              <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-800 text-[10px] font-bold">
                Perlu Dilengkapi
              </span>
            )}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div className="bg-white/80 p-2 rounded-xl border border-slate-200/60">
              <div className="text-[10px] text-slate-500 font-medium">Hari / Pekan Efektif</div>
              <div className="font-bold text-slate-800 mt-0.5">
                {s2Capacity?.effectiveLearningDays ?? '-'} Hari • {s2Capacity?.effectiveWeeks ?? '-'} Pekan
              </div>
            </div>
            <div className="bg-white/80 p-2 rounded-xl border border-slate-200/60">
              <div className="text-[10px] text-slate-500 font-medium">JP Aktual • Tersedia</div>
              <div className="font-bold text-blue-900 mt-0.5">
                {!isK13Curriculum ? (
                  s2SubjectSlots.isReady ? (
                  <span>{s2SubjectSlots.totalMeetingSlots} Pertemuan • {s2SubjectSlots.totalJP} JP Aktual</span>
                  ) : (
                    <span>Belum dihitung</span>
                  )
                ) : (
                  <span>{s2Capacity?.actualScheduledWeeklyJP ?? '-'} JP/mgg • {s2Capacity?.availableJP ?? '-'} Total JP</span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Total Annual Benchmark Card */}
        <div className="p-4 rounded-2xl border border-slate-200/80 bg-slate-900 text-white shadow-2xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-indigo-300 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-indigo-400" />
              <span>Kapasitas Pembelajaran 1 Tahun</span>
            </span>
            <span className="text-[10px] bg-indigo-800/80 text-indigo-200 px-2 py-0.5 rounded-md font-bold">
              {academicSetting.academicYear}
            </span>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <div className="bg-slate-800/90 p-2 rounded-xl border border-slate-700/60">
              <div className="text-[10px] text-slate-400 font-medium">Total JP Efektif (S1+S2)</div>
              <div className="font-bold text-white mt-0.5">
                {!isK13Curriculum && s1SubjectSlots.isReady && s2SubjectSlots.isReady ? (
                  <span>{s1SubjectSlots.totalJP + s2SubjectSlots.totalJP} JP Aktual ({s1SubjectSlots.totalMeetingSlots + s2SubjectSlots.totalMeetingSlots} Pertemuan)</span>
                ) : (
                  <span>{totalAnnualAvailableJP !== null ? `${totalAnnualAvailableJP} JP` : 'Belum Lengkap'}</span>
                )}
              </div>
            </div>
            <div className="bg-slate-800/90 p-2 rounded-xl border border-slate-700/60">
              <div className="text-[10px] text-slate-400 font-medium">Standar Regulasi</div>
              <div className="font-bold text-indigo-300 mt-0.5">
                {officialRule.annualJP ? `${officialRule.annualJP} JP / thn` : `${officialRule.weeklyJP || '-'} JP / mgg`}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Tab Selector for Active Semester Workspace */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
        <button
          type="button"
          onClick={() => setActiveTabSemester(1)}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer ${
            activeTabSemester === 1
              ? 'bg-blue-900 text-white shadow-sm'
              : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-300'
          }`}
        >
          <Calendar className="w-4 h-4" />
          <span>Waktu Semester 1</span>
          {s1Capacity?.isReady && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
        </button>

        <button
          type="button"
          onClick={() => setActiveTabSemester(2)}
          className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer ${
            activeTabSemester === 2
              ? 'bg-blue-900 text-white shadow-sm'
              : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-300'
          }`}
        >
          <Calendar className="w-4 h-4" />
          <span>Waktu Semester 2</span>
          {s2Capacity?.isReady && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
        </button>
      </div>

      {/* Embedded TimePlanningManager for the selected semester */}
      {activeSelectedPlan && (
        <div id="time-planning-container" className="pt-1 scroll-mt-4">
          <TimePlanningManager
            school={school}
            profile={profile}
            academicSetting={{
              ...academicSetting,
              id: activeSelectedPlan.id,
              semester: activeSelectedPlan.semester === 1 ? '1 (Ganjil)' : '2 (Genap)',
            }}
            atp={atp}
            k13Analysis={k13Analysis}
            calendar={activeSelectedData?.academicCalendar?.calendar}
            calendarDays={activeSelectedData?.academicCalendar?.days || []}
            timeAllocations={activeSelectedData?.timeAllocation || []}
            semesterJPSetting={activeSelectedData?.semesterJPSetting}
            subjectWeeklySchedule={activeSelectedData?.subjectWeeklySchedule}
            explicitSemesterPlanId={activeSelectedPlan.id}
            onSaveCalendar={onSaveCalendar}
            onSaveSemesterJPSetting={onSaveSemesterJPSetting}
            onSaveTimeAllocations={onSaveTimeAllocations}
            onSaveSubjectWeeklySchedule={onSaveSubjectWeeklySchedule}
            afterTimeSetup={afterTimeSetup}
          />
        </div>
      )}
        </div>
      </div>

      {/* Bottom Navigation */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-slate-200">
        <button
          id="btn-back-to-mapping"
          type="button"
          onClick={onBackToMapping}
          className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 shadow-xs transition cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Kembali ke Pemetaan Unit/Bab (07)</span>
        </button>

        <div className="flex flex-col items-end gap-1.5 w-full sm:w-auto">
          {step09Guidance && (
            <span className="text-xs text-amber-800 bg-amber-50 border border-amber-200 px-3 py-1 rounded-lg font-medium text-right">
              {step09Guidance}
            </span>
          )}
          <button
            id="btn-next-to-semester"
            type="button"
            disabled={!isAnnualReady}
            onClick={() => {
              if (isAnnualReady) {
                onNextStep();
              }
            }}
            className={`w-full sm:w-auto flex items-center justify-center gap-2 py-2.5 px-6 rounded-xl text-sm font-semibold transition ${
              isAnnualReady
                ? 'bg-blue-900 hover:bg-blue-950 text-white shadow-sm cursor-pointer'
                : 'bg-slate-200 text-slate-400 border border-slate-300 cursor-not-allowed'
            }`}
          >
            <span>Lanjut ke Pilih Semester Aktif (09)</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
