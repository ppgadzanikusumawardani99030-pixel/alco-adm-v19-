import assert from 'node:assert';
import {
  createInitialStorageV5,
  loadStorageV5,
  saveStorageV5,
  createProfileV5,
  createSchoolV5,
  createYearHierarchyV5,
  saveCPV5,
  saveCPAnalysisV5,
  saveTPV5,
  saveATPV5,
  getAnnualDataV5,
  STORAGE_KEY_V5,
} from '../src/services/storageV5';
import {
  validateCPAnalysisDataWorkflow,
  validateTPDataWorkflow,
  validateATPDataWorkflow,
  resolveATPItemTPReferences,
} from '../src/services/cpWorkflowService';
import { validateWorkflowDependencies } from '../src/services/workflowEngine';
import {
  CPData,
  CPAnalysisData,
  TPData,
  ATPData,
  ATPItem,
  TPItem,
  AcademicSetting,
  SchoolData,
  TeacherProfile,
} from '../src/types';

console.log('=== RUNNING COMPREHENSIVE CANONICAL MERDEKA WORKFLOW REGRESSION ===\n');

// Mock localStorage in Node environment
class MockLocalStorage {
  private store: Map<string, string> = new Map();
  getItem(key: string): string | null {
    return this.store.has(key) ? this.store.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
  removeItem(key: string): void {
    this.store.delete(key);
  }
  clear(): void {
    this.store.clear();
  }
}

const mockStorage = new MockLocalStorage();
(globalThis as any).localStorage = mockStorage;

let totalTests = 0;
let passedTests = 0;

function runTest(name: string, fn: () => void) {
  totalTests++;
  try {
    fn();
    console.log(`[PASS] ${totalTests}. ${name}`);
    passedTests++;
  } catch (err: any) {
    console.error(`[FAIL] ${totalTests}. ${name}:`, err.message);
    throw err;
  }
}

function deriveScopeCode(scopeText: string): string {
  if (!scopeText || !scopeText.trim()) return 'MAT';
  const words = scopeText.trim().replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    const code = words.map((w) => w[0].toUpperCase()).slice(0, 4).join('');
    if (code.length >= 2) return code;
  }
  const word = (words[0] || 'MAT').toUpperCase();
  if (word.length <= 4) return word;
  return word.slice(0, 3);
}

function generateSemanticTPCode(
  selectedAnalysisItem: { id: string; elementId?: string; elementName?: string; scopeCode?: string; materialScope?: string },
  cpElements: Array<{ id?: string; name: string; code?: string }> = [],
  existingItems: TPItem[] = [],
  currentEditingItemId?: string
): string {
  let elementCode = 'E1';
  if (cpElements && cpElements.length > 0) {
    const elemIdx = cpElements.findIndex(
      (e) =>
        (selectedAnalysisItem.elementId && e.id === selectedAnalysisItem.elementId) ||
        (e.name && selectedAnalysisItem.elementName && e.name.toLowerCase().trim() === selectedAnalysisItem.elementName.toLowerCase().trim()) ||
        (e.code && selectedAnalysisItem.elementId && e.code.toLowerCase().trim() === selectedAnalysisItem.elementId.toLowerCase().trim())
    );
    if (elemIdx >= 0) {
      const matchedElem = cpElements[elemIdx];
      elementCode = matchedElem.code && /^E\d+$/i.test(matchedElem.code)
        ? matchedElem.code.toUpperCase()
        : `E${elemIdx + 1}`;
    }
  }

  const rawScope = (selectedAnalysisItem.scopeCode || '').trim().toUpperCase();
  const scopeCode = rawScope && /^[A-Z0-9]{2,5}$/.test(rawScope)
    ? rawScope
    : deriveScopeCode(selectedAnalysisItem.materialScope || selectedAnalysisItem.elementName || 'Umum');

  const prefix = `${elementCode}-${scopeCode}`;
  let maxSeq = 0;
  existingItems.forEach((it) => {
    if (currentEditingItemId && it.id === currentEditingItemId) return;
    if (it.code && it.code.toUpperCase().startsWith(`${prefix}-`)) {
      const parts = it.code.split('-');
      const num = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(num) && num > maxSeq) {
        maxSeq = num;
      }
    }
  });

  const nextSeq = maxSeq + 1;
  return `${prefix}-${String(nextSeq).padStart(2, '0')}`;
}

// ===========================================================
// SCENARIO SETUP
// ===========================================================
mockStorage.clear();
saveStorageV5(createInitialStorageV5());
const school = createSchoolV5({
  name: 'SD Merdeka 01',
  npsn: '12345678',
  address: 'Jl. Merdeka No. 1',
  village: 'Gambir',
  district: 'Gambir',
  regency: 'Jakarta Pusat',
  province: 'DKI Jakarta',
  principalName: 'Kepala Sekolah, M.Pd.',
  principalNip: '197001011995011001',
});
const profile = createProfileV5({
  name: 'Guru Penggerak',
  nip: '198501012010011001',
  schoolId: school.id,
  defaultLevel: 'SD',
  defaultSubject: 'Matematika',
  status: 'PNS',
});
const { yearPlan } = createYearHierarchyV5({
  profileId: profile.id,
  schoolId: school.id,
  academicYear: '2026/2027',
  curriculumType: 'KURIKULUM_MERDEKA',
  level: 'SD',
  grade: 'Kelas 4',
  subject: 'Matematika',
});

const academicSetting: AcademicSetting = {
  id: yearPlan.id,
  profileId: profile.id,
  academicYear: '2026/2027',
  level: 'SD',
  grade: 'Kelas 4' as any,
  subject: 'Matematika',
  phase: 'B',
  curriculum: 'Kurikulum Merdeka',
  curriculumType: 'KURIKULUM_MERDEKA',
  semester: '1 (Ganjil)' as any,
  updatedAt: new Date().toISOString(),
};

// ===========================================================
// TEST SUITE A: AI-FIRST PIPELINE
// ===========================================================
runTest('Scenario A (AI-First): CP Valid -> CP Analysis Canonical', () => {
  const cpData: CPData = {
    id: `cp-${yearPlan.id}`,
    academicSettingId: yearPlan.id,
    generalDescription: 'Peserta didik memahami bilangan cacah dan pecahan serta operasinya.',
    elements: [
      { id: 'el-bilangan', code: 'E1', name: 'Bilangan', content: 'Peserta didik dapat memahami konsep pecahan.' },
    ],
    updatedAt: new Date('2026-02-01T00:00:00Z').toISOString(),
  };

  const cpAnalysisData: CPAnalysisData = {
    id: `cpa-${yearPlan.id}`,
    academicSettingId: yearPlan.id,
    cpId: cpData.id,
    generalSummary: 'Bedah elemen bilangan dan materi pecahan',
    items: [
      {
        id: 'ana-item-01',
        elementId: 'el-bilangan',
        elementName: 'Bilangan',
        scopeCode: 'PCH',
        cpCompetence: 'Memahami',
        materialScope: 'Pecahan Senilai',
        suggestedTp: 'Peserta didik mampu memahami pecahan senilai.',
        order: 1,
      },
    ],
    generatedBy: 'AI',
    generationEngine: 'gemini',
    provenance: {
      generatedBy: 'AI',
      generatedAt: new Date().toISOString(),
      engine: 'gemini',
    },
    basedOnCpUpdatedAt: cpData.updatedAt,
    updatedAt: new Date('2026-02-01T01:00:00Z').toISOString(),
  };

  const cpaVal = validateCPAnalysisDataWorkflow(cpAnalysisData, cpData);
  assert.strictEqual(cpaVal.isSiap, true, 'CP Analysis validation must be SIAP');
  assert.strictEqual(cpaVal.status, 'SIAP');

  saveCPV5(yearPlan.id, cpData);
  saveCPAnalysisV5(yearPlan.id, cpAnalysisData);
});

runTest('Scenario A (AI-First): TP Atomic Canonical with Semantic Code', () => {
  const loaded = getAnnualDataV5(yearPlan.id);
  assert(loaded.cp, 'CP must exist');
  assert(loaded.cpAnalysis, 'CP Analysis must exist');

  const tpItem: TPItem = {
    id: 'tp-item-101',
    code: 'E1-PCH-01',
    scopeCode: 'PCH',
    cpAnalysisId: 'ana-item-01',
    cpAnalysisItemIds: ['ana-item-01'],
    elementName: 'Bilangan',
    statement: 'Peserta didik mampu memahami konsep pecahan senilai dengan gambar konkret.',
    competence: 'Memahami',
    contentScope: 'Pecahan Senilai',
    p3Dimensions: ['Bernalar Kritis'],
    order: 1,
  };

  const tpData: TPData = {
    id: `tp-${yearPlan.id}`,
    academicSettingId: yearPlan.id,
    cpId: loaded.cp.id,
    cpAnalysisId: loaded.cpAnalysis.id,
    phase: 'B',
    items: [tpItem],
    generatedBy: 'AI',
    generationEngine: 'gemini',
    workflowStatus: 'SIAP',
    basedOnCpUpdatedAt: loaded.cp.updatedAt,
    basedOnAnalysisUpdatedAt: loaded.cpAnalysis.updatedAt,
    updatedAt: new Date('2026-02-01T02:00:00Z').toISOString(),
  };

  const tpVal = validateTPDataWorkflow(tpData, loaded.cp, loaded.cpAnalysis, academicSetting);
  assert.strictEqual(tpVal.isSiap, true, `TP validation must be SIAP: ${tpVal.issues.join('; ')}`);
  assert.strictEqual(tpVal.status, 'SIAP');

  saveTPV5(yearPlan.id, tpData);
});

runTest('Scenario A (AI-First): ATP Canonical & Workflow Dependencies', () => {
  const loaded = getAnnualDataV5(yearPlan.id);
  assert(loaded.cp && loaded.cpAnalysis && loaded.tp, 'CP, CPA, and TP must exist');

  const atpItem: ATPItem = {
    id: 'atp-item-201',
    stepNumber: 1,
    tpId: 'tp-item-101',
    linkedTpIds: ['tp-item-101'],
    tpCode: 'E1-PCH-01',
    tpStatement: 'Peserta didik mampu memahami konsep pecahan senilai dengan gambar konkret.',
    materialScope: 'Pecahan Senilai',
    jp: 4,
  };

  const atpData: ATPData = {
    id: `atp-${yearPlan.id}`,
    academicSettingId: yearPlan.id,
    tpDataId: loaded.tp.id,
    tpId: loaded.tp.id,
    phase: 'B',
    rationale: 'Alur disusun secara induktif.',
    items: [atpItem],
    generatedBy: 'AI',
    workflowStatus: 'SIAP',
    basedOnTpUpdatedAt: loaded.tp.updatedAt,
    updatedAt: new Date('2026-02-01T03:00:00Z').toISOString(),
  };

  const atpVal = validateATPDataWorkflow(atpData, loaded.tp, academicSetting);
  assert.strictEqual(atpVal.isSiap, true, `ATP validation must be SIAP: ${atpVal.issues.join('; ')}`);
  assert.strictEqual(atpVal.status, 'SIAP');

  saveATPV5(yearPlan.id, atpData);

  // Full workflow validation
  const wf = validateWorkflowDependencies({
    academicSetting,
    profile,
    school,
    cp: loaded.cp,
    cpAnalysis: loaded.cpAnalysis,
    tp: loaded.tp,
    atp: atpData,
  });

  assert.strictEqual(wf.stepStates.cp?.isComplete, true, 'CP step must be COMPLETE');
  assert.strictEqual(wf.stepStates['cp-analysis']?.isComplete, true, 'CP-Analysis step must be COMPLETE');
  assert.strictEqual(wf.stepStates.tp?.isComplete, true, 'TP step must be COMPLETE');
  assert.strictEqual(wf.stepStates.atp?.isComplete, true, 'ATP step must be COMPLETE');
});

runTest('Scenario A (AI-First): Save -> Reload Preserves Complete Lineage & Readiness', () => {
  const reloaded = getAnnualDataV5(yearPlan.id);
  assert(reloaded.cp && reloaded.cpAnalysis && reloaded.tp && reloaded.atp, 'All reloaded components must exist');

  // Verify CP Analysis -> TP 1:1 lineage
  const tpItem = reloaded.tp.items[0];
  const cpaItem = reloaded.cpAnalysis.items[0];
  assert.strictEqual(tpItem.cpAnalysisItemIds?.[0], cpaItem.id, 'TP must reference canonical CPA item');
  assert.strictEqual(tpItem.code, 'E1-PCH-01', 'TP code must be canonical semantic');

  // Verify TP -> ATP lineage
  const atpItem = reloaded.atp.items[0];
  assert.strictEqual(atpItem.linkedTpIds?.[0], tpItem.id, 'ATP must reference canonical TP item');

  // Verify canonical validator readiness on reload
  const cpaVal = validateCPAnalysisDataWorkflow(reloaded.cpAnalysis, reloaded.cp);
  const tpVal = validateTPDataWorkflow(reloaded.tp, reloaded.cp, reloaded.cpAnalysis, academicSetting);
  const atpVal = validateATPDataWorkflow(reloaded.atp, reloaded.tp, academicSetting);

  assert.strictEqual(cpaVal.isSiap, true, 'Reloaded CP Analysis must be SIAP');
  assert.strictEqual(tpVal.isSiap, true, 'Reloaded TP must be SIAP');
  assert.strictEqual(atpVal.isSiap, true, 'Reloaded ATP must be SIAP');
});

// ===========================================================
// TEST SUITE B: MANUAL FALLBACK PIPELINE
// ===========================================================
runTest('Scenario B (Manual Fallback): Manual Add TP Without Selection is Rejected', () => {
  const loaded = getAnnualDataV5(yearPlan.id);
  assert(loaded.cp && loaded.cpAnalysis, 'CP and CPA must exist');

  const unlinkedTPItem: TPItem = {
    id: 'tp-manual-unlinked',
    code: 'E1-PCH-02',
    statement: 'Peserta didik mampu menyelesaikan masalah pecahan.',
    competence: 'Menyelesaikan',
    contentScope: 'Pecahan',
    cpAnalysisItemIds: [], // Empty!
    order: 2,
  };

  const tpCandidate: TPData = {
    ...loaded.tp!,
    items: [unlinkedTPItem],
  };

  const val = validateTPDataWorkflow(tpCandidate, loaded.cp, loaded.cpAnalysis, academicSetting);
  assert.strictEqual(val.isSiap, false, 'TP without CPAnalysisItemIds must NOT be SIAP');
  assert(val.issues.some((msg) => msg.includes('belum menautkan butir Analisis CP')), 'Must have unlinked issue');
});

runTest('Scenario B (Manual Fallback): Select Exactly 1 Item Generates Semantic Code and reaches SIAP', () => {
  const loaded = getAnnualDataV5(yearPlan.id);
  const cpaItem = loaded.cpAnalysis!.items[0];

  // Generator helper resolves semantic code
  const semanticCode = generateSemanticTPCode(
    cpaItem,
    loaded.cp!.elements || [],
    loaded.tp!.items || []
  );

  assert.match(semanticCode, /^E\d+-[A-Z0-9]{2,5}-\d{2}$/, 'Generated code must match canonical format');
  assert.strictEqual(semanticCode, 'E1-PCH-02', 'Next sequence must be 02 for E1-PCH');

  const validManualTPItem: TPItem = {
    id: 'tp-manual-valid-2',
    code: semanticCode,
    scopeCode: 'PCH',
    cpAnalysisId: cpaItem.id,
    cpAnalysisItemIds: [cpaItem.id],
    elementName: cpaItem.elementName,
    statement: 'Peserta didik mampu mengurutkan pecahan senilai secara runtut.',
    competence: 'Mengurutkan',
    contentScope: 'Pecahan Senilai',
    p3Dimensions: ['Mandiri'],
    order: 2,
  };

  const combinedTP: TPData = {
    ...loaded.tp!,
    items: [loaded.tp!.items[0], validManualTPItem],
    generatedBy: 'AI_EDITED_BY_TEACHER',
  };

  const val = validateTPDataWorkflow(combinedTP, loaded.cp, loaded.cpAnalysis, academicSetting);
  assert.strictEqual(val.isSiap, true, `Combined TP must be SIAP: ${val.issues.join('; ')}`);

  saveTPV5(yearPlan.id, combinedTP);
});

// ===========================================================
// TEST SUITE C: NO SILENT FALLBACK
// ===========================================================
runTest('Scenario C (No Silent Fallback): TP Item Without Lineage Does NOT Auto-select Item 0', () => {
  const legacyItemWithoutLineage: TPItem = {
    id: 'tp-legacy-orphan',
    code: 'E1-PCH-99',
    statement: 'TP tanpa lineage.',
    competence: 'Menyebutkan',
    contentScope: 'Materi',
    order: 1,
    // No cpAnalysisItemIds, no cpAnalysisId
  };

  // Simulate handleOpenEdit logic
  const rawAnalysisIds = Array.isArray(legacyItemWithoutLineage.cpAnalysisItemIds) && legacyItemWithoutLineage.cpAnalysisItemIds.length > 0
    ? [...legacyItemWithoutLineage.cpAnalysisItemIds]
    : legacyItemWithoutLineage.cpAnalysisId
    ? [legacyItemWithoutLineage.cpAnalysisId]
    : [];

  const currentItemState = {
    ...legacyItemWithoutLineage,
    cpAnalysisItemIds: rawAnalysisIds,
    cpAnalysisId: rawAnalysisIds[0] || undefined,
  };

  assert.strictEqual(currentItemState.cpAnalysisItemIds.length, 0, 'Must NOT default to items[0]');
  assert.strictEqual(currentItemState.cpAnalysisId, undefined, 'Must remain undefined');
});

// ===========================================================
// TEST SUITE D: ATP STABLE ID ON AI REALIGNMENT
// ===========================================================
runTest('Scenario D (ATP Stable ID): Same Grouping Preserves ATPItem.id', () => {
  const existingATPItems: ATPItem[] = [
    {
      id: 'stable-atp-step-1',
      stepNumber: 1,
      linkedTpIds: ['tp-item-101'],
      tpCode: 'E1-PCH-01',
      tpStatement: 'Tujuan 1',
    },
    {
      id: 'stable-atp-step-2',
      stepNumber: 2,
      linkedTpIds: ['tp-manual-valid-2'],
      tpCode: 'E1-PCH-02',
      tpStatement: 'Tujuan 2',
    },
  ];

  // AI produces new arrangement with same grouping of linkedTpIds
  const aiGeneratedSteps = [
    { stepNumber: 1, linkedTpIds: ['tp-item-101'], focus: 'Fokus awal' },
    { stepNumber: 2, linkedTpIds: ['tp-manual-valid-2'], focus: 'Fokus lanjutan' },
  ];

  const loadedTP = getAnnualDataV5(yearPlan.id).tp!;
  const usedExistingIds = new Set<string>();
  const realignedItems: ATPItem[] = [];

  for (let idx = 0; idx < aiGeneratedSteps.length; idx++) {
    const gen = aiGeneratedSteps[idx];
    const candidateItem: ATPItem = {
      id: '',
      stepNumber: gen.stepNumber,
      linkedTpIds: gen.linkedTpIds,
    };

    const refResult = resolveATPItemTPReferences(candidateItem, loadedTP.items);
    assert(refResult.isValid, 'References must be valid');

    const canonicalLinkedTpIds = refResult.canonicalTPItems.map((t) => t.id);
    const normalizedCandidateKey = [...canonicalLinkedTpIds].sort().join(',');

    const matchedExisting = existingATPItems.find((existing) => {
      if (usedExistingIds.has(existing.id)) return false;
      const existingLinked = Array.isArray(existing.linkedTpIds) && existing.linkedTpIds.length > 0
        ? existing.linkedTpIds
        : existing.tpId ? [existing.tpId] : [];
      const existingKey = [...existingLinked].sort().join(',');
      return existingKey === normalizedCandidateKey;
    });

    const stableId = matchedExisting
      ? matchedExisting.id
      : `atp-new-${Date.now()}-${idx}`;

    if (matchedExisting) {
      usedExistingIds.add(matchedExisting.id);
    }

    candidateItem.id = stableId;
    candidateItem.linkedTpIds = canonicalLinkedTpIds;
    realignedItems.push(candidateItem);
  }

  assert.strictEqual(realignedItems[0].id, 'stable-atp-step-1', 'Step 1 ID must be preserved');
  assert.strictEqual(realignedItems[1].id, 'stable-atp-step-2', 'Step 2 ID must be preserved');
});

runTest('Scenario D (ATP Stable ID): Changed Grouping Generates New ID Only for Changed Step', () => {
  const existingATPItems: ATPItem[] = [
    {
      id: 'stable-atp-step-1',
      stepNumber: 1,
      linkedTpIds: ['tp-item-101'],
      tpCode: 'E1-PCH-01',
    },
    {
      id: 'stable-atp-step-2',
      stepNumber: 2,
      linkedTpIds: ['tp-manual-valid-2'],
      tpCode: 'E1-PCH-02',
    },
  ];

  // AI merges both into a single combined multi-TP step
  const aiGeneratedSteps = [
    { stepNumber: 1, linkedTpIds: ['tp-item-101', 'tp-manual-valid-2'], focus: 'Fokus gabungan' },
  ];

  const loadedTP = getAnnualDataV5(yearPlan.id).tp!;
  const usedExistingIds = new Set<string>();
  const realignedItems: ATPItem[] = [];

  for (let idx = 0; idx < aiGeneratedSteps.length; idx++) {
    const gen = aiGeneratedSteps[idx];
    const candidateItem: ATPItem = {
      id: '',
      stepNumber: gen.stepNumber,
      linkedTpIds: gen.linkedTpIds,
    };

    const refResult = resolveATPItemTPReferences(candidateItem, loadedTP.items);
    assert(refResult.isValid, 'References must be valid');

    const canonicalLinkedTpIds = refResult.canonicalTPItems.map((t) => t.id);
    const normalizedCandidateKey = [...canonicalLinkedTpIds].sort().join(',');

    const matchedExisting = existingATPItems.find((existing) => {
      if (usedExistingIds.has(existing.id)) return false;
      const existingLinked = Array.isArray(existing.linkedTpIds) && existing.linkedTpIds.length > 0
        ? existing.linkedTpIds
        : existing.tpId ? [existing.tpId] : [];
      const existingKey = [...existingLinked].sort().join(',');
      return existingKey === normalizedCandidateKey;
    });

    const stableId = matchedExisting
      ? matchedExisting.id
      : `atp-new-${idx + 1}`;

    if (matchedExisting) {
      usedExistingIds.add(matchedExisting.id);
    }

    candidateItem.id = stableId;
    candidateItem.linkedTpIds = canonicalLinkedTpIds;
    realignedItems.push(candidateItem);
  }

  assert.strictEqual(realignedItems.length, 1);
  assert.strictEqual(realignedItems[0].id, 'atp-new-1', 'Changed grouping step must receive a new ID');
  assert.notStrictEqual(realignedItems[0].id, 'stable-atp-step-1');
  assert.notStrictEqual(realignedItems[0].id, 'stable-atp-step-2');
});

console.log(`\n=== All Regression Tests Passed: ${passedTests} / ${totalTests} ===\n`);
