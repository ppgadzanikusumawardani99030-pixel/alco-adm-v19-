import { SemesterJPSetting, AnnualJPReference } from '../types';

export interface ResolvedSemesterJP {
  weeklyJP: number | null;
  source: 'SEMESTER_OVERRIDE' | 'DEFAULT_ANNUAL' | 'UNRESOLVED';
  isOverride: boolean;
  defaultAnnualWeeklyJP: number | null;
  explanation: string;
}

export function resolveSemesterJPFromValues(
  semesterSetting?: SemesterJPSetting | null,
  annualReference?: AnnualJPReference | null
): ResolvedSemesterJP {
  const defaultAnnualWeeklyJP =
    typeof annualReference?.referenceWeeklyEquivalentJP === 'number' && annualReference.referenceWeeklyEquivalentJP > 0
      ? annualReference.referenceWeeklyEquivalentJP
      : null;

  const explicitVal = semesterSetting?.actualScheduledWeeklyJP;
  if (typeof explicitVal === 'number' && explicitVal > 0) {
    const isOverride = defaultAnnualWeeklyJP !== null && explicitVal !== defaultAnnualWeeklyJP;
    return {
      weeklyJP: explicitVal,
      source: isOverride ? 'SEMESTER_OVERRIDE' : (semesterSetting?.source === 'SEMESTER_OVERRIDE' ? 'SEMESTER_OVERRIDE' : 'DEFAULT_ANNUAL'),
      isOverride,
      defaultAnnualWeeklyJP,
      explanation: isOverride
        ? `Penyesuaian Semester: ${explicitVal} JP/pekan (Default Data Pembelajaran: ${defaultAnnualWeeklyJP ?? '-'} JP/pekan)`
        : `Default dari Data Pembelajaran: ${explicitVal} JP/pekan`,
    };
  }

  if (defaultAnnualWeeklyJP !== null && defaultAnnualWeeklyJP > 0) {
    return {
      weeklyJP: defaultAnnualWeeklyJP,
      source: 'DEFAULT_ANNUAL',
      isOverride: false,
      defaultAnnualWeeklyJP,
      explanation: `Default dari Data Pembelajaran: ${defaultAnnualWeeklyJP} JP/pekan`,
    };
  }

  return {
    weeklyJP: null,
    source: 'UNRESOLVED',
    isOverride: false,
    defaultAnnualWeeklyJP: null,
    explanation: 'Jam Pelajaran (JP) belum ditentukan di Data Pembelajaran.',
  };
}

/**
 * Pure canonical resolver for Semester JP from State.
 * Pure function: strictly avoids importing storageV5 to prevent circular dependencies.
 *
 * Exact Hierarchy:
 * 1. Valid SemesterJPSetting override
 * 2. Valid AnnualJPReference.referenceWeeklyEquivalentJP
 * 3. Unresolved (weeklyJP = null)
 */
export function resolveSemesterJPFromState(
  semesterPlanId: string,
  state: {
    semesterPlans?: Array<{
      id: string;
      semester?: number;
      yearPlanId: string;
    }>;
    semesterJPSettings?: Array<{
      semesterPlanId: string;
      value?: SemesterJPSetting;
    }>;
    annualJPReferences?: Array<{
      yearPlanId: string;
      value?: AnnualJPReference;
    }>;
  },
  overrideSetting?: SemesterJPSetting
): ResolvedSemesterJP {
  const sp = state.semesterPlans?.find((s) => s.id === semesterPlanId);
  const parentYearPlanId = sp?.yearPlanId;
  const annualJPRef =
    parentYearPlanId && state.annualJPReferences
      ? state.annualJPReferences.find((e: any) => e.yearPlanId === parentYearPlanId)?.value
      : undefined;

  const jpSetting =
    overrideSetting !== undefined
      ? overrideSetting
      : state.semesterJPSettings?.find((e: any) => e.semesterPlanId === semesterPlanId)?.value;

  return resolveSemesterJPFromValues(jpSetting, annualJPRef);
}
