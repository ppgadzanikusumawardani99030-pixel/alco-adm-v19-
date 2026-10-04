import {
  UnitExecutionPlanData,
  ATPUnitMappingData,
  UnitSemesterPlacement,
} from '../types';
import { isUnitExecutionPlanStale } from './unitExecutionPlanService';

export interface UnitSemesterResolution {
  unitId: string;
  semester: 1 | 2;
}

export interface UnitSemesterPlacementValidation {
  isValid: boolean;
  isComplete: boolean;
  isStale: boolean;

  errors: string[];
  warnings: string[];

  semester1UnitIds: string[];
  semester2UnitIds: string[];

  resolvedUnits: UnitSemesterResolution[];
}

/**
 * Resolves and validates Unit semester placement according to CONTIGUOUS_BOUNDARY rules.
 */
export function resolveUnitSemesterPlacement(
  plan: UnitExecutionPlanData,
  mapping: ATPUnitMappingData
): UnitSemesterPlacementValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  const isStale = isUnitExecutionPlanStale(plan, mapping);
  if (isStale) {
    warnings.push('Struktur Pertemuan atau Pemetaan Unit/Bab telah berubah (stale).');
  }

  const sortedUnits = [...(mapping.units || [])].sort((a, b) => a.order - b.order);
  const unitIdsSet = new Set(sortedUnits.map((u) => u.id));

  const semester1UnitIds: string[] = [];
  const semester2UnitIds: string[] = [];
  const resolvedUnits: UnitSemesterResolution[] = [];

  let isValid = true;
  let isComplete = false;

  const placement = plan.semesterPlacement;

  if (!placement) {
    isValid = true;
    isComplete = false;
  } else {
    if (placement.mode !== 'CONTIGUOUS_BOUNDARY') {
      isValid = false;
      errors.push(`Mode penempatan semester tidak valid (harus CONTIGUOUS_BOUNDARY, menerima '${placement.mode}')`);
    } else {
      const lastS1Id = placement.semester1LastUnitId;
      if (lastS1Id === null) {
        sortedUnits.forEach((u) => {
          semester2UnitIds.push(u.id);
          resolvedUnits.push({ unitId: u.id, semester: 2 });
        });
        warnings.push('Semester 1 tidak memiliki Unit/Bab (semua unit masuk Semester 2).');
      } else {
        if (!unitIdsSet.has(lastS1Id)) {
          isValid = false;
          errors.push(`semester1LastUnitId merujuk Unit ID '${lastS1Id}' yang tidak ada pada mapping.units`);
        } else {
          let reachedLastS1 = false;
          for (const u of sortedUnits) {
            if (!reachedLastS1) {
              semester1UnitIds.push(u.id);
              resolvedUnits.push({ unitId: u.id, semester: 1 });
              if (u.id === lastS1Id) {
                reachedLastS1 = true;
              }
            } else {
              semester2UnitIds.push(u.id);
              resolvedUnits.push({ unitId: u.id, semester: 2 });
            }
          }
        }
      }
    }
  }

  if (placement && placement.mode === 'CONTIGUOUS_BOUNDARY' && placement.semester1LastUnitId !== null && unitIdsSet.has(placement.semester1LastUnitId)) {
    if (semester1UnitIds.length === 0) {
      warnings.push('Semester 1 tidak memiliki Unit/Bab.');
    }
    if (semester2UnitIds.length === 0) {
      warnings.push('Semester 2 tidak memiliki Unit/Bab (semua unit masuk Semester 1).');
    }
  }

  isComplete =
    isValid &&
    !isStale &&
    Boolean(placement && placement.mode === 'CONTIGUOUS_BOUNDARY') &&
    resolvedUnits.length === sortedUnits.length;

  return {
    isValid,
    isComplete,
    isStale,
    errors,
    warnings,
    semester1UnitIds,
    semester2UnitIds,
    resolvedUnits,
  };
}

/**
 * Suggests semester boundary based on capacity ratios and meeting counts.
 */
export function suggestSemesterBoundary(
  plan: UnitExecutionPlanData,
  mapping: ATPUnitMappingData,
  s1AvailableJP: number | null,
  s2AvailableJP: number | null
): string | null | undefined {
  if (
    s1AvailableJP === null ||
    s2AvailableJP === null ||
    s1AvailableJP <= 0 ||
    s2AvailableJP <= 0
  ) {
    return undefined;
  }

  const sortedUnits = [...(mapping.units || [])].sort((a, b) => a.order - b.order);
  if (sortedUnits.length <= 1) {
    return undefined; // 1 unit -> manual choice
  }

  const unitPlanMap = new Map((plan.units || []).map((u) => [u.unitId, u]));

  const unitWeights = sortedUnits.map((u) => {
    const up = unitPlanMap.get(u.id);
    const meetingCount = up?.meetings?.length || 0;
    return Math.max(1, meetingCount);
  });

  const totalWeight = unitWeights.reduce((sum, w) => sum + w, 0);
  if (totalWeight <= 0) return undefined;

  const targetS1Share = s1AvailableJP / (s1AvailableJP + s2AvailableJP);
  let cumulativeWeight = 0;
  let bestBoundaryIndex = 0;
  let minDiff = Infinity;

  for (let i = 0; i < sortedUnits.length - 1; i++) {
    cumulativeWeight += unitWeights[i];
    const currentShare = cumulativeWeight / totalWeight;
    const diff = Math.abs(currentShare - targetS1Share);
    if (diff < minDiff) {
      minDiff = diff;
      bestBoundaryIndex = i;
    }
  }

  return sortedUnits[bestBoundaryIndex].id;
}
