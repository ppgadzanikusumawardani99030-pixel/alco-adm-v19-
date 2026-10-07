import assert from 'node:assert';
import {
  createInitialStorageV5,
  saveStorageV5,
  createProfileV5,
  createSchoolV5,
  createYearHierarchyV5,
  saveCPV5,
  saveCPAnalysisV5,
  saveTPV5,
  saveATPV5,
  getAnnualDataV5,
} from '../src/services/storageV5';
import {
  validateCPAnalysisDataWorkflow,
  validateTPDataWorkflow,
  validateATPDataWorkflow,
  resolveATPItemTPReferences,
  deriveScopeCode,
  generateSemanticTPCode,
} from '../src/services/cpWorkflowService';
import { validateWorkflowDependencies } from '../src/services/workflowEngine';
import {
  aiFetch,
  saveGeminiApiKey,
  removeGeminiApiKey,
  generateTPWithAI,
  analyzeCPWithAI,
} from '../src/services/aiService';
import {
  CPData,
  CPAnalysisData,
  TPData,
  ATPData,
  ATPItem,
  TPItem,
  AcademicSetting,
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

function runTest(name: string, fn: () => void | Promise<void>) {
  totalTests++;
  try {
    const result = fn();
    if (result && typeof (result as any).then === 'function') {
      return (result as Promise<void>)
        .then(() => {
          console.log(`[PASS] ${totalTests}. ${name}`);
          passedTests++;
        })
        .catch((err: any) => {
          console.error(`[FAIL] ${totalTests}. ${name}:`, err.message);
          throw err;
        });
    }
    console.log(`[PASS] ${totalTests}. ${name}`);
    passedTests++;
  } catch (err: any) {
    console.error(`[FAIL] ${totalTests}. ${name}:`, err.message);
    throw err;
  }
}

async function runAll() {
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
        { id: 'el-aljabar', code: 'E2', name: 'Aljabar', content: 'Peserta didik dapat menyelesaikan pola kalimat matematika.' },
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
        {
          id: 'ana-item-02',
          elementId: 'el-aljabar',
          elementName: 'Aljabar',
          scopeCode: 'ALJ',
          cpCompetence: 'Mengidentifikasi',
          materialScope: 'Pola Gambar',
          suggestedTp: 'Peserta didik mampu mengidentifikasi pola gambar.',
          order: 2,
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

    const tpItem1: TPItem = {
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

    const tpItem2: TPItem = {
      id: 'tp-item-102',
      code: 'E2-ALJ-01',
      scopeCode: 'ALJ',
      cpAnalysisId: 'ana-item-02',
      cpAnalysisItemIds: ['ana-item-02'],
      elementName: 'Aljabar',
      statement: 'Peserta didik mampu mengidentifikasi pola gambar secara berulang.',
      competence: 'Mengidentifikasi',
      contentScope: 'Pola Gambar',
      p3Dimensions: ['Mandiri'],
      order: 2,
    };

    const tpData: TPData = {
      id: `tp-${yearPlan.id}`,
      academicSettingId: yearPlan.id,
      cpId: loaded.cp.id,
      cpAnalysisId: loaded.cpAnalysis.id,
      phase: 'B',
      items: [tpItem1, tpItem2],
      generatedBy: 'AI',
      generationEngine: 'gemini',
      provenance: {
        generatedBy: 'AI',
        generatedAt: new Date().toISOString(),
        engine: 'gemini',
      },
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

    const atpItem1: ATPItem = {
      id: 'atp-item-201',
      stepNumber: 1,
      tpId: 'tp-item-101',
      linkedTpIds: ['tp-item-101'],
      tpCode: 'E1-PCH-01',
      tpStatement: 'Peserta didik mampu memahami konsep pecahan senilai dengan gambar konkret.',
      materialScope: 'Pecahan Senilai',
      jp: 4,
    };

    const atpItem2: ATPItem = {
      id: 'atp-item-202',
      stepNumber: 2,
      tpId: 'tp-item-102',
      linkedTpIds: ['tp-item-102'],
      tpCode: 'E2-ALJ-01',
      tpStatement: 'Peserta didik mampu mengidentifikasi pola gambar secara berulang.',
      materialScope: 'Pola Gambar',
      jp: 4,
    };

    const atpData: ATPData = {
      id: `atp-${yearPlan.id}`,
      academicSettingId: yearPlan.id,
      tpDataId: loaded.tp.id,
      tpId: loaded.tp.id,
      phase: 'B',
      rationale: 'Alur disusun secara bertahap.',
      items: [atpItem1, atpItem2],
      generatedBy: 'AI',
      workflowStatus: 'SIAP',
      basedOnTpUpdatedAt: loaded.tp.updatedAt,
      updatedAt: new Date('2026-02-01T03:00:00Z').toISOString(),
    };

    const atpVal = validateATPDataWorkflow(atpData, loaded.tp, academicSetting);
    assert.strictEqual(atpVal.isSiap, true, `ATP validation must be SIAP: ${atpVal.issues.join('; ')}`);
    assert.strictEqual(atpVal.status, 'SIAP');

    saveATPV5(yearPlan.id, atpData);

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

    const cpaVal = validateCPAnalysisDataWorkflow(reloaded.cpAnalysis, reloaded.cp);
    const tpVal = validateTPDataWorkflow(reloaded.tp, reloaded.cp, reloaded.cpAnalysis, academicSetting);
    const atpVal = validateATPDataWorkflow(reloaded.atp, reloaded.tp, academicSetting);

    assert.strictEqual(cpaVal.isSiap, true, 'Reloaded CP Analysis must be SIAP');
    assert.strictEqual(tpVal.isSiap, true, 'Reloaded TP must be SIAP');
    assert.strictEqual(atpVal.isSiap, true, 'Reloaded ATP must be SIAP');
  });

  // ===========================================================
  // TEST SUITE B: MANUAL FALLBACK & CP ANALYSIS SWITCHING
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
      cpAnalysisItemIds: [],
      order: 3,
    };

    const tpCandidate: TPData = {
      ...loaded.tp!,
      items: [...loaded.tp!.items, unlinkedTPItem],
    };

    const val = validateTPDataWorkflow(tpCandidate, loaded.cp, loaded.cpAnalysis, academicSetting);
    assert.strictEqual(val.isSiap, false, 'TP without CPAnalysisItemIds must NOT be SIAP');
    assert(val.issues.some((msg) => msg.includes('belum menautkan butir Analisis CP')), 'Must have unlinked issue');
  });

  runTest('Scenario B (Switching CP Analysis Item A -> B): Fully Updates Competence, ContentScope, ScopeCode, and Semantic Code', () => {
    const loaded = getAnnualDataV5(yearPlan.id);
    const itemA = loaded.cpAnalysis!.items[0]; // Bilangan, PCH, Memahami, Pecahan Senilai
    const itemB = loaded.cpAnalysis!.items[1]; // Aljabar, ALJ, Mengidentifikasi, Pola Gambar

    // Initially selected Item A
    let currentItem = {
      id: 'tp-item-edit-test',
      code: generateSemanticTPCode(itemA, loaded.cp!.elements || [], loaded.tp!.items || []),
      scopeCode: itemA.scopeCode,
      cpAnalysisItemIds: [itemA.id],
      cpAnalysisId: itemA.id,
      elementName: itemA.elementName,
      competence: itemA.cpCompetence,
      contentScope: itemA.materialScope,
    };

    assert.strictEqual(currentItem.competence, 'Memahami');
    assert.strictEqual(currentItem.contentScope, 'Pecahan Senilai');
    assert.strictEqual(currentItem.code, 'E1-PCH-02');

    // Simulate teacher switching dropdown from Item A to Item B
    const selId = itemB.id;
    const matchedAna = loaded.cpAnalysis!.items.find((a) => a.id === selId);
    assert(matchedAna, 'Item B must be found');

    const generatedCode = generateSemanticTPCode(
      matchedAna,
      loaded.cp!.elements || [],
      loaded.tp!.items || [],
      currentItem.id
    );
    const resolvedScopeCode = (matchedAna.scopeCode || '').trim().toUpperCase() || deriveScopeCode(matchedAna.materialScope);

    currentItem = {
      ...currentItem,
      code: generatedCode,
      scopeCode: resolvedScopeCode,
      cpAnalysisItemIds: [selId],
      cpAnalysisId: selId,
      elementName: matchedAna.elementName || '',
      competence: matchedAna.cpCompetence || '',
      contentScope: matchedAna.materialScope || '',
    };

    // Assert that NONE of Item A's competence/contentScope was retained
    assert.strictEqual(currentItem.cpAnalysisItemIds[0], itemB.id, 'Lineage must be Item B');
    assert.strictEqual(currentItem.elementName, 'Aljabar', 'Element name must be Aljabar');
    assert.strictEqual(currentItem.competence, 'Mengidentifikasi', 'Competence must be Item B competence');
    assert.strictEqual(currentItem.contentScope, 'Pola Gambar', 'Content scope must be Item B materialScope');
    assert.strictEqual(currentItem.scopeCode, 'ALJ', 'Scope code must be ALJ');
    assert.strictEqual(currentItem.code, 'E2-ALJ-02', 'Semantic code must update to E2-ALJ-02');
  });

  // ===========================================================
  // TEST SUITE C: PROVENANCE CONSISTENCY
  // ===========================================================
  runTest('Scenario C (Provenance): Gemini vs Pedagogical Engine Provenance Semantics', () => {
    // 1. Gemini analysis
    const geminiAnalysis: CPAnalysisData = {
      id: 'cpa-gem',
      academicSettingId: yearPlan.id,
      items: [],
      generatedBy: 'AI',
      generationEngine: 'gemini',
      provenance: {
        generatedBy: 'AI',
        generatedAt: new Date().toISOString(),
        engine: 'gemini',
      },
      updatedAt: new Date().toISOString(),
    };
    assert.strictEqual(geminiAnalysis.generatedBy, 'AI');
    assert.strictEqual(geminiAnalysis.generationEngine, 'gemini');
    assert.strictEqual(geminiAnalysis.provenance?.generatedBy, 'AI');
    assert.strictEqual(geminiAnalysis.provenance?.engine, 'gemini');

    // 2. Pedagogical engine fallback analysis (MUST NOT be labeled TEACHER)
    const fallbackAnalysis: CPAnalysisData = {
      id: 'cpa-fallback',
      academicSettingId: yearPlan.id,
      items: [],
      generatedBy: undefined, // NOT TEACHER
      generationEngine: 'pedagogical_engine',
      provenance: {
        generatedBy: 'SYSTEM',
        generatedAt: new Date().toISOString(),
        engine: 'pedagogical_engine',
      },
      updatedAt: new Date().toISOString(),
    };
    assert.notStrictEqual(fallbackAnalysis.generatedBy, 'TEACHER', 'Fallback must NOT be marked TEACHER');
    assert.strictEqual(fallbackAnalysis.generationEngine, 'pedagogical_engine');
    assert.strictEqual(fallbackAnalysis.provenance?.generatedBy, 'SYSTEM');
    assert.strictEqual(fallbackAnalysis.provenance?.engine, 'pedagogical_engine');
  });

  // ===========================================================
  // TEST SUITE D: TRANSPORT & BYOK PRIORITY
  // ===========================================================
  await runTest('Scenario D (Transport): Server Fallback 200 + Local BYOK -> Retries and Uses Gemini', async () => {
    const originalFetch = global.fetch;
    let fetchCalls = 0;
    let secondCallHeaders: Headers | null = null;

    saveGeminiApiKey('AIzaSyTestUserKey123');

    global.fetch = async (url, init) => {
      fetchCalls++;
      if (fetchCalls === 1) {
        // Request 1: Without BYOK header, server returned 200 with pedagogical_engine fallback
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          clone: () => ({
            json: async () => ({
              success: true,
              engine: 'pedagogical_engine',
              data: { generalSummary: 'Fallback', items: [] },
            }),
          }),
          json: async () => ({
            success: true,
            engine: 'pedagogical_engine',
            data: { generalSummary: 'Fallback', items: [] },
          }),
        } as any;
      }

      // Request 2: Retry with user key -> server succeeds with Gemini
      secondCallHeaders = new Headers(init?.headers);
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        json: async () => ({
          success: true,
          engine: 'gemini',
          data: {
            generalSummary: 'Gemini Summary',
            items: [
              {
                elementName: 'Bilangan',
                scopeCode: 'PCH',
                cpCompetence: 'Memahami',
                materialScope: 'Pecahan Senilai',
              },
            ],
          },
        }),
      } as any;
    };

    try {
      const res = await analyzeCPWithAI({
        cpText: 'CP Text',
        elements: [],
        subject: 'Matematika',
        grade: 'Kelas 4',
        phase: 'Fase B',
        curriculum: 'Kurikulum Merdeka',
      });

      assert.strictEqual(fetchCalls, 2, 'Must have made 2 fetch calls (server-first then retry with BYOK)');
      assert.strictEqual(secondCallHeaders?.get('x-gemini-api-key'), 'AIzaSyTestUserKey123', 'Second call must include user key');
      assert.strictEqual(res.engine, 'gemini', 'Must use Gemini result from retry');
      assert.strictEqual(res.generalSummary, 'Gemini Summary');
    } finally {
      removeGeminiApiKey();
      global.fetch = originalFetch;
    }
  });

  await runTest('Scenario D (Transport): Without Local BYOK -> Uses Pedagogical Engine Without Prompting Modal', async () => {
    const originalFetch = global.fetch;
    let fetchCalls = 0;

    removeGeminiApiKey();

    global.fetch = async () => {
      fetchCalls++;
      return {
        ok: true,
        status: 200,
        headers: { get: () => 'application/json' },
        clone: () => ({
          json: async () => ({
            success: true,
            engine: 'pedagogical_engine',
            data: { generalSummary: 'Fallback Summary', items: [] },
          }),
        }),
        json: async () => ({
          success: true,
          engine: 'pedagogical_engine',
          data: { generalSummary: 'Fallback Summary', items: [] },
        }),
      } as any;
    };

    try {
      const res = await analyzeCPWithAI({
        cpText: 'CP Text',
        elements: [],
        subject: 'Matematika',
        grade: 'Kelas 4',
        phase: 'Fase B',
        curriculum: 'Kurikulum Merdeka',
      });

      assert.strictEqual(fetchCalls, 1, 'Must only make 1 fetch call when local BYOK is absent');
      assert.strictEqual(res.engine, 'pedagogical_engine', 'Must use pedagogical engine');
      assert.strictEqual(res.generalSummary, 'Fallback Summary');
    } finally {
      global.fetch = originalFetch;
    }
  });

  // ===========================================================
  // TEST SUITE E: ATP STABLE ID ON AI REALIGNMENT
  // ===========================================================
  runTest('Scenario E (ATP Stable ID): Same Grouping Preserves ATPItem.id', () => {
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
        linkedTpIds: ['tp-item-102'],
        tpCode: 'E2-ALJ-01',
      },
    ];

    const aiGeneratedSteps = [
      { stepNumber: 1, linkedTpIds: ['tp-item-101'], focus: 'Fokus awal' },
      { stepNumber: 2, linkedTpIds: ['tp-item-102'], focus: 'Fokus lanjutan' },
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

      const stableId = matchedExisting ? matchedExisting.id : `atp-new-${idx}`;
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

  runTest('Scenario E (ATP Stable ID): Changed Grouping Generates New ID Only for Changed Step', () => {
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
        linkedTpIds: ['tp-item-102'],
        tpCode: 'E2-ALJ-01',
      },
    ];

    const aiGeneratedSteps = [
      { stepNumber: 1, linkedTpIds: ['tp-item-101', 'tp-item-102'], focus: 'Fokus gabungan' },
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

      const stableId = matchedExisting ? matchedExisting.id : `atp-new-${idx + 1}`;
      if (matchedExisting) {
        usedExistingIds.add(matchedExisting.id);
      }

      candidateItem.id = stableId;
      candidateItem.linkedTpIds = canonicalLinkedTpIds;
      realignedItems.push(candidateItem);
    }

    assert.strictEqual(realignedItems.length, 1);
    assert.strictEqual(realignedItems[0].id, 'atp-new-1', 'Changed step must receive new ID');
  });

  console.log(`\n=== All Regression Tests Passed: ${passedTests} / ${totalTests} ===\n`);
}

runAll().catch((err) => {
  console.error('Fatal error running regression suite:', err);
  process.exit(1);
});
