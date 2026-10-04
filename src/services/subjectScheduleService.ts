import {
  SubjectWeeklySchedule,
  AcademicCalendar,
  CalendarDay,
} from '../types';
import { getEffectiveWeeksList, normalizeCalendarDayStatus } from './jpEngine';

export interface SubjectScheduleValidationResult {
  isValid: boolean;
  isComplete: boolean;
  isStale: boolean;
  totalWeeklyJP: number;
  errors: string[];
  warnings: string[];
}

export interface EffectiveSubjectSlot {
  id: string;
  semesterPlanId: string;
  sessionId: string;
  date: string; // YYYY-MM-DD
  dayOfWeek: 1 | 2 | 3 | 4 | 5 | 6;
  jp: number;
  weekIndex: number;
  month: number;
  year: number;
}

export interface ExcludedSubjectOccurrence {
  sessionId: string;
  date: string;
  dayOfWeek: 1 | 2 | 3 | 4 | 5 | 6;
  jp: number;
  reason: string;
}

export interface EffectiveSubjectSlotResult {
  isValid: boolean;
  isComplete: boolean;
  isReady: boolean;
  isStale: boolean;

  errors: string[];
  warnings: string[];

  slots: EffectiveSubjectSlot[];
  excludedOccurrences: ExcludedSubjectOccurrence[];

  totalMeetingSlots: number;
  totalJP: number;
  totalExcludedOccurrences: number;
}

/**
 * Validates a SubjectWeeklySchedule against expected weekly JP and school days per week.
 */
export function validateSubjectWeeklySchedule(
  schedule: SubjectWeeklySchedule | undefined,
  expectedWeeklyJP: number | null,
  schoolDaysPerWeek?: number | null
): SubjectScheduleValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!schedule) {
    return {
      isValid: true,
      isComplete: false,
      isStale: false,
      totalWeeklyJP: 0,
      errors: [],
      warnings: [],
    };
  }

  if (expectedWeeklyJP === null || expectedWeeklyJP <= 0) {
    errors.push('JP mingguan canonical belum ditentukan atau bernilai 0.');
    return {
      isValid: false,
      isComplete: false,
      isStale: false,
      totalWeeklyJP: 0,
      errors,
      warnings,
    };
  }

  const isStale = schedule.basedOnWeeklyJP !== expectedWeeklyJP;
  if (isStale) {
    errors.push(`Pola jadwal stale: basedOnWeeklyJP (${schedule.basedOnWeeklyJP}) tidak cocok dengan JP mingguan saat ini (${expectedWeeklyJP}).`);
  }

  const sessions = schedule.sessions || [];
  if (sessions.length === 0) {
    errors.push('Pola jadwal belum memiliki sesi.');
  }

  const sessionIds = new Set<string>();
  const orders = new Set<number>();
  let totalWeeklyJP = 0;

  for (const s of sessions) {
    if (!s.id || !s.id.trim()) {
      errors.push('ID sesi tidak boleh kosong.');
    } else if (sessionIds.has(s.id)) {
      errors.push(`ID sesi duplikat: ${s.id}`);
    } else {
      sessionIds.add(s.id);
    }

    if (!s.dayOfWeek || ![1, 2, 3, 4, 5, 6].includes(s.dayOfWeek)) {
      errors.push(`Hari dalam seminggu tidak valid untuk sesi ${s.id}.`);
    } else if (schoolDaysPerWeek === 5 && s.dayOfWeek === 6) {
      errors.push('Hari Sabtu (6) tidak valid untuk sekolah 5 hari (schoolDaysPerWeek = 5).');
    }

    if (typeof s.jp !== 'number' || s.jp <= 0 || !Number.isInteger(s.jp)) {
      errors.push(`Jumlah JP untuk sesi ${s.id} harus berupa integer positif.`);
    } else {
      totalWeeklyJP += s.jp;
    }

    if (typeof s.order !== 'number' || s.order <= 0 || !Number.isInteger(s.order)) {
      errors.push(`Order sesi tidak valid untuk sesi ${s.id}.`);
    } else if (orders.has(s.order)) {
      errors.push(`Order sesi duplikat: ${s.order}`);
    } else {
      orders.add(s.order);
    }
  }

  if (totalWeeklyJP !== expectedWeeklyJP) {
    errors.push(`Total JP sesi (${totalWeeklyJP} JP) tidak sama dengan JP mingguan canonical (${expectedWeeklyJP} JP).`);
  }

  const isValid = errors.filter((e) => !e.includes('stale')).length === 0;
  const isComplete = !isStale && errors.length === 0 && sessions.length > 0 && totalWeeklyJP === expectedWeeklyJP;

  return {
    isValid,
    isComplete,
    isStale,
    totalWeeklyJP,
    errors,
    warnings,
  };
}

/**
 * Resolves effective subject slots from schedule and academic calendar.
 */
export function resolveEffectiveSubjectSlots(params: {
  semesterPlanId: string;
  schedule?: SubjectWeeklySchedule;
  expectedWeeklyJP: number | null;
  calendar?: AcademicCalendar;
  calendarDays?: CalendarDay[];
  schoolDaysPerWeek?: number | null;
}): EffectiveSubjectSlotResult {
  const { semesterPlanId, schedule, expectedWeeklyJP, calendar, calendarDays = [], schoolDaysPerWeek } = params;

  const validation = validateSubjectWeeklySchedule(schedule, expectedWeeklyJP, calendar?.schoolDaysPerWeek ?? schoolDaysPerWeek);

  const slots: EffectiveSubjectSlot[] = [];
  const excludedOccurrences: ExcludedSubjectOccurrence[] = [];

  const calendarReady = Boolean(
    calendar &&
    calendar.startDate &&
    calendar.endDate &&
    (calendar.schoolDaysPerWeek === 5 || calendar.schoolDaysPerWeek === 6) &&
    calendar.workflowStatus === 'CONFIRMED' &&
    Array.isArray(calendarDays) &&
    calendarDays.length > 0
  );

  const isReady = validation.isComplete && calendarReady;

  if (!isReady || !schedule || !calendar) {
    return {
      isValid: validation.isValid,
      isComplete: validation.isComplete,
      isReady: false,
      isStale: validation.isStale,
      errors: validation.errors,
      warnings: validation.warnings,
      slots: [],
      excludedOccurrences: [],
      totalMeetingSlots: 0,
      totalJP: 0,
      totalExcludedOccurrences: 0,
    };
  }

  const dayMap = new Map<string, CalendarDay>();
  calendarDays.forEach((d) => {
    if (d && d.date) dayMap.set(d.date, d);
  });

  const startDate = new Date(calendar.startDate);
  const endDate = new Date(calendar.endDate);

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return {
      ...validation,
      isReady: false,
      errors: [...validation.errors, 'Tanggal mulai atau selesai kalender tidak valid.'],
      slots: [],
      excludedOccurrences: [],
      totalMeetingSlots: 0,
      totalJP: 0,
      totalExcludedOccurrences: 0,
    };
  }

  const effectiveWeeks = getEffectiveWeeksList(calendar, calendarDays);

  let currentDate = new Date(startDate);
  while (currentDate <= endDate) {
    const yyyy = currentDate.getFullYear();
    const mm = String(currentDate.getMonth() + 1).padStart(2, '0');
    const dd = String(currentDate.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}-${mm}-${dd}`;

    const dayOfWeekJs = currentDate.getDay(); // 0 = Sunday, 1 = Monday ... 6 = Saturday
    const dayOfWeek: 1 | 2 | 3 | 4 | 5 | 6 = dayOfWeekJs === 0 ? 7 : (dayOfWeekJs as any);

    if (dayOfWeek >= 1 && dayOfWeek <= 6) {
      const sessionsOnThisDay = schedule.sessions.filter((s) => s.dayOfWeek === dayOfWeek);
      if (sessionsOnThisDay.length > 0) {
        const calDay = dayMap.get(dateStr);
        const canonicalStatus = normalizeCalendarDayStatus(calDay?.status);

        if (canonicalStatus === 'UNKNOWN') {
          return {
            isValid: validation.isValid,
            isComplete: validation.isComplete,
            isReady: false,
            isStale: validation.isStale,
            errors: [...validation.errors, `Kalender memiliki status UNKNOWN atau belum lengkap pada tanggal ${dateStr}.`],
            warnings: validation.warnings,
            slots: [],
            excludedOccurrences: [],
            totalMeetingSlots: 0,
            totalJP: 0,
            totalExcludedOccurrences: 0,
          };
        }

        const weekInfo = effectiveWeeks.find((wk) => dateStr >= wk.startDate && dateStr <= wk.endDate);
        const weekIndex = weekInfo ? weekInfo.weekIndex : 1;
        const month = currentDate.getMonth() + 1;
        const year = currentDate.getFullYear();

        if (canonicalStatus === 'EFFECTIVE_LEARNING') {
          for (const s of sessionsOnThisDay) {
            slots.push({
              id: `subject-slot:${semesterPlanId}:${s.id}:${dateStr}`,
              semesterPlanId,
              sessionId: s.id,
              date: dateStr,
              dayOfWeek,
              jp: s.jp,
              weekIndex,
              month,
              year,
            });
          }
        } else if (
          canonicalStatus === 'HOLIDAY' ||
          canonicalStatus === 'BREAK' ||
          canonicalStatus === 'NON_LEARNING' ||
          canonicalStatus === 'SCHOOL_EVENT' ||
          canonicalStatus === 'ASSESSMENT'
        ) {
          for (const s of sessionsOnThisDay) {
            excludedOccurrences.push({
              sessionId: s.id,
              date: dateStr,
              dayOfWeek,
              jp: s.jp,
              reason: canonicalStatus,
            });
          }
        }
      }
    }

    currentDate.setDate(currentDate.getDate() + 1);
  }

  const totalMeetingSlots = slots.length;
  const totalJP = slots.reduce((sum, s) => sum + s.jp, 0);
  const totalExcludedOccurrences = excludedOccurrences.length;

  return {
    isValid: validation.isValid,
    isComplete: validation.isComplete,
    isReady: true,
    isStale: validation.isStale,
    errors: validation.errors,
    warnings: validation.warnings,
    slots,
    excludedOccurrences,
    totalMeetingSlots,
    totalJP,
    totalExcludedOccurrences,
  };
}
