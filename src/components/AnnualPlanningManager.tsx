import React, { useState, useMemo } from 'react';
import {
  CalendarRange,
  ArrowRight,
  ArrowLeft,
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Layers,
  ChevronRight,
  ShieldCheck,
  Info,
} from 'lucide-react';
import {
  SchoolData,
  TeacherProfile,
  AcademicSetting,
  AcademicCalendar,
  CalendarDay,
  TimeAllocation,
  SemesterJPSetting,
  SemesterPlan,
  YearPlan,
  ATPData,
  K13Analysis,
} from '../types';
import { getSemesterDataV5, loadStorageV5 } from '../services/storageV5';
import { resolveSemesterCapacityV5, getSubjectJP } from '../services/jpEngine';
import { TimePlanningManager } from './administration/TimePlanningManager';

export interface AnnualPlanningManagerProps {
  school: SchoolData;
  profile: TeacherProfile;
  academicSetting: AcademicSetting;
  yearPlan?: YearPlan;
  semesterPlans: SemesterPlan[];
  atp?: ATPData;
  k13Analysis?: K13Analysis;
  onSaveCalendar: (calendar: AcademicCalendar, days: CalendarDay[], explicitSemesterPlanId?: string) => void;
  onSaveSemesterJPSetting?: (actualWeeklyJP: number | null, explicitSemesterPlanId?: string) => void;
  onSaveTimeAllocations: (allocations: TimeAllocation[], explicitSemesterPlanId?: string) => void;
  onNextStep: () => void;
  onBackToMapping: () => void;
}

export const AnnualPlanningManager: React.FC<AnnualPlanningManagerProps> = ({
  school,
  profile,
  academicSetting,
  yearPlan,
  semesterPlans,
  atp,
  k13Analysis,
  onSaveCalendar,
  onSaveSemesterJPSetting,
  onSaveTimeAllocations,
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

  const isAnnualReady = Boolean(s1Capacity?.isReady && s2Capacity?.isReady);

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
                <span>Perencanaan Tahunan — Kalender Akademik & JP Semester 1 & 2</span>
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-1 max-w-3xl leading-relaxed">
              Siapkan dan tetapkan <strong>Kalender Pendidikan</strong> serta <strong>JP Mingguan Aktual</strong> untuk Semester 1 (Ganjil) dan Semester 2 (Genap) secara terpadu dalam satu ruang kerja tahunan sebelum memilih semester aktif.
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
                <span>Lengkapi S1 & S2</span>
              </div>
            )}
          </div>
        </div>
      </div>

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
              <span>Semester 1 (Ganjil)</span>
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
                {s1Capacity?.actualScheduledWeeklyJP ?? '-'} JP/mgg • {s1Capacity?.availableJP ?? '-'} Total JP
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
              <span>Semester 2 (Genap)</span>
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
                {s2Capacity?.actualScheduledWeeklyJP ?? '-'} JP/mgg • {s2Capacity?.availableJP ?? '-'} Total JP
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
                {totalAnnualAvailableJP !== null ? `${totalAnnualAvailableJP} JP` : 'Belum Lengkap'}
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
          <span>Pengaturan Semester 1 (Ganjil)</span>
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
          <span>Pengaturan Semester 2 (Genap)</span>
          {s2Capacity?.isReady && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
        </button>
      </div>

      {/* Embedded TimePlanningManager for the selected semester */}
      {activeSelectedPlan && (
        <div key={activeSelectedPlan.id} className="pt-1">
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
            explicitSemesterPlanId={activeSelectedPlan.id}
            onSaveCalendar={onSaveCalendar}
            onSaveSemesterJPSetting={onSaveSemesterJPSetting}
            onSaveTimeAllocations={onSaveTimeAllocations}
          />
        </div>
      )}

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

        <button
          id="btn-next-to-semester"
          type="button"
          onClick={onNextStep}
          className="w-full sm:w-auto flex items-center justify-center gap-2 bg-blue-900 hover:bg-blue-950 text-white py-2.5 px-6 rounded-xl text-sm font-semibold shadow-sm transition cursor-pointer"
        >
          <span>Lanjut ke Pilih Semester Aktif (09)</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
