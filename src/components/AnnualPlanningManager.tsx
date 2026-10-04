import React, { useState, useMemo, useEffect } from 'react';
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

  const [activeTaskId, setActiveTaskId] = useState<string>('time-s1');

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

  const annualTasks: AnnualPlanningTaskRailItem[] = useMemo(() => {
    const t1Complete = s1TimeReady;
    const t2Complete = s2TimeReady;
    const t3Complete = placementReady;
    const t4Complete = meetingExactReady;
    const t5Complete = hasS1SavedAllocation && hasS2SavedAllocation;

    const t2Locked =
      !t1Complete;

    const t3Locked =
      !(t1Complete && t2Complete);

    const t4Locked =
      !(t1Complete && t2Complete && t3Complete);

    const t5Locked =
      !(t1Complete && t2Complete && t3Complete && t4Complete);

    return [
      {
        id: 'time-s1',
        title: 'Waktu Semester 1',
        status: t1Complete ? 'COMPLETE' : 'PENDING',
        isLocked: false,
        detail: s1SubjectSlots.isReady
          ? `${s1SubjectSlots.totalMeetingSlots} Pertemuan • ${s1SubjectSlots.totalJP} JP`
          : 'Belum dihitung',
      },
      {
        id: 'time-s2',
        title: 'Waktu Semester 2',
        status: t2Complete ? 'COMPLETE' : 'PENDING',
        isLocked: t2Locked,
        lockReason: 'Lengkapi Waktu Semester 1 terlebih dahulu',
        detail: s2SubjectSlots.isReady
          ? `${s2SubjectSlots.totalMeetingSlots} Pertemuan • ${s2SubjectSlots.totalJP} JP`
          : 'Belum dihitung',
      },
      {
        id: 'placement',
        title: 'Pembagian Bab',
        status: t3Complete ? 'COMPLETE' : 'PENDING',
        isLocked: t3Locked,
        lockReason: 'Lengkapi Waktu Semester 1 & 2 terlebih dahulu',
      },
      {
        id: 'meetings',
        title: 'Struktur Pertemuan',
        status: t4Complete
          ? 'COMPLETE'
          : meetingCoverageComplete
          ? 'NEEDS_REVIEW'
          : 'PENDING',
        isLocked: t4Locked,
        lockReason: 'Tetapkan pembagian Unit/Bab Semester 1 & 2 terlebih dahulu',
        detail: meetingCountDetail,
      },
      {
        id: 'time-allocation',
        title: 'Alokasi Waktu',
        status: t5Complete ? 'COMPLETE' : 'PENDING',
        isLocked: t5Locked,
        lockReason: 'Lengkapi Struktur Pertemuan sesuai kapasitas kalender terlebih dahulu',
      },
    ];
  }, [
    s1TimeReady,
    s2TimeReady,
    placementReady,
    meetingExactReady,
    meetingCoverageComplete,
    hasS1SavedAllocation,
    hasS2SavedAllocation,
    s1SubjectSlots,
    s2SubjectSlots,
    meetingCountDetail,
  ]);

  const isAnnualReady = useMemo(() => {
    return annualTasks.every((task) => task.status === 'COMPLETE');
  }, [annualTasks]);

  // Sync activeTaskId if it becomes locked due to data changes
  useEffect(() => {
    const currentActiveItem = annualTasks.find((t) => t.id === activeTaskId);
    if (!currentActiveItem || currentActiveItem.isLocked) {
      // Find first incomplete and unlocked task, otherwise default to first unlocked task
      const firstIncomplete = annualTasks.find((t) => !t.isLocked && t.status !== 'COMPLETE');
      if (firstIncomplete) {
        setActiveTaskId(firstIncomplete.id);
      } else {
        const firstUnlocked = annualTasks.find((t) => !t.isLocked);
        if (firstUnlocked) {
          setActiveTaskId(firstUnlocked.id);
        } else {
          setActiveTaskId('time-s1');
        }
      }
    }
  }, [annualTasks, activeTaskId]);

  const handleSelectTask = (taskId: string) => {
    setActiveTaskId(taskId);
    if (taskId === 'time-s1') {
      setActiveTabSemester(1);
    } else if (taskId === 'time-s2') {
      setActiveTabSemester(2);
    } else if (taskId === 'time-allocation') {
      if (!hasS1SavedAllocation) {
        setActiveTabSemester(1);
      } else if (!hasS2SavedAllocation) {
        setActiveTabSemester(2);
      } else {
        setActiveTabSemester(1);
      }
    }

    window.setTimeout(() => {
      document.getElementById('annual-active-task-panel')?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      });
    }, 50);
  };

  const activeHeaderDetails = useMemo(() => {
    switch (activeTaskId) {
      case 'time-s1':
        return {
          num: 1,
          title: 'Waktu Semester 1',
          desc: 'LENGKAPI Kalender Pendidikan, JP Mingguan, dan Jadwal Mapel Semester 1.',
        };
      case 'time-s2':
        return {
          num: 2,
          title: 'Waktu Semester 2',
          desc: 'LENGKAPI Kalender Pendidikan, JP Mingguan, dan Jadwal Mapel Semester 2.',
        };
      case 'placement':
        return {
          num: 3,
          title: 'Pembagian Bab',
          desc: 'Tetapkan Unit/Bab yang masuk Semester 1 dan Semester 2.',
        };
      case 'meetings':
        return {
          num: 4,
          title: 'Struktur Pertemuan',
          desc: 'Susun Pertemuan sesuai pembagian Bab dan kapasitas kalender.',
        };
      case 'time-allocation':
        return {
          num: 5,
          title: 'Alokasi Waktu',
          desc: 'Tetapkan alokasi waktu pembelajaran.',
        };
      default:
        return { num: 1, title: '', desc: '' };
    }
  }, [activeTaskId]);

  const nextStepCTA = useMemo(() => {
    switch (activeTaskId) {
      case 'time-s1':
        return {
          isReady: s1TimeReady,
          label: 'Lanjut ke Waktu Semester 2',
          targetId: 'time-s2',
        };
      case 'time-s2':
        return {
          isReady: s2TimeReady,
          label: 'Lanjut ke Pembagian Bab',
          targetId: 'placement',
        };
      case 'placement':
        return {
          isReady: placementReady,
          label: 'Lanjut ke Struktur Pertemuan',
          targetId: 'meetings',
        };
      case 'meetings':
        return {
          isReady: meetingExactReady,
          label: 'Lanjut ke Alokasi Waktu',
          targetId: 'time-allocation',
        };
      default:
        return null;
    }
  }, [activeTaskId, s1TimeReady, s2TimeReady, placementReady, meetingExactReady]);



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
        <AnnualPlanningTaskRail tasks={annualTasks} onSelectTask={handleSelectTask} activeTaskId={activeTaskId} />

        <div className="min-w-0 flex-1 space-y-6">
          {/* Annual Summary & Both Semesters Overview Bar */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Semester 1 Overview Card */}
            <div className="p-4 rounded-2xl border bg-white border-slate-200 shadow-2xs">
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
            <div className="p-4 rounded-2xl border bg-white border-slate-200 shadow-2xs">
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

          {/* ACTIVE WORKSPACE CONTAINER */}
          <div id="annual-active-task-panel" className="p-5 rounded-2xl border border-blue-200 bg-blue-50/20 space-y-6 scroll-mt-6 shadow-2xs">
            <div className="border-b border-blue-200/80 pb-4">
              <span className="text-[10px] font-bold text-blue-700 uppercase tracking-wider block">
                Langkah {activeHeaderDetails.num} dari 5
              </span>
              <h3 className="text-lg font-extrabold text-blue-950 mt-1">
                {activeHeaderDetails.title}
              </h3>
              <p className="text-xs text-blue-800/90 mt-1 leading-relaxed">
                {activeHeaderDetails.desc}
              </p>
            </div>

            {/* A. TimePlanningManager Container */}
            <div className={activeTaskId === 'time-s1' || activeTaskId === 'time-s2' || activeTaskId === 'time-allocation' ? 'block animate-in fade-in duration-150' : 'hidden'}>
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
                    viewMode={
                      activeTaskId === 'time-allocation'
                        ? 'ALLOCATION'
                        : 'TIME_SETUP'
                    }
                    explicitSemesterPlanId={activeSelectedPlan.id}
                    onSaveCalendar={onSaveCalendar}
                    onSaveSemesterJPSetting={onSaveSemesterJPSetting}
                    onSaveTimeAllocations={onSaveTimeAllocations}
                    onSaveSubjectWeeklySchedule={onSaveSubjectWeeklySchedule}
                    afterTimeSetup={activeTaskId === 'time-allocation' ? (
                      /* Dalam Task 5 boleh tampil sub-selector kecil */
                      <div className="flex items-center gap-2 mb-4 bg-white p-3 rounded-xl border border-slate-200 shadow-2xs">
                        <span className="text-xs font-bold text-slate-500 uppercase tracking-wide px-1">
                          Pilih Semester Alokasi:
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveTabSemester(1);
                          }}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                            activeTabSemester === 1
                              ? 'bg-blue-900 text-white shadow-xs'
                              : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-300'
                          }`}
                        >
                          Semester 1 {hasS1SavedAllocation && '✓'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveTabSemester(2);
                          }}
                          className={`px-3 py-1.5 rounded-lg text-xs font-bold transition cursor-pointer ${
                            activeTabSemester === 2
                              ? 'bg-blue-900 text-white shadow-xs'
                              : 'bg-white text-slate-700 hover:bg-slate-100 border border-slate-300'
                          }`}
                        >
                          Semester 2 {hasS2SavedAllocation && '✓'}
                        </button>
                      </div>
                    ) : undefined}
                  />
                </div>
              )}
            </div>

            {/* B. UnitSemesterPlanningManager Container */}
            <div id="annual-task-placement" className={activeTaskId === 'placement' ? 'block animate-in fade-in duration-150' : 'hidden'}>
              {mapping && effectiveUnitExecutionPlan && onSaveUnitExecutionPlan && (
                <UnitSemesterPlanningManager
                  mapping={mapping}
                  unitExecutionPlan={effectiveUnitExecutionPlan}
                  s1AvailableJP={s1Capacity?.availableJP ?? null}
                  s2AvailableJP={s2Capacity?.availableJP ?? null}
                  onSave={onSaveUnitExecutionPlan}
                />
              )}
            </div>

            {/* C. UnitExecutionPlanManager Container */}
            <div id="annual-task-meetings" className={activeTaskId === 'meetings' ? 'block animate-in fade-in duration-150 font-sans' : 'hidden'}>
              {mapping && atp && tp && onSaveUnitExecutionPlan && (
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
              )}
            </div>

            {/* Guided CTA Bar for Tasks 1 to 4 */}
            {nextStepCTA && (
              <div className="pt-4 border-t border-blue-200/80 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
                <span className="text-slate-600 font-medium">
                  {nextStepCTA.isReady ? (
                    <span className="text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200 font-bold flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      Langkah ini selesai! Silakan lanjut ke langkah berikutnya.
                    </span>
                  ) : (
                    <span className="text-amber-800 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200 font-bold flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                      Selesaikan dan simpan langkah ini terlebih dahulu.
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  disabled={!nextStepCTA.isReady}
                  onClick={() => handleSelectTask(nextStepCTA.targetId)}
                  className={`px-5 py-2.5 rounded-xl font-bold transition flex items-center gap-2 cursor-pointer ${
                    nextStepCTA.isReady
                      ? 'bg-blue-900 hover:bg-blue-950 text-white shadow-xs'
                      : 'bg-slate-200 text-slate-400 border border-slate-300 cursor-not-allowed'
                  }`}
                >
                  <span>{nextStepCTA.label}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            )}

            {/* Final Guided CTA Bar for Task 5 */}
            {activeTaskId === 'time-allocation' && (
              <div className="pt-4 border-t border-blue-200/80 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs">
                <span className="text-slate-600 font-medium">
                  {hasS1SavedAllocation && hasS2SavedAllocation ? (
                    <span className="text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200 font-bold flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      Seluruh rangkaian Perencanaan Tahunan (Step 08) telah selesai disusun!
                    </span>
                  ) : (
                    <span className="text-amber-800 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-200 font-bold flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 text-amber-600" />
                      Selesaikan dan simpan Alokasi Waktu Semester 1 &amp; 2 terlebih dahulu.
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  disabled={!(hasS1SavedAllocation && hasS2SavedAllocation)}
                  onClick={onNextStep}
                  className={`px-5 py-2.5 rounded-xl font-bold transition flex items-center gap-2 cursor-pointer ${
                    hasS1SavedAllocation && hasS2SavedAllocation
                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-xs'
                      : 'bg-slate-200 text-slate-400 border border-slate-300 cursor-not-allowed'
                  }`}
                >
                  <span>Lanjut ke Pilih Semester Aktif (09)</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>

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
      </div>
    </div>
  );
};
