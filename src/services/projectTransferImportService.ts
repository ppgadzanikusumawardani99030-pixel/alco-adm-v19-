import {
  ProjectTransferPackage,
  ProjectTransferCP,
  ProjectTransferTP,
  ProjectTransferATP,
} from '../types/projectTransfer';
import {
  loadStorageV5,
  saveStorageV5,
  validateStorageStateV5,
} from './storageV5';
import {
  AppStorageStateV5,
  AdministrationWorkspaceV5,
} from '../types/storageV5';
import {
  YearPlan,
  SemesterPlan,
  CPData,
  CPElem,
  CPAnalysisData,
  CPAnalysisItem,
  TPData,
  TPItem,
  ATPData,
  ATPItem,
} from '../types';
import { validateProjectTransfer } from './projectTransferService';
import {
  validateCPAnalysisDataWorkflow,
  validateTPDataWorkflow,
} from './cpWorkflowService';

export interface ProjectTransferImportParams {
  pkg: ProjectTransferPackage;
  profileId: string;
  schoolId: string;
  classSection?: string;
  documentDate?: string;
}

export interface ProjectTransferImportResult {
  yearPlan: YearPlan;
  workspace: AdministrationWorkspaceV5;
  semesterPlans: [SemesterPlan, SemesterPlan];
  cp: CPData;
  cpAnalysis?: CPAnalysisData;
  tp: TPData;
  atp: ATPData;
}

/**
 * Performs pure in-memory mapping of a validated ProjectTransferPackage into a target AppStorageStateV5.
 * Mutates the state parameter in-memory only; caller is responsible for validating and persisting.
 * Does not mutate legacy storage or create partial projects if an error occurs.
 */
export function performImportProjectTransferInState(
  state: AppStorageStateV5,
  params: ProjectTransferImportParams
): ProjectTransferImportResult {
  const { pkg, profileId, schoolId, classSection, documentDate } = params;

  if (!pkg || typeof pkg !== 'object') {
    throw new Error('ProjectTransferPackage harus berupa objek transfer yang valid.');
  }

  // 1. Validate contract conformance of the incoming package
  const validation = validateProjectTransfer(pkg);
  if (!validation.isValid) {
    const errorDetails = validation.errors.map((e) => `[${e.code}] ${e.message}`).join(', ');
    throw new Error(`ProjectTransferPackage tidak valid: ${errorDetails}`);
  }

  const targetProfileId = (profileId || '').trim();
  const targetSchoolId = (schoolId || '').trim();

  if (!targetProfileId) {
    throw new Error('Target profileId wajib diisi.');
  }
  if (!targetSchoolId) {
    throw new Error('Target schoolId wajib diisi.');
  }

  // 2. Validate Profile and School existence and association
  const profile = state.profiles.find((p) => p.id === targetProfileId);
  if (!profile) {
    throw new Error(`Profile dengan ID "${targetProfileId}" tidak ditemukan.`);
  }

  const school = state.schools.find((s) => s.id === targetSchoolId);
  if (!school) {
    throw new Error(`School dengan ID "${targetSchoolId}" tidak ditemukan.`);
  }

  if (profile.schoolId && profile.schoolId !== targetSchoolId) {
    throw new Error(
      `Ketidakcocokan sekolah: profile.schoolId "${profile.schoolId}" tidak cocok dengan target schoolId "${targetSchoolId}".`
    );
  }

  // 3. Duplicate Identity Guard: profile + school + academicYear + grade + classSection + subject
  const targetAcademicYear = pkg.academicYear.trim();
  const targetGrade = pkg.grade.trim();
  const targetClassSection = classSection ? classSection.trim() || undefined : undefined;
  const targetSubject = pkg.subject.trim();

  const isDuplicate = state.yearPlans.some(
    (yp) =>
      yp.profileId === targetProfileId &&
      yp.schoolId === targetSchoolId &&
      yp.academicYear === targetAcademicYear &&
      yp.grade === targetGrade &&
      (yp.classSection || '') === (targetClassSection || '') &&
      yp.subject.trim().toLowerCase() === targetSubject.toLowerCase()
  );

  if (isDuplicate) {
    throw new Error(
      `Project dengan identitas yang sama sudah ada: profileId "${targetProfileId}", schoolId "${targetSchoolId}", academicYear "${targetAcademicYear}", grade "${targetGrade}", classSection "${targetClassSection || ''}", subject "${targetSubject}".`
    );
  }

  const now = new Date().toISOString();
  const isMerdeka = pkg.curriculumType === 'KURIKULUM_MERDEKA';

  // 4. Create Canonical YearPlan, WorkspaceV5, SemesterPlans (1 & 2)
  const newYearPlanId = `yp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const newYearPlan: YearPlan = {
    id: newYearPlanId,
    profileId: targetProfileId,
    schoolId: targetSchoolId,
    academicYear: targetAcademicYear,
    curriculumType: pkg.curriculumType,
    level: pkg.level as 'SD' | 'SMP' | 'SMA' | 'SMK',
    grade: targetGrade,
    ...(targetClassSection ? { classSection: targetClassSection } : {}),
    subject: targetSubject,
    subjectCode: targetSubject,
    ...(pkg.phase ? { phase: pkg.phase.trim() } : {}),
    curriculumLock: {
      curriculumType: pkg.curriculumType,
      academicYear: targetAcademicYear,
      lockedAt: now,
    },
    createdAt: now,
    updatedAt: now,
  };

  const newWorkspaceId = `ws-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const workspaceName = `${targetSubject} - ${targetGrade}${
    targetClassSection ? ` (${targetClassSection})` : ''
  } (${targetAcademicYear})`;

  const newWorkspace: AdministrationWorkspaceV5 = {
    id: newWorkspaceId,
    profileId: targetProfileId,
    schoolId: targetSchoolId,
    yearPlanId: newYearPlanId,
    name: workspaceName,
    ...(documentDate && documentDate.trim() ? { documentDate: documentDate.trim() } : {}),
    createdAt: now,
    updatedAt: now,
  };

  const newSemesterPlan1: SemesterPlan = {
    id: `sp-${Date.now()}-1-${Math.random().toString(36).slice(2, 9)}`,
    yearPlanId: newYearPlanId,
    semester: 1,
    createdAt: now,
    updatedAt: now,
  };

  const newSemesterPlan2: SemesterPlan = {
    id: `sp-${Date.now()}-2-${Math.random().toString(36).slice(2, 9)}`,
    yearPlanId: newYearPlanId,
    semester: 2,
    createdAt: now,
    updatedAt: now,
  };

  // 5. Generate fresh internal IDs for CPData and its elements
  const newCPDataId = `cp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const cpElements: CPElem[] = (pkg.cp || []).map((c: ProjectTransferCP, idx: number) => {
    const code = c.code && c.code.trim() ? c.code.trim() : undefined;
    return {
      id: `elem-${Date.now()}-${idx + 1}-${Math.random().toString(36).slice(2, 7)}`,
      ...(code ? { code } : {}),
      name: (c.element || c.code || `Elemen ${idx + 1}`).trim(),
      content: (c.content || '').trim(),
    };
  });

  // Build lookup maps for source ProjectTransferCP by code and by element name
  const sourceCpByCodeMap = new Map<string, ProjectTransferCP>();
  const sourceCpByElementMap = new Map<string, ProjectTransferCP>();
  (pkg.cp || []).forEach((c) => {
    if (c.code && c.code.trim()) {
      sourceCpByCodeMap.set(c.code.trim().toUpperCase(), c);
    }
    if (c.element && c.element.trim()) {
      sourceCpByElementMap.set(c.element.trim().toUpperCase(), c);
    }
  });

  const cpElemByCodeMap = new Map<string, CPElem>();
  (pkg.cp || []).forEach((c, idx) => {
    const elem = cpElements[idx];
    if (c.code && c.code.trim()) {
      cpElemByCodeMap.set(c.code.trim().toUpperCase(), elem);
    }
    if (c.element && c.element.trim()) {
      cpElemByCodeMap.set(c.element.trim().toUpperCase(), elem);
    }
  });

  const cpGeneralDescription =
    cpElements.length > 0
      ? cpElements.map((el) => `${el.name}: ${el.content}`).join('\n\n')
      : `Capaian Pembelajaran ${targetSubject} ${targetGrade}`;

  const newCPData: CPData = {
    id: newCPDataId,
    academicSettingId: newYearPlanId,
    generalDescription: cpGeneralDescription,
    elements: cpElements,
    workflowStatus: 'DRAFT',
    lastEditedAt: now,
    updatedAt: now,
  };

  // 5.b Build CP Analysis for Kurikulum Merdeka
  let newCPAnalysisData: CPAnalysisData | undefined = undefined;

  if (isMerdeka) {
    const cpAnalysisItems: CPAnalysisItem[] = (pkg.tp || []).map((t: ProjectTransferTP, idx: number) => {
      const rawCpCode = (t.cpCode || '').trim().toUpperCase();
      const matchedElem = rawCpCode ? cpElemByCodeMap.get(rawCpCode) : undefined;
      const matchedSourceCP = rawCpCode
        ? sourceCpByCodeMap.get(rawCpCode) || sourceCpByElementMap.get(rawCpCode)
        : undefined;

      const competence = (t.competence || '').trim();
      const materialScope = (t.materialScope || '').trim();
      const statement = (t.statement || '').trim();

      const analysisItemId = `ana-item-${Date.now()}-${idx + 1}-${Math.random().toString(36).slice(2, 7)}`;

      return {
        id: analysisItemId,
        elementId: matchedElem ? matchedElem.id : undefined,
        elementName: matchedSourceCP ? (matchedSourceCP.element || '').trim() : '',
        cpText: matchedSourceCP ? (matchedSourceCP.content || '').trim() : '',
        cpCompetence: competence,
        materialScope: materialScope,
        suggestedTp: statement,
        order: idx + 1,
      };
    });

    const newCPAnalysisDataId = `cpa-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    newCPAnalysisData = {
      id: newCPAnalysisDataId,
      academicSettingId: newYearPlanId,
      workspaceId: newWorkspaceId,
      cpId: newCPData.id,
      academicYear: targetAcademicYear,
      subjectCode: targetSubject,
      ...(pkg.phase ? { phase: pkg.phase.trim() } : {}),
      items: cpAnalysisItems,
      status: 'DRAFT',
      workflowStatus: 'DRAFT',
      basedOnCpUpdatedAt: newCPData.updatedAt,
      generatedBy: 'TEACHER',
      provenance: {
        generatedBy: 'USER',
        generatedAt: now,
      },
      updatedAt: now,
    };

    const anaValidation = validateCPAnalysisDataWorkflow(newCPAnalysisData, newCPData);
    newCPAnalysisData.workflowStatus = anaValidation.status;
    newCPAnalysisData.status = anaValidation.status === 'SIAP' ? 'SIAP' : 'DRAFT';
  }

  // 6. Generate fresh internal IDs for TPData and TPItems
  // Map portable TP code -> internal TPItem
  const newTPDataId = `tp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const tpCodeToItemMap = new Map<string, TPItem>();

  const tpItems: TPItem[] = (pkg.tp || []).map((t: ProjectTransferTP, idx: number) => {
    const freshTPItemId = `tp-item-${Date.now()}-${idx + 1}-${Math.random().toString(36).slice(2, 7)}`;
    const cleanCode = (t.code || '').trim();
    const rawCpCode = (t.cpCode || '').trim().toUpperCase();
    const matchedSourceCP = rawCpCode
      ? sourceCpByCodeMap.get(rawCpCode) || sourceCpByElementMap.get(rawCpCode)
      : undefined;

    let cpAnalysisId: string | undefined = undefined;
    let cpAnalysisItemIds: string[] | undefined = undefined;

    if (isMerdeka && newCPAnalysisData && newCPAnalysisData.items[idx]) {
      const analysisItem = newCPAnalysisData.items[idx];
      cpAnalysisId = analysisItem.id;
      cpAnalysisItemIds = [analysisItem.id];
    }

    const item: TPItem = {
      id: freshTPItemId,
      code: cleanCode,
      ...(cpAnalysisId ? { cpAnalysisId } : {}),
      ...(cpAnalysisItemIds ? { cpAnalysisItemIds } : {}),
      elementName: matchedSourceCP ? (matchedSourceCP.element || '').trim() || undefined : undefined,
      statement: (t.statement || '').trim(),
      competence: (t.competence || '').trim(),
      contentScope: (t.materialScope || '').trim(),
      order: idx + 1,
      sequence: idx + 1,
      status: 'DRAFT',
      provenance: {
        generatedBy: 'USER',
        generatedAt: now,
      },
    };

    if (cleanCode) {
      tpCodeToItemMap.set(cleanCode.toUpperCase(), item);
    }

    return item;
  });

  const newTPData: TPData = {
    id: newTPDataId,
    academicSettingId: newYearPlanId,
    workspaceId: newWorkspaceId,
    cpId: newCPData.id,
    ...(isMerdeka && newCPAnalysisData ? { cpAnalysisId: newCPAnalysisData.id } : {}),
    academicYear: targetAcademicYear,
    subjectCode: targetSubject,
    ...(pkg.phase ? { phase: pkg.phase.trim() } : {}),
    items: tpItems,
    basedOnCpUpdatedAt: newCPData.updatedAt,
    ...(isMerdeka && newCPAnalysisData ? { basedOnAnalysisUpdatedAt: newCPAnalysisData.updatedAt } : {}),
    status: 'DRAFT',
    workflowStatus: 'DRAFT',
    provenance: {
      generatedBy: 'USER',
      generatedAt: now,
    },
    updatedAt: now,
  };

  if (isMerdeka && newCPAnalysisData) {
    const tpValidation = validateTPDataWorkflow(newTPData, newCPData, newCPAnalysisData);
    newTPData.workflowStatus = tpValidation.status;
    newTPData.status = tpValidation.status === 'SIAP' ? 'SIAP' : 'DRAFT';
  } else {
    newTPData.workflowStatus = 'DRAFT';
    newTPData.status = 'DRAFT';
  }

  // 7. Generate fresh internal IDs for ATPData and ATPItems
  // 8. Resolve ATP tpCode -> internal TPItem.id and set ATPItem.tpId as canonical linkage
  const newATPDataId = `atp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  let knownTotalJP = 0;
  let hasUnknownJP = false;

  const atpItems: ATPItem[] = (pkg.atp || []).map((a: ProjectTransferATP, idx: number) => {
    const freshATPItemId = `atp-item-${Date.now()}-${idx + 1}-${Math.random().toString(36).slice(2, 7)}`;
    const portableTpCode = (a.tpCode || '').toUpperCase().trim();
    const matchedTPItem = tpCodeToItemMap.get(portableTpCode);

    if (!matchedTPItem) {
      throw new Error(
        `Gagal merelasikan ATP urutan ke-${a.order}: kode TP "${a.tpCode}" tidak ditemukan pada daftar TP.`
      );
    }

    const jpVal =
      a.jp !== undefined && a.jp !== null && typeof a.jp === 'number' && !isNaN(a.jp) && a.jp > 0
        ? a.jp
        : null;

    if (jpVal !== null) {
      knownTotalJP += jpVal;
    } else {
      hasUnknownJP = true;
    }

    const item: ATPItem = {
      id: freshATPItemId,
      stepNumber: a.order ?? idx + 1,
      sequence: a.order ?? idx + 1,
      linkedTpIds: [matchedTPItem.id],
      tpId: matchedTPItem.id,
      tpCode: matchedTPItem.code,
      tpStatement: matchedTPItem.statement,
      unitTitle: a.unit && a.unit.trim() ? a.unit.trim() : undefined,
      materialScope: (a.material || matchedTPItem.contentScope || '').trim(),
      allocatedJP: jpVal,
      jp: jpVal,
      semester: a.semester === 1 || a.semester === 2 ? a.semester : null,
      provenance: {
        generatedBy: 'USER',
        generatedAt: now,
      },
    };

    return item;
  });

  const newATPData: ATPData = {
    id: newATPDataId,
    academicSettingId: newYearPlanId,
    workspaceId: newWorkspaceId,
    tpDataId: newTPDataId,
    academicYear: targetAcademicYear,
    subjectCode: targetSubject,
    ...(pkg.phase ? { phase: pkg.phase.trim() } : {}),
    items: atpItems,
    totalJP: knownTotalJP > 0 ? knownTotalJP : undefined,
    knownTotalJP,
    hasUnknownJP,
    allocationComplete: false,
    basedOnTpUpdatedAt: newTPData.updatedAt,
    status: 'DRAFT',
    workflowStatus: 'DRAFT',
    provenance: {
      generatedBy: 'USER',
      generatedAt: now,
    },
    updatedAt: now,
  };

  // 9. Save hierarchy & annualData entries for the new YearPlan
  state.yearPlans.push(newYearPlan);
  state.workspaces.push(newWorkspace);
  state.semesterPlans.push(newSemesterPlan1, newSemesterPlan2);

  state.annualData.cp.push({ yearPlanId: newYearPlanId, value: newCPData });
  if (isMerdeka && newCPAnalysisData) {
    state.annualData.cpAnalysis.push({ yearPlanId: newYearPlanId, value: newCPAnalysisData });
  }
  state.annualData.tp.push({ yearPlanId: newYearPlanId, value: newTPData });
  state.annualData.atp.push({ yearPlanId: newYearPlanId, value: newATPData });
  state.annualData.curriculumContext.push({
    yearPlanId: newYearPlanId,
    value: {
      curriculumType: pkg.curriculumType,
      academicYear: targetAcademicYear,
      lockedAt: now,
    },
  });

  // 10. Update activeYearPlanId and activeWorkspaceId to the new project
  // 11. Do NOT auto-select activeSemesterPlanId (leave undefined)
  state.activeProfileId = targetProfileId;
  state.activeYearPlanId = newYearPlanId;
  state.activeWorkspaceId = newWorkspaceId;
  state.activeSemesterPlanId = undefined;

  return {
    yearPlan: newYearPlan,
    workspace: newWorkspace,
    semesterPlans: [newSemesterPlan1, newSemesterPlan2],
    cp: newCPData,
    ...(newCPAnalysisData ? { cpAnalysis: newCPAnalysisData } : {}),
    tp: newTPData,
    atp: newATPData,
  };
}

/**
 * Atomically imports a validated ProjectTransferPackage into Storage V5.
 *
 * Guarantees:
 * - Atomicity: If validation, duplicate check, or mapping fails, previous storage remains intact.
 * - Single persist: Validates the full V5 state graph and saves exactly once upon complete success.
 * - Does not auto-select activeSemesterPlanId.
 * - Does not create synthetic CPAnalysis or TimeAllocation.
 */
export function importProjectTransferPackageV5(
  params: ProjectTransferImportParams
): ProjectTransferImportResult {
  // 1. Load current Storage V5 state
  const state = loadStorageV5();

  // 2. Perform in-memory mapping and hierarchy generation
  const result = performImportProjectTransferInState(state, params);

  // 12. Validate full state graph before persisting
  validateStorageStateV5(state);

  // 13. Persist exactly once
  saveStorageV5(state);

  return result;
}
