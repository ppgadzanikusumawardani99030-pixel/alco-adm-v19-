import {
  ATPUnitMappingData,
  UnitExecutionPlanData,
  LearningMeetingScheduleEntry,
  LearningMeetingScheduleResult,
} from '../types';
import { resolveUnitSemesterPlacement } from './unitSemesterPlanningService';
import {
  EffectiveSubjectSlotResult,
} from './subjectScheduleService';

/**
 * Resolves and pairs LearningMeetings sequentially to actual calendar slots.
 */
export function resolveLearningMeetingSchedule(params: {
  semesterPlanId: string;
  semester: 1 | 2;
  mapping: ATPUnitMappingData;
  unitExecutionPlan: UnitExecutionPlanData;
  subjectSlotResult: EffectiveSubjectSlotResult;
}): LearningMeetingScheduleResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // 1. Initial fail-closed validation of parameters
  if (!params.semesterPlanId || !params.semester || !params.mapping || !params.unitExecutionPlan || !params.subjectSlotResult) {
    return createFailedResult(['Parameter input resolver tidak lengkap.'], params.subjectSlotResult);
  }

  const { semesterPlanId, semester, mapping, unitExecutionPlan, subjectSlotResult } = params;

  // 2. Validate Semester Placement
  const placement = resolveUnitSemesterPlacement(unitExecutionPlan, mapping);
  if (!placement.isValid || !placement.isComplete || placement.isStale) {
    const placementErrors = placement.errors || [];
    return createFailedResult([
      'Pembagian semester Unit/Bab tidak valid, tidak lengkap, atau stale.',
      ...placementErrors,
    ], subjectSlotResult);
  }

  // 3. Validation rule: Unit ID on plan must match mapping exactly
  const mappingUnitIds = new Set((mapping.units || []).map((u) => u.id));
  const planUnitIds = new Set((unitExecutionPlan.units || []).map((u) => u.unitId));

  // Check if every plan unit is in mapping
  for (const planUnitId of planUnitIds) {
    if (!mappingUnitIds.has(planUnitId)) {
      errors.push(`Unit ID "${planUnitId}" pada rencana pelaksanaan tidak cocok dengan pemetaan Unit/Bab.`);
    }
  }
  // Check if every mapping unit is in plan
  for (const mappingUnitId of mappingUnitIds) {
    if (!planUnitIds.has(mappingUnitId)) {
      errors.push(`Rencana pelaksanaan belum memiliki unit dengan ID "${mappingUnitId}" dari pemetaan.`);
    }
  }

  // 4. Validation rule: Meeting IDs must not be empty or duplicate
  const seenMeetingIds = new Set<string>();
  const allMeetingsInPlan = (unitExecutionPlan.units || []).flatMap((u) => u.meetings || []);

  for (const m of allMeetingsInPlan) {
    if (!m.id || !m.id.trim()) {
      errors.push('Terdapat Pertemuan yang memiliki ID kosong.');
    } else if (seenMeetingIds.has(m.id)) {
      errors.push(`ID Pertemuan duplikat terdeteksi: "${m.id}".`);
    } else {
      seenMeetingIds.add(m.id);
    }

    // 5. Validation rule: meeting.order must be valid and duplicate-free in its Unit
    if (typeof m.order !== 'number' || m.order <= 0 || !Number.isInteger(m.order)) {
      errors.push(`Pertemuan "${m.id || m.title}" memiliki order tidak valid: ${m.order}.`);
    }
  }

  // Check duplicate orders per Unit
  for (const u of unitExecutionPlan.units || []) {
    const unitOrders = new Set<number>();
    for (const m of u.meetings || []) {
      if (typeof m.order === 'number' && Number.isInteger(m.order)) {
        if (unitOrders.has(m.order)) {
          errors.push(`Order Pertemuan duplikat "${m.order}" terdeteksi di Unit "${u.unitId}".`);
        }
        unitOrders.add(m.order);
      }
    }
  }

  // 6. Validation rule: subjectSlotResult slots must match input semesterPlanId and have no duplicate slot IDs
  if (subjectSlotResult.isReady && Array.isArray(subjectSlotResult.slots)) {
    const seenSlotIds = new Set<string>();
    for (const slot of subjectSlotResult.slots) {
      if (slot.semesterPlanId !== semesterPlanId) {
        errors.push(`Rencana pelaksanaan tidak cocok: slot "${slot.id}" memiliki semesterPlanId "${slot.semesterPlanId}", diharapkan "${semesterPlanId}".`);
      }
      if (seenSlotIds.has(slot.id)) {
        errors.push(`ID slot tanggal duplikat terdeteksi: "${slot.id}".`);
      } else {
        seenSlotIds.add(slot.id);
      }
    }
  }

  // If any structural validation errors exist, fail-closed immediately
  if (errors.length > 0) {
    return createFailedResult(errors, subjectSlotResult);
  }

  // 7. Determine targeted semester unit IDs
  const targetUnitIds = new Set<string>(
    semester === 1 ? placement.semester1UnitIds : placement.semester2UnitIds
  );

  // 8. Retrieve and sort meetings canonically
  // Unit sorted by mapping.units order, meetings inside each sorted by meeting.order
  const mappingUnitOrderMap = new Map<string, number>(
    (mapping.units || []).map((u) => [u.id, u.order])
  );

  const semesterPlanUnits = (unitExecutionPlan.units || [])
    .filter((u) => targetUnitIds.has(u.unitId))
    .sort((a, b) => {
      const orderA = mappingUnitOrderMap.get(a.unitId) ?? 999;
      const orderB = mappingUnitOrderMap.get(b.unitId) ?? 999;
      return orderA - orderB;
    });

  const flatMeetings: typeof allMeetingsInPlan = [];
  for (const u of semesterPlanUnits) {
    const sortedMeetings = [...(u.meetings || [])].sort((a, b) => a.order - b.order);
    flatMeetings.push(...sortedMeetings);
  }

  const totalMeetings = flatMeetings.length;

  // 9. Readiness fallback
  if (!subjectSlotResult.isReady) {
    // Return result with no scheduled entries but calculate total planned meetings
    return {
      totalMeetings,
      totalAvailableSlots: 0,
      totalScheduledMeetings: 0,
      totalUnscheduledMeetings: totalMeetings,
      totalActualJP: 0,
      totalExcludedOccurrences: subjectSlotResult?.totalExcludedOccurrences || 0,
      scheduledEntries: [],
      unscheduledMeetingIds: flatMeetings.map((m) => m.id),
      excludedOccurrences: subjectSlotResult?.excludedOccurrences || [],
      errors: [...(subjectSlotResult?.errors || [])],
      warnings: [...(subjectSlotResult?.warnings || [])],
      isReady: false,
      isComplete: false,
      isValid: true, // Structurally valid, just not ready on dates
    };
  }

  // 10. Sort exact slots deterministically
  const sortedSlots = [...(subjectSlotResult.slots || [])].sort((a, b) => {
    if (a.date !== b.date) {
      return a.date.localeCompare(b.date);
    }
    const orderA = a.sessionOrder ?? 0;
    const orderB = b.sessionOrder ?? 0;
    return orderA - orderB;
  });

  const totalAvailableSlots = sortedSlots.length;

  // 11. Sequential pairing
  const scheduledEntries: LearningMeetingScheduleEntry[] = [];
  const scheduledCount = Math.min(totalMeetings, totalAvailableSlots);

  for (let i = 0; i < scheduledCount; i++) {
    const meeting = flatMeetings[i];
    const slot = sortedSlots[i];

    scheduledEntries.push({
      meetingId: meeting.id,
      unitId: meeting.unitId,
      semesterPlanId,
      sessionId: slot.sessionId,
      sourceSlotId: slot.id,
      date: slot.date,
      dayOfWeek: slot.dayOfWeek,
      jp: slot.jp,
      weekIndex: slot.weekIndex,
      mode: 'AUTO',
    });
  }

  // 12. Handle unscheduled meetings (Capacity mismatch)
  const unscheduledMeetingIds: string[] = [];
  if (totalMeetings > totalAvailableSlots) {
    for (let i = totalAvailableSlots; i < totalMeetings; i++) {
      unscheduledMeetingIds.push(flatMeetings[i].id);
    }
    warnings.push(`Kapasitas slot perencanaan kurang: ${totalMeetings} pertemuan direncanakan, tetapi hanya tersedia ${totalAvailableSlots} slot tanggal.`);
  } else if (totalAvailableSlots > totalMeetings) {
    warnings.push(`Terdapat ${totalAvailableSlots - totalMeetings} slot perencanaan tersisa yang belum dijadwalkan.`);
  }

  const totalScheduledMeetings = scheduledEntries.length;
  const totalUnscheduledMeetings = unscheduledMeetingIds.length;
  const totalActualJP = scheduledEntries.reduce((sum, entry) => sum + entry.jp, 0);
  const totalExcludedOccurrences = subjectSlotResult?.totalExcludedOccurrences || 0;

  const isComplete = totalUnscheduledMeetings === 0;

  return {
    totalMeetings,
    totalAvailableSlots,
    totalScheduledMeetings,
    totalUnscheduledMeetings,
    totalActualJP,
    totalExcludedOccurrences,
    scheduledEntries,
    unscheduledMeetingIds,
    excludedOccurrences: subjectSlotResult?.excludedOccurrences || [],
    errors: [...(subjectSlotResult?.errors || [])],
    warnings: [...(subjectSlotResult?.warnings || []), ...warnings],
    isReady: true,
    isComplete,
    isValid: true,
  };
}

/**
 * Creates a canonically structured failed/invalid result.
 */
function createFailedResult(
  errors: string[],
  subjectSlotResult: EffectiveSubjectSlotResult
): LearningMeetingScheduleResult {
  return {
    totalMeetings: 0,
    totalAvailableSlots: 0,
    totalScheduledMeetings: 0,
    totalUnscheduledMeetings: 0,
    totalActualJP: 0,
    totalExcludedOccurrences: subjectSlotResult?.totalExcludedOccurrences || 0,
    scheduledEntries: [],
    unscheduledMeetingIds: [],
    excludedOccurrences: subjectSlotResult?.excludedOccurrences || [],
    errors,
    warnings: subjectSlotResult?.warnings || [],
    isReady: false,
    isComplete: false,
    isValid: false,
  };
}
