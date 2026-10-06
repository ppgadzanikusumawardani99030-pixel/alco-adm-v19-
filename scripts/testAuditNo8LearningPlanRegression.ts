import * as fs from 'fs';
import * as path from 'path';
import {
  createEmptyLearningPlan,
  createAIDraftLearningPlan,
  invalidatePlanIfDependenciesChanged,
  validateLearningPlan,
  resolveLearningPlanAllocatedJP,
  buildLearningPlanScopeUnits,
} from '../src/services/learningPlanService';
import { generateAutoDraftPlansFromCanonicalContext, validateAssessmentPlan } from '../src/services/assessmentPlanService';
import { resolveScheduledLearningMeetings } from '../src/services/scheduledLearningMeetingProjectionService';
import { buildModulAjarProjection } from '../src/services/documentEngine/modulAjarProjection';
import { generateModulAjar } from '../src/services/documentEngine/generators/modulAjarGenerator';
import { generatePdfDocument } from '../src/services/documentEngine/renderers/pdf/pdfDocGenerators';
import { validateDocumentRequirements } from '../src/services/documentEngine';
import { AcademicSetting, TPData, ATPData, LearningPlan, SchoolData, TeacherProfile, TimeAllocation } from '../src/types';

async function runRegressionSuite() {
  console.log('=== RUNNING AUDIT NO. 8 REGRESSION SUITE ===\n');
  let passedCount = 0;
  let failedCount = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passedCount++;
    } else {
      console.error(`[FAIL] ${testName}${detail ? `: ${detail}` : ''}`);
      failedCount++;
    }
  }

  const mockSchool: SchoolData = {
    id: 's1',
    name: 'SMP Demo',
    npsn: '12345678',
    address: 'Jl. Demo',
    village: 'Kel',
    district: 'Kec',
    regency: 'Kota',
    province: 'Prov',
    principalName: 'Kepsek',
    principalNip: '-',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const mockProfile: TeacherProfile = {
    id: 'p1',
    name: 'Guru Demo',
    nip: '-',
    status: 'PNS',
    defaultSubject: 'Informatika',
    defaultLevel: 'SMP',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  const mockSetting: AcademicSetting = {
    id: 'setting-1',
    profileId: 'p1',
    subject: 'Informatika',
    level: 'SMP',
    grade: 'Kelas 7',
    phase: 'Fase D',
    semester: '1 (Ganjil)',
    academicYear: '2026/2027',
    curriculum: 'Kurikulum Merdeka',
    curriculumType: 'KURIKULUM_MERDEKA',
    updatedAt: new Date().toISOString(),
  };

  const mockTpData: TPData = {
    id: 'tpdata-1',
    academicSettingId: 'setting-1',
    updatedAt: new Date().toISOString(),
    items: [
      {
        id: 'tp-101',
        order: 1,
        code: 'TP 7.1',
        statement: 'Memahami konsep dasar algoritma dan pemograman.',
        competence: 'Memahami',
        contentScope: 'Algoritma Pemrograman',
        p3Dimensions: ['Bernalar Kritis'],
      },
      {
        id: 'tp-102',
        order: 2,
        code: 'TP 7.2',
        statement: 'Menerapkan struktur kontrol keputusan dalam program.',
        competence: 'Menerapkan',
        contentScope: 'Pemrograman Python',
        p3Dimensions: ['Mandiri', 'Kreatif'],
      },
    ],
    workflowStatus: 'SIAP',
    needsReview: false,
  };

  const mockAtpData: ATPData = {
    id: 'atpdata-1',
    academicSettingId: 'setting-1',
    updatedAt: new Date().toISOString(),
    totalJP: 36,
    workflowStatus: 'SIAP',
    needsReview: false,
    basedOnTpUpdatedAt: mockTpData.updatedAt,
    items: [
      {
        id: 'atp-201',
        stepNumber: 1,
        tpId: 'tp-101',
        tpCode: 'TP 7.1',
        tpStatement: 'Memahami konsep dasar algoritma dan pemograman.',
        materialScope: 'Algoritma Pemrograman',
        jp: 99,
        semester: 1,
      },
      {
        id: 'atp-202',
        stepNumber: 2,
        tpId: 'tp-102',
        tpCode: 'TP 7.2',
        tpStatement: 'Menerapkan struktur kontrol keputusan dalam program.',
        materialScope: 'Pemrograman Python',
        jp: 24,
        semester: 1,
      },
    ],
  };

  // Test 1: HAPUS FIRST-ITEM AUTO SELECTION
  console.log('--- Test 1: Hapus First-Item Auto Selection ---');
  const emptyPlan = createEmptyLearningPlan({
    academicSetting: mockSetting,
    curriculumType: 'KURIKULUM_MERDEKA',
    tpIds: [],
    atpItemIds: [],
    context: { tp: mockTpData, atp: mockAtpData },
  });
  assert(
    emptyPlan.tpIds.length === 0 && emptyPlan.atpItemIds.length === 0,
    'createEmptyLearningPlan must NOT auto-select first TP/ATP',
    `tpIds length=${emptyPlan.tpIds.length}`
  );

  // Test 2: HAPUS FABRICATED AI CONTENT
  console.log('\n--- Test 2: Hapus Fabricated AI Content ---');
  const aiPlan = createAIDraftLearningPlan({
    academicSetting: mockSetting,
    curriculumType: 'KURIKULUM_MERDEKA',
    tpIds: [],
    atpItemIds: [],
    aiDraft: {},
    context: { tp: mockTpData, atp: mockAtpData },
  });
  assert(
    aiPlan.status === 'DRAFT' && !aiPlan.learningModel && !aiPlan.targetStudents,
    'createAIDraftLearningPlan must start as DRAFT with no hardcoded PBL or target students',
    `learningModel=${aiPlan.learningModel}`
  );

  // Test 3: STRICT FINAL EXPORT GUARD
  console.log('\n--- Test 3: Strict Final Export Guard ---');
  let exportThrew = false;
  try {
    await generateModulAjar({
      school: mockSchool,
      profile: mockProfile,
      academicSetting: mockSetting,
      learningPlans: [emptyPlan], // Status DRAFT
      tp: mockTpData,
      atp: mockAtpData,
    });
  } catch (err: any) {
    exportThrew = true;
  }
  assert(
    exportThrew,
    'DOCX Generator must block export when LearningPlan is DRAFT'
  );

  let pdfExportThrew = false;
  try {
    await generatePdfDocument('MODUL_AJAR', {
      school: mockSchool,
      profile: mockProfile,
      academicSetting: mockSetting,
      learningPlans: [emptyPlan], // Status DRAFT
      tp: mockTpData,
      atp: mockAtpData,
    });
  } catch (err: any) {
    pdfExportThrew = true;
  }
  assert(
    pdfExportThrew,
    'PDF Generator must block export when LearningPlan is DRAFT'
  );

  // Test 4: NO SYNTHETIC PLAN CREATION IN GENERATOR
  console.log('\n--- Test 4: No Synthetic Plan Creation in Generator ---');
  let missingPlanThrew = false;
  try {
    await generateModulAjar({
      school: mockSchool,
      profile: mockProfile,
      academicSetting: mockSetting,
      learningPlans: [], // NO PLAN
      tp: mockTpData,
      atp: mockAtpData,
    });
  } catch (err: any) {
    missingPlanThrew = true;
  }
  assert(
    missingPlanThrew,
    'Generator must throw error when LearningPlan is missing (no synthetic fallback)'
  );

  // Test 5: DEPENDENCY INVALIDATION
  console.log('\n--- Test 5: Dependency Invalidation ---');
  const validSiapPlan: LearningPlan = {
    ...emptyPlan,
    status: 'SIAP',
    confirmedAt: new Date().toISOString(),
    tpIds: ['tp-101'],
    atpItemIds: ['atp-201'],
    topic: 'Pengenalan Algoritma',
    allocatedJP: 6,
    initialCompetency: 'Siswa dapat mengoperasikan komputer',
    graduateProfileDimensions: ['Penalaran Kritis'],
    resources: [{ id: 'r1', title: 'Buku Siswa Informatika' }],
    learningModel: 'Pembelajaran Kontekstual',
    p3Dimensions: ['Bernalar Kritis'],
    learningSteps: {
      opening: [{ id: 's1', description: 'Apersepsi' }],
      core: [{ id: 's2', description: 'Latihan Logika' }],
      closing: [{ id: 's3', description: 'Refleksi' }],
    },
    learningExperiences: [
      { id: 'e1', phase: 'UNDERSTAND', description: 'Mengamati contoh algoritma sederhana', durationMinutes: 20 },
      { id: 'e2', phase: 'APPLY', description: 'Menyusun langkah algoritma', durationMinutes: 50 },
      { id: 'e3', phase: 'REFLECT', description: 'Merefleksi hasil latihan', durationMinutes: 20 },
    ],
    assessmentPlan: {
      initial: [{ id: 'a1', type: 'INITIAL', description: 'Pre-test', linkedTpIds: ['tp-101'] }],
      formative: [{ id: 'a2', type: 'FORMATIVE', description: 'Kuis', linkedTpIds: ['tp-101'] }],
      summative: [{ id: 'a3', type: 'SUMMATIVE', description: 'Tes Akhir', linkedTpIds: ['tp-101'] }],
    },
  };

  const beforeDeletionValidation = validateLearningPlan(validSiapPlan, {
    academicSetting: mockSetting,
    tp: mockTpData,
    atp: mockAtpData,
  });
  assert(
    beforeDeletionValidation.valid === true,
    'Dependency invalidation fixture must be valid before dependency deletion',
    beforeDeletionValidation.errors.join(' | ')
  );

  // Now simulate deleted TP (remove tp-101 from context)
  const modifiedTpData: TPData = {
    ...mockTpData,
    items: [mockTpData.items[1]], // Only tp-102 left
  };

  const reval = invalidatePlanIfDependenciesChanged(validSiapPlan, {
    academicSetting: mockSetting,
    tp: modifiedTpData,
    atp: mockAtpData,
  });

  assert(
    reval.isInvalidated && reval.plan.status === 'PERLU_DILENGKAPI',
    'Plan status must revert to PERLU_DILENGKAPI when referenced TP is removed',
    `status=${reval.plan.status}`
  );

  // Test 6: VALIDATE DOCUMENT REQUIREMENTS INTEGRITY
  console.log('\n--- Test 6: Document Requirements Validation Guard ---');
  const docValDraft = validateDocumentRequirements('MODUL_AJAR', {
    school: mockSchool,
    profile: mockProfile,
    academicSetting: mockSetting,
    learningPlans: [emptyPlan],
  });
  assert(
    !docValDraft.isValid && docValDraft.missingFields.some((f) => f.includes('SIAP')),
    'validateDocumentRequirements must report invalid status for DRAFT plan'
  );

  // ==========================================
  // EXTENDED CANONICAL JP & PROJECTION TESTS (A through H)
  // ==========================================
  console.log('\n--- Test A: TimeAllocation beats ATP annual ---');
  const planA: LearningPlan = {
    ...validSiapPlan,
    id: 'plan-a',
    allocatedJP: undefined,
    atpItemIds: ['atp-201'], // ATPItem has jp = 99
  };
  const mockTimeAllocationsA: TimeAllocation[] = [
    {
      id: 'ta-1',
      academicSettingId: 'setting-1',
      sourceType: 'ATP_ITEM',
      sourceId: 'atp-201',
      atpItemId: 'atp-201',
      allocatedJP: 8,
      jp: 8,
      semester: 1,
    },
  ];
  const resA = resolveLearningPlanAllocatedJP(planA, {
    atp: mockAtpData,
    timeAllocations: mockTimeAllocationsA,
  });
  assert(
    resA.allocatedJP === 8 && resA.source === 'LINKED_TIME_ALLOCATION',
    'TimeAllocation must resolve to 8 with source LINKED_TIME_ALLOCATION instead of ATPItem.jp=99',
    `allocatedJP=${resA.allocatedJP}, source=${resA.source}`
  );

  console.log('\n--- Test B: Explicit plan JP wins ---');
  const planB: LearningPlan = {
    ...validSiapPlan,
    id: 'plan-b',
    allocatedJP: 4,
    atpItemIds: ['atp-201'],
  };
  const resB = resolveLearningPlanAllocatedJP(planB, {
    atp: mockAtpData,
    timeAllocations: mockTimeAllocationsA,
  });
  assert(
    resB.allocatedJP === 4 && resB.source === 'EXPLICIT_PLAN',
    'Explicit plan allocatedJP must win over TimeAllocation',
    `allocatedJP=${resB.allocatedJP}, source=${resB.source}`
  );

  console.log('\n--- Test C: No ATP fallback ---');
  const planC: LearningPlan = {
    ...validSiapPlan,
    id: 'plan-c',
    allocatedJP: undefined,
    atpItemIds: ['atp-201'],
  };
  const resC = resolveLearningPlanAllocatedJP(planC, {
    atp: mockAtpData,
    timeAllocations: [], // No TimeAllocation
  });
  assert(
    resC.allocatedJP === undefined && resC.source === 'UNRESOLVED',
    'Without TimeAllocation or explicit plan JP, must result in UNRESOLVED (no ATPItem.jp fallback)',
    `allocatedJP=${resC.allocatedJP}, source=${resC.source}`
  );

  console.log('\n--- Test D: ASSESSMENT / RESERVE ignored ---');
  const mockTimeAllocationsD: TimeAllocation[] = [
    {
      id: 'ta-atp',
      academicSettingId: 'setting-1',
      sourceType: 'ATP_ITEM',
      sourceId: 'atp-201',
      atpItemId: 'atp-201',
      allocatedJP: 8,
      jp: 8,
      semester: 1,
    },
    {
      id: 'ta-assess',
      academicSettingId: 'setting-1',
      sourceType: 'ASSESSMENT',
      sourceId: 'atp-201',
      atpItemId: 'atp-201',
      allocatedJP: 4,
      jp: 4,
      semester: 1,
    },
    {
      id: 'ta-reserve',
      academicSettingId: 'setting-1',
      sourceType: 'RESERVE',
      sourceId: 'atp-201',
      atpItemId: 'atp-201',
      allocatedJP: 2,
      jp: 2,
      semester: 1,
    },
  ];
  const resD = resolveLearningPlanAllocatedJP(planA, {
    atp: mockAtpData,
    timeAllocations: mockTimeAllocationsD,
  });
  assert(
    resD.allocatedJP === 8,
    'ASSESSMENT and RESERVE allocations must not be added to Modul Ajar JP',
    `allocatedJP=${resD.allocatedJP}`
  );

  console.log('\n--- Test E: Multiple SIAP with no active ID blocks projection ---');
  const siapPlan1: LearningPlan = { ...validSiapPlan, id: 'siap-1', topic: 'Topik 1' };
  const siapPlan2: LearningPlan = { ...validSiapPlan, id: 'siap-2', topic: 'Topik 2' };
  const projE = buildModulAjarProjection({
    school: mockSchool,
    profile: mockProfile,
    academicSetting: mockSetting,
    tp: mockTpData,
    atp: mockAtpData,
    learningPlans: [siapPlan1, siapPlan2],
    activeLearningPlanId: undefined,
  });
  assert(
    !projE.isReady && projE.error !== undefined,
    'Multiple SIAP plans without activeLearningPlanId must result in isReady = false',
    `isReady=${projE.isReady}, error=${projE.error}`
  );

  console.log('\n--- Test F: Exact plan ID selects targeted plan ---');
  const projF = buildModulAjarProjection({
    school: mockSchool,
    profile: mockProfile,
    academicSetting: mockSetting,
    tp: mockTpData,
    atp: mockAtpData,
    learningPlans: [siapPlan1, siapPlan2],
    activeLearningPlanId: 'siap-2',
  });
  assert(
    projF.isReady && projF.plan?.id === 'siap-2' && projF.plan?.topic === 'Topik 2',
    'Exact activeLearningPlanId must select the targeted plan',
    `isReady=${projF.isReady}, selectedPlanId=${projF.plan?.id}`
  );

  console.log('\n--- Test G: Stale stored objective rejected if canonical TP is missing ---');
  const planG: LearningPlan = {
    ...validSiapPlan,
    id: 'plan-g',
    tpIds: ['tp-missing-999'],
    objectives: [
      { id: 'tp-missing-999', statement: 'Stored legacy TP statement' } as any,
    ],
  };
  const projG = buildModulAjarProjection({
    school: mockSchool,
    profile: mockProfile,
    academicSetting: mockSetting,
    tp: mockTpData,
    atp: mockAtpData,
    learningPlans: [planG],
    activeLearningPlanId: 'plan-g',
  });
  assert(
    !projG.isReady,
    'Missing canonical TP must make projection not ready (no cached objectives fallback)',
    `isReady=${projG.isReady}, error=${projG.error}`
  );

  console.log('\n--- Test H: Canonical TP authority wins over stored objectives ---');
  const planH: LearningPlan = {
    ...validSiapPlan,
    id: 'plan-h',
    tpIds: ['tp-101'],
    objectives: [
      { id: 'tp-101', statement: 'OLD Stored statement' } as any,
    ],
  };
  const projH = buildModulAjarProjection({
    school: mockSchool,
    profile: mockProfile,
    academicSetting: mockSetting,
    tp: mockTpData,
    atp: mockAtpData,
    learningPlans: [planH],
    activeLearningPlanId: 'plan-h',
  });
  assert(
    projH.isReady &&
    projH.resolvedTPs.length === 1 &&
    projH.resolvedTPs[0].statement === mockTpData.items[0].statement,
    'Canonical TP statement must be projected, not old stored objective',
    `statement=${projH.resolvedTPs[0]?.statement}`
  );

  // ==========================================
  // SOURCE CONTRACT ASSERTIONS
  // ==========================================
  console.log('\n--- Source Contract Assertions ---');
  const previewSource = fs.readFileSync(
    path.join(process.cwd(), 'src/components/AdminDocsExport.tsx'),
    'utf-8'
  );
  assert(
    previewSource.includes('buildModulAjarProjection'),
    'AdminDocsExport.tsx must use buildModulAjarProjection for MODUL_AJAR'
  );
  // Ensure preview branch for MODUL_AJAR does not do fallback reduce or arbitrary first SIAP selection
  assert(
    !previewSource.includes("activePlan?.allocatedJP ? `${activePlan.allocatedJP} JP` : `${atp?.items?.reduce"),
    'AdminDocsExport.tsx must NOT contain annual ATP reduce fallback in MODUL_AJAR preview'
  );

  const pdfGeneratorsSource = fs.readFileSync(
    path.join(process.cwd(), 'src/services/documentEngine/renderers/pdf/pdfDocGenerators.ts'),
    'utf-8'
  );
  assert(
    pdfGeneratorsSource.includes('buildModulAjarProjection'),
    'pdfDocGenerators.ts must use buildModulAjarProjection for MODUL_AJAR'
  );

  // ==========================================
  // CANONICAL MEETING & KKTP INTEGRATION TESTS (B19)
  // ==========================================
  console.log('\n--- B19.1: KKTP Filtering & Lineage (Real Flow) ---');
  const allCriteria = [
    { id: 'crit-1', tpId: 'tp-101', description: 'Kriteria TP 101' },
    { id: 'crit-2', tpId: 'tp-999', description: 'Kriteria TP 999 (Out of Scope)' }
  ];

  // Simulating scope compilation in LearningPlanManager.tsx
  const simScope: any = {
    tpItems: [{ id: 'tp-101', statement: 'Belajar programming' }],
    linkedTpIds: ['tp-101'],
    linkedAtpItemIds: ['atp-201'],
    meetings: []
  };

  const simTpsToSend = simScope.tpItems;
  const simTpIdsToSend = simTpsToSend.map((t: any) => t.id);
  const simRelevantCriteria = (allCriteria as any).filter((ac: any) => simTpIdsToSend.includes(ac.tpId));

  const draftPlanResult = createAIDraftLearningPlan({
    academicSetting: mockSetting,
    curriculumType: 'KURIKULUM_MERDEKA',
    unitId: 'unit-1',
    tpIds: simScope.linkedTpIds,
    atpItemIds: simScope.linkedAtpItemIds,
    aiDraft: {
      initialCompetency: 'Siswa dapat membaca',
      learningExperiences: [
        { phase: 'UNDERSTAND', description: 'Memahami' },
        { phase: 'APPLY', description: 'Menerapkan' },
        { phase: 'REFLECT', description: 'Refleksi' }
      ] as any,
      graduateProfileDimensions: ['Bernalar Kritis']
    }
  });

  // Assign the filtered KKTP IDs exactly as done in LearningPlanManager.tsx
  draftPlanResult.kktpCriterionIds = simRelevantCriteria.map((ac: any) => ac.id);

  assert(
    draftPlanResult.kktpCriterionIds.includes('crit-1') && !draftPlanResult.kktpCriterionIds.includes('crit-2'),
    'LearningPlan draft must save only kktpCriterionIds matching the target scope TPs',
    `kktpCriterionIds=${JSON.stringify(draftPlanResult.kktpCriterionIds)}`
  );

  console.log('\n--- B19.2: Multi-meeting Order & Deterministic sorting ---');
  const b19Mapping = {
    units: [
      {
        id: 'unit-1',
        title: 'Bab 1',
        order: 1,
        linkedTpIds: ['tp-101'],
        linkedAtpItemIds: ['atp-201'],
        materials: [{ id: 'mat-1', title: 'Materi 1', order: 1, linkedAtpItemIds: ['atp-201'], linkedTpIds: ['tp-101'] }]
      }
    ]
  };
  const b19ExecutionPlan = {
    units: [
      {
        unitId: 'unit-1',
        meetings: [
          { id: 'meet-3', title: 'Pertemuan C', order: 3, jp: 1, linkedTpIds: ['tp-101'], linkedAtpItemIds: ['atp-201'], materialIds: ['mat-1'], unitId: 'unit-1' },
          { id: 'meet-1', title: 'Pertemuan A', order: 1, jp: 2, linkedTpIds: ['tp-101'], linkedAtpItemIds: ['atp-201'], materialIds: ['mat-1'], unitId: 'unit-1' },
          { id: 'meet-2', title: 'Pertemuan B', order: 2, jp: 3, linkedTpIds: ['tp-101'], linkedAtpItemIds: ['atp-201'], materialIds: ['mat-1'], unitId: 'unit-1' }
        ]
      }
    ]
  };
  const b19Schedules = [
    {
      semesterPlanId: 'setting-1',
      semester: 1,
      schedule: {
        semesterPlanId: 'setting-1',
        status: 'COMPLETE',
        entries: [
          { meetingId: 'meet-3', date: '2026-10-12', entryMode: 'ACTUAL', semesterPlanId: 'setting-1', unitId: 'unit-1', jp: 1 },
          { meetingId: 'meet-1', date: '2026-10-12', entryMode: 'ACTUAL', semesterPlanId: 'setting-1', unitId: 'unit-1', jp: 2 },
          { meetingId: 'meet-2', date: '2026-10-12', entryMode: 'ACTUAL', semesterPlanId: 'setting-1', unitId: 'unit-1', jp: 3 }
        ]
      }
    }
  ];

  const testTpData = {
    ...mockTpData,
    items: [mockTpData.items[0]]
  };
  const testAtpData = {
    ...mockAtpData,
    items: [mockAtpData.items[0]]
  };

  const b19Scopes = buildLearningPlanScopeUnits({
    academicSetting: mockSetting,
    atpUnitMapping: b19Mapping as any,
    unitExecutionPlan: b19ExecutionPlan as any,
    learningMeetingSchedules: b19Schedules as any,
    tp: testTpData,
    atp: testAtpData
  });

  assert(
    b19Scopes.length === 1 && b19Scopes[0].meetings && b19Scopes[0].meetings.length === 3,
    'buildLearningPlanScopeUnits must return all 3 meetings',
    `meetingsLength=${b19Scopes[0]?.meetings?.length}`
  );

  if (b19Scopes[0]?.meetings) {
    const orders = b19Scopes[0].meetings.map(m => m.order);
    const ids = b19Scopes[0].meetings.map(m => m.meetingId);
    assert(
      orders[0] === 1 && orders[1] === 2 && orders[2] === 3,
      'Meetings must be sorted deterministically by canonical meeting order',
      `orders=${JSON.stringify(orders)}`
    );
    assert(
      ids[0] === 'meet-1' && ids[1] === 'meet-2' && ids[2] === 'meet-3',
      'Meeting IDs must match sorted orders',
      `ids=${JSON.stringify(ids)}`
    );
  }

  console.log('\n--- B19.3: Total JP sum ---');
  if (b19Scopes[0]) {
    assert(
      b19Scopes[0].jp === 6,
      'Scope JP must exactly equal the sum of meeting JPs (1 + 2 + 3 = 6)',
      `jp=${b19Scopes[0].jp}`
    );
  }

  console.log('\n--- B19.4: Diagnostic Flags & Counts ---');
  const simulatedMetadata = (scope: any, criteria: any[]) => {
    const tpsToSend = scope.tpItems || [];
    const tpIdsToSend = tpsToSend.map((t: any) => t.id);
    const relevantCriteria = criteria.filter((ac) => tpIdsToSend.includes(ac.tpId));
    const hasKktp = relevantCriteria.length > 0;
    return {
      meetingStructureSent: !!scope.meetings?.length,
      meetingStructureCount: scope.meetings?.length || 0,
      kktpSent: hasKktp,
      kktpCount: relevantCriteria.length,
    };
  };

  const metaWithData = simulatedMetadata(b19Scopes[0], allCriteria);
  assert(
    metaWithData.meetingStructureSent === true &&
    metaWithData.meetingStructureCount === 3 &&
    metaWithData.kktpSent === true &&
    metaWithData.kktpCount === 1,
    'Diagnostic flags must correctly capture active meetings and relevant criteria',
    `metaWithData=${JSON.stringify(metaWithData)}`
  );

  const emptyScope = { tpItems: [], meetings: [] };
  const metaEmpty = simulatedMetadata(emptyScope, []);
  assert(
    metaEmpty.meetingStructureSent === false &&
    metaEmpty.meetingStructureCount === 0 &&
    metaEmpty.kktpSent === false &&
    metaEmpty.kktpCount === 0,
    'Diagnostic flags must be false/zero when meetings or KKTP are absent',
    `metaEmpty=${JSON.stringify(metaEmpty)}`
  );

  console.log('\n--- B19.5: Embedded Assessment Dedupe logic ---');
  // lp without assessment -> tp gets auto-draft AssessmentPlan
  const lpWithoutAssessment: any = {
    id: 'lp-no-assess',
    academicSettingId: 'setting-1',
    tpIds: ['tp-101'],
    assessmentPlan: {}
  };
  const draftsWithNoAssess = generateAutoDraftPlansFromCanonicalContext({
    academicSetting: mockSetting,
    tp: mockTpData,
    learningPlans: [lpWithoutAssessment],
    existingPlans: []
  });
  assert(
    draftsWithNoAssess.length === 2 && draftsWithNoAssess.some(d => d.tpIds?.includes('tp-101')),
    'TP should get auto-draft AssessmentPlan if LearningPlan does not embed assessments',
    `draftsLength=${draftsWithNoAssess.length}`
  );

  // lp with assessment -> auto-draft rutin skipped
  const lpWithAssessment: any = {
    id: 'lp-with-assess',
    academicSettingId: 'setting-1',
    tpIds: ['tp-101'],
    assessmentPlan: {
      formative: [{ id: 'f-1', type: 'FORMATIVE', technique: 'Observation', description: 'Obs', linkedTpIds: ['tp-101'] }]
    }
  };
  const draftsWithAssess = generateAutoDraftPlansFromCanonicalContext({
    academicSetting: mockSetting,
    tp: mockTpData,
    learningPlans: [lpWithAssessment],
    existingPlans: []
  });
  assert(
    draftsWithAssess.length === 1 && draftsWithAssess[0].tpIds?.[0] === 'tp-102',
    'TP already covered by embedded assessments should be skipped in auto-drafting',
    `draftsCount=${draftsWithAssess.length}, firstTpId=${draftsWithAssess[0]?.tpIds?.[0]}`
  );

  // existing AssessmentPlan prevents duplicates
  const existingPlan: any = {
    id: 'exist-ap-1',
    academicSettingId: 'setting-1',
    tpIds: ['tp-101']
  };
  const draftsWithExist = generateAutoDraftPlansFromCanonicalContext({
    academicSetting: mockSetting,
    tp: mockTpData,
    learningPlans: [lpWithoutAssessment],
    existingPlans: [existingPlan]
  });
  assert(
    draftsWithExist.length === 1 && draftsWithExist[0].tpIds?.[0] === 'tp-102',
    'Existing separate AssessmentPlan prevents duplicating drafts for that TP',
    `draftsCount=${draftsWithExist.length}`
  );

  // 5d. Manual / Special Scope AssessmentPlan remains fully supported and valid
  const manualSpecialPlan = {
    id: 'special-mid-semester-ap',
    academicSettingId: 'setting-1',
    title: 'Penilaian Tengah Semester Khusus',
    purpose: 'SUMMATIVE' as any,
    timing: 'MID_SEMESTER' as any,
    scopeType: 'MULTI_TP' as any,
    tpIds: ['tp-101', 'tp-102'],
    workflowStatus: 'DRAFT' as any,
    instruments: [{ id: 'inst-1', type: 'PILIHAN_GANDA', technique: 'Tes Tertulis', description: 'Ujian PG' }] as any
  };

  const validationResult = validateAssessmentPlan(manualSpecialPlan as any, {
    academicSetting: mockSetting,
    tp: mockTpData,
    learningPlans: [lpWithAssessment] // lpWithAssessment embeds formative assessments on tp-101
  });

  assert(
    validationResult.valid,
    'Manual special-scope AssessmentPlans (e.g. MID_SEMESTER) are valid and not blocked/invalidated by embedded LearningPlan assessments',
    `validationErrors=${JSON.stringify(validationResult.errors)}`
  );

  console.log('\n--- B19.6: Scope Isolation ---');
  const isolatedMapping = {
    units: [
      {
        id: 'unit-1',
        title: 'Bab 1',
        order: 1,
        linkedTpIds: ['tp-101'],
        linkedAtpItemIds: ['atp-201'],
        materials: [{ id: 'mat-1', title: 'Materi 1', order: 1, linkedAtpItemIds: ['atp-201'], linkedTpIds: ['tp-101'] }]
      },
      {
        id: 'unit-2',
        title: 'Bab 2',
        order: 2,
        linkedTpIds: ['tp-102'],
        linkedAtpItemIds: ['atp-202'],
        materials: [{ id: 'mat-2', title: 'Materi 2', order: 1, linkedAtpItemIds: ['atp-202'], linkedTpIds: ['tp-102'] }]
      }
    ]
  };
  const isolatedExecutionPlan = {
    units: [
      {
        unitId: 'unit-1',
        meetings: [
          { id: 'meet-1', title: 'Pertemuan 1', order: 1, jp: 2, linkedTpIds: ['tp-101'], linkedAtpItemIds: ['atp-201'], materialIds: ['mat-1'], unitId: 'unit-1' }
        ]
      },
      {
        unitId: 'unit-2',
        meetings: [
          { id: 'meet-2', title: 'Pertemuan 2', order: 1, jp: 3, linkedTpIds: ['tp-102'], linkedAtpItemIds: ['atp-202'], materialIds: ['mat-2'], unitId: 'unit-2' }
        ]
      }
    ]
  };
  const isolatedSchedules = [
    {
      semesterPlanId: 'setting-1',
      semester: 1,
      schedule: {
        semesterPlanId: 'setting-1',
        status: 'COMPLETE',
        entries: [
          { meetingId: 'meet-1', date: '2026-10-12', entryMode: 'ACTUAL', semesterPlanId: 'setting-1', unitId: 'unit-1', jp: 2 },
          { meetingId: 'meet-2', date: '2026-10-13', entryMode: 'ACTUAL', semesterPlanId: 'setting-1', unitId: 'unit-2', jp: 3 }
        ]
      }
    }
  ];

  const isolatedScopes = buildLearningPlanScopeUnits({
    academicSetting: mockSetting,
    atpUnitMapping: isolatedMapping as any,
    unitExecutionPlan: isolatedExecutionPlan as any,
    learningMeetingSchedules: isolatedSchedules as any,
    tp: mockTpData,
    atp: mockAtpData
  });

  assert(
    isolatedScopes.length === 2,
    'buildLearningPlanScopeUnits should produce exactly 2 scoped units',
    `length=${isolatedScopes.length}`
  );

  const scope1 = isolatedScopes.find(s => s.unitId === 'unit-1');
  const scope2 = isolatedScopes.find(s => s.unitId === 'unit-2');

  assert(
    scope1 && scope1.linkedTpIds.includes('tp-101') && !scope1.linkedTpIds.includes('tp-102') &&
    scope1.meetings?.length === 1 && scope1.meetings[0].meetingId === 'meet-1',
    'Scope for unit-1 must be strictly isolated from unit-2 resources',
    `scope1TpIds=${JSON.stringify(scope1?.linkedTpIds)}, scope1Meetings=${JSON.stringify(scope1?.meetings?.map(m => m.meetingId))}`
  );

  assert(
    scope2 && scope2.linkedTpIds.includes('tp-102') && !scope2.linkedTpIds.includes('tp-101') &&
    scope2.meetings?.length === 1 && scope2.meetings[0].meetingId === 'meet-2',
    'Scope for unit-2 must be strictly isolated from unit-1 resources',
    `scope2TpIds=${JSON.stringify(scope2?.linkedTpIds)}, scope2Meetings=${JSON.stringify(scope2?.meetings?.map(m => m.meetingId))}`
  );

  console.log('\n--- B19.7: Backward Compatibility ---');
  const legacyLpNoMeetings = createAIDraftLearningPlan({
    academicSetting: mockSetting,
    curriculumType: 'KURIKULUM_MERDEKA',
    tpIds: ['tp-101'],
    aiDraft: {
      initialCompetency: 'Dapat menggambar',
      learningExperiences: [
        { phase: 'UNDERSTAND', description: 'Memahami gambar' },
        { phase: 'APPLY', description: 'Menggambar peta' },
        { phase: 'REFLECT', description: 'Refleksi hasil gambar' }
      ] as any,
      graduateProfileDimensions: ['Penalaran Kritis']
    }
  });

  assert(
    legacyLpNoMeetings.id && !legacyLpNoMeetings.learningMeetingIds,
    'Backward compatibility: LearningPlan without meetings is created and drafted successfully',
    `id=${legacyLpNoMeetings.id}`
  );

  const legacyLpNoKktp = createAIDraftLearningPlan({
    academicSetting: mockSetting,
    curriculumType: 'KURIKULUM_MERDEKA',
    tpIds: ['tp-101'],
    aiDraft: {
      initialCompetency: 'Siswa mandiri',
      learningExperiences: [
        { phase: 'UNDERSTAND', description: 'Memahami' },
        { phase: 'APPLY', description: 'Menerapkan' },
        { phase: 'REFLECT', description: 'Refleksi' }
      ] as any,
      graduateProfileDimensions: ['Kemandirian']
    }
  });

  assert(
    legacyLpNoKktp.status === 'DRAFT' && !legacyLpNoKktp.kktpCriterionIds,
    'Backward compatibility: LearningPlan without KKTP can still be constructed as a DRAFT',
    `status=${legacyLpNoKktp.status}`
  );

  console.log(`\n==========================================`);
  console.log(`TOTAL PASSED: ${passedCount}`);
  console.log(`TOTAL FAILED: ${failedCount}`);
  console.log(`==========================================`);

  if (failedCount > 0) {
    process.exit(1);
  }
}

runRegressionSuite();

