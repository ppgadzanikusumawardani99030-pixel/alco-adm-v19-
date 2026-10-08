import { performImportProjectTransferInState } from '../src/services/projectTransferImportService';
import { createInitialStorageV5 } from '../src/services/storageV5';
import { ProjectTransferPackage } from '../src/types/projectTransfer';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${msg}`);
  }
}

console.log('--- STARTING REGRESSION TESTS FOR PROJECT TRANSFER CANONICAL BRIDGE ---');

// Setup mock V5 state
function createTestState() {
  const state = createInitialStorageV5();
  state.profiles.push({
    id: 'prof-001',
    name: 'Budi Santoso',
    nip: '19850101',
    status: 'PNS',
    defaultSubject: 'Matematika',
    defaultLevel: 'SD',
    schoolId: 'sch-001',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  state.schools.push({
    id: 'sch-001',
    name: 'SD Negeri 1 Merdeka',
    npsn: '12345678',
    address: 'Jl. Pendidikan No. 1',
    village: 'Merdeka',
    district: 'Kota',
    regency: 'Kota',
    province: 'Provinsi',
    principalName: 'Dr. Sutrisno',
    principalNip: '19700101',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return state;
}

// ==========================================
// SCENARIO A: Valid Merdeka v1
// ==========================================
console.log('Testing Scenario A: Valid Merdeka v1...');
{
  const state = createTestState();
  const pkg: ProjectTransferPackage = {
    schemaVersion: '1.0',
    academicYear: '2026/2027',
    curriculumType: 'KURIKULUM_MERDEKA',
    level: 'SD',
    grade: 'Kelas 4',
    phase: 'B',
    subject: 'Matematika',
    cp: [
      {
        code: 'E1',
        element: 'Bilangan',
        content: 'Pada akhir Fase B, peserta didik menunjukkan pemahaman dan intuisi bilangan pada bilangan cacah sampai 10.000.',
      },
    ],
    tp: [
      {
        code: 'E1-BLG-01',
        cpCode: 'E1',
        statement: 'Membaca dan menuliskan bilangan cacah sampai 10.000.',
        competence: 'Membaca dan menuliskan',
        materialScope: 'Bilangan cacah sampai 10.000',
      },
      {
        code: 'E1-BLG-02',
        cpCode: 'E1',
        statement: 'Membandingkan dan mengurutkan bilangan cacah sampai 10.000.',
        competence: 'Membandingkan dan mengurutkan',
        materialScope: 'Bilangan cacah sampai 10.000',
      },
    ],
    atp: [
      {
        order: 1,
        tpCode: 'E1-BLG-01',
        material: 'Bilangan cacah sampai 10.000',
        jp: 4,
        semester: 1,
      },
      {
        order: 2,
        tpCode: 'E1-BLG-02',
        material: 'Bilangan cacah sampai 10.000',
        jp: 4,
        semester: 1,
      },
    ],
  };

  const res = performImportProjectTransferInState(state, {
    pkg,
    profileId: 'prof-001',
    schoolId: 'sch-001',
  });

  assert(!!res.cpAnalysis, 'CPAnalysis harus dibuat untuk Merdeka');
  assert(res.cpAnalysis?.items.length === 2, 'CPAnalysis items count harus 2');
  assert(res.cpAnalysis?.workflowStatus === 'SIAP', `CPAnalysis workflowStatus harus SIAP (got ${res.cpAnalysis?.workflowStatus})`);
  assert(res.cpAnalysis?.status === 'DRAFT', `CPAnalysis status harus DRAFT (got ${res.cpAnalysis?.status})`);
  assert(res.cpAnalysis?.items[0].elementName === 'Bilangan', 'elementName CP Analysis harus dari data asli ProjectTransferCP');
  assert(res.cpAnalysis?.items[0].cpText.includes('bilangan cacah'), 'cpText CP Analysis harus dari data asli ProjectTransferCP');

  assert(res.tp.items.length === 2, 'TP items count harus 2');
  assert(res.tp.items[0].cpAnalysisItemIds?.length === 1, 'TP item 0 harus memuat tepat 1 cpAnalysisItemId');
  assert(res.tp.items[0].cpAnalysisId === res.cpAnalysis?.items[0].id, 'TP item 0 cpAnalysisId harus merujuk ke item CPAnalysis 0');
  assert(res.tp.workflowStatus === 'SIAP', `TP workflowStatus harus SIAP (got ${res.tp.workflowStatus})`);
  assert(res.tp.status === 'SIAP', `TP status harus SIAP (got ${res.tp.status})`);

  // Check state graph save
  const storedCpAnalysis = state.annualData.cpAnalysis.find((e) => e.yearPlanId === res.yearPlan.id);
  assert(!!storedCpAnalysis, 'CPAnalysis harus tersimpan di state.annualData.cpAnalysis');
}

// ==========================================
// SCENARIO B: Missing competence / materialScope
// ==========================================
console.log('Testing Scenario B: Missing competence / materialScope...');
{
  const state = createTestState();
  const pkg: ProjectTransferPackage = {
    schemaVersion: '1.0',
    academicYear: '2026/2027',
    curriculumType: 'KURIKULUM_MERDEKA',
    level: 'SD',
    grade: 'Kelas 4',
    phase: 'B',
    subject: 'Matematika',
    cp: [
      {
        code: 'E1',
        element: 'Bilangan',
        content: 'Deskripsi elemen bilangan.',
      },
    ],
    tp: [
      {
        code: 'E1-BLG-01',
        cpCode: 'E1',
        statement: 'Membaca bilangan cacah sampai 10.000.',
        competence: '', // Kosong!
        materialScope: '', // Kosong!
      },
    ],
    atp: [
      {
        order: 1,
        tpCode: 'E1-BLG-01',
      },
    ],
  };

  const res = performImportProjectTransferInState(state, {
    pkg,
    profileId: 'prof-001',
    schoolId: 'sch-001',
  });

  assert(!!res.cpAnalysis, 'CPAnalysis harus tetap dibuat');
  assert(res.cpAnalysis?.items[0].cpCompetence === '', 'cpCompetence harus kosong tanpa fake data');
  assert(res.cpAnalysis?.items[0].materialScope === '', 'materialScope harus kosong tanpa fake data');
  assert(res.cpAnalysis?.workflowStatus !== 'SIAP', 'CPAnalysis tidak boleh SIAP bila competence/materialScope kosong');
  assert(res.tp.workflowStatus !== 'SIAP', 'TP tidak boleh SIAP bila competence/materialScope kosong');
}

// ==========================================
// SCENARIO C: Invalid legacy TP code
// ==========================================
console.log('Testing Scenario C: Invalid legacy TP code...');
{
  const state = createTestState();
  const pkg: ProjectTransferPackage = {
    schemaVersion: '1.0',
    academicYear: '2026/2027',
    curriculumType: 'KURIKULUM_MERDEKA',
    level: 'SD',
    grade: 'Kelas 4',
    phase: 'B',
    subject: 'Matematika',
    cp: [
      {
        code: 'E1',
        element: 'Bilangan',
        content: 'Deskripsi elemen bilangan.',
      },
    ],
    tp: [
      {
        code: 'TP-01', // Kode legacy invalid (bukan E1-BLG-01)
        cpCode: 'E1',
        statement: 'Membaca bilangan cacah.',
        competence: 'Membaca',
        materialScope: 'Bilangan cacah',
      },
    ],
    atp: [
      {
        order: 1,
        tpCode: 'TP-01',
      },
    ],
  };

  const res = performImportProjectTransferInState(state, {
    pkg,
    profileId: 'prof-001',
    schoolId: 'sch-001',
  });

  assert(res.tp.items[0].code === 'TP-01', 'Kode TP legacy tidak boleh di-rewrite secara diam-diam');
  assert(res.tp.workflowStatus !== 'SIAP', 'TP dengan kode legacy invalid tidak boleh SIAP');
}

// ==========================================
// SCENARIO D: ATP import
// ==========================================
console.log('Testing Scenario D: ATP import...');
{
  const state = createTestState();
  const pkg: ProjectTransferPackage = {
    schemaVersion: '1.0',
    academicYear: '2026/2027',
    curriculumType: 'KURIKULUM_MERDEKA',
    level: 'SD',
    grade: 'Kelas 4',
    phase: 'B',
    subject: 'Matematika',
    cp: [
      {
        code: 'E1',
        element: 'Bilangan',
        content: 'Deskripsi elemen.',
      },
    ],
    tp: [
      {
        code: 'E1-BLG-01',
        cpCode: 'E1',
        statement: 'Membaca bilangan.',
        competence: 'Membaca',
        materialScope: 'Bilangan',
      },
    ],
    atp: [
      {
        order: 1,
        tpCode: 'E1-BLG-01',
        unit: 'Unit 1',
        material: 'Bilangan',
      },
    ],
  };

  const res = performImportProjectTransferInState(state, {
    pkg,
    profileId: 'prof-001',
    schoolId: 'sch-001',
  });

  const atpItem = res.atp.items[0];
  assert(atpItem.linkedTpIds?.length === 1, 'linkedTpIds harus berisi 1 ID');
  assert(atpItem.linkedTpIds?.[0] === res.tp.items[0].id, 'linkedTpIds harus merujuk ke TPItem.id internal');
  assert(atpItem.focus === undefined, 'focus ATP import tidak boleh dibuat secara sintetis');
  assert(res.atp.workflowStatus === 'DRAFT', 'ATP workflowStatus harus DRAFT');
}

// ==========================================
// SCENARIO E: K13
// ==========================================
console.log('Testing Scenario E: K13 curriculum...');
{
  const state = createTestState();
  const pkg: ProjectTransferPackage = {
    schemaVersion: '1.0',
    academicYear: '2026/2027',
    curriculumType: 'K13',
    level: 'SD',
    grade: 'Kelas 4',
    phase: 'B',
    subject: 'Matematika',
    cp: [
      {
        code: 'KD3.1',
        element: 'Pengetahuan',
        content: 'Memahami sifat-sifat operasi hitung.',
      },
    ],
    tp: [
      {
        code: 'KD3.1-01',
        cpCode: 'KD3.1',
        statement: 'Menjelaskan sifat komutatif.',
        competence: 'Menjelaskan',
        materialScope: 'Sifat komutatif',
      },
    ],
    atp: [
      {
        order: 1,
        tpCode: 'KD3.1-01',
      },
    ],
  };

  const res = performImportProjectTransferInState(state, {
    pkg,
    profileId: 'prof-001',
    schoolId: 'sch-001',
  });

  assert(res.cpAnalysis === undefined, 'K13 tidak boleh membuat synthetic CPAnalysis Merdeka');
  const storedCpAnalysis = state.annualData.cpAnalysis.filter((e) => e.yearPlanId === res.yearPlan.id);
  assert(storedCpAnalysis.length === 0, 'K13 tidak boleh menyimpan CPAnalysis di annualData');
}

// ==========================================
// SCENARIO F: TP belum SIAP -> ATP TIDAK BOLEH SIAP
// ==========================================
console.log('Testing Scenario F: TP belum SIAP -> ATP TIDAK BOLEH SIAP...');
{
  const state = createTestState();
  const pkg: ProjectTransferPackage = {
    schemaVersion: '1.0',
    academicYear: '2026/2027',
    curriculumType: 'KURIKULUM_MERDEKA',
    level: 'SD',
    grade: 'Kelas 4',
    phase: 'B',
    subject: 'Matematika',
    cp: [
      {
        code: 'E1',
        element: 'Bilangan',
        content: 'Deskripsi elemen bilangan.',
      },
    ],
    tp: [
      {
        code: 'E1-BLG-01',
        cpCode: 'E1',
        statement: 'Membaca bilangan.',
        competence: '',
        materialScope: 'Bilangan',
      },
    ],
    atp: [
      {
        order: 1,
        tpCode: 'E1-BLG-01',
      },
    ],
  };

  const res = performImportProjectTransferInState(state, {
    pkg,
    profileId: 'prof-001',
    schoolId: 'sch-001',
  });

  assert(res.tp.workflowStatus !== 'SIAP', 'TP harus tidak SIAP');
  assert(res.atp.workflowStatus !== 'SIAP', 'ATP tidak boleh SIAP bila TP belum SIAP');
}

// ==========================================
// SCENARIO G: focus ATP kosong -> ATP TIDAK BOLEH SIAP
// ==========================================
console.log('Testing Scenario G: Focus ATP kosong -> ATP TIDAK BOLEH SIAP...');
{
  const state = createTestState();
  const pkg: ProjectTransferPackage = {
    schemaVersion: '1.0',
    academicYear: '2026/2027',
    curriculumType: 'KURIKULUM_MERDEKA',
    level: 'SD',
    grade: 'Kelas 4',
    phase: 'B',
    subject: 'Matematika',
    cp: [
      {
        code: 'E1',
        element: 'Bilangan',
        content: 'Deskripsi elemen bilangan.',
      },
    ],
    tp: [
      {
        code: 'E1-BLG-01',
        cpCode: 'E1',
        statement: 'Membaca dan menuliskan bilangan cacah sampai 10.000.',
        competence: 'Membaca dan menuliskan',
        materialScope: 'Bilangan cacah sampai 10.000',
      },
    ],
    atp: [
      {
        order: 1,
        tpCode: 'E1-BLG-01',
      },
    ],
  };

  const res = performImportProjectTransferInState(state, {
    pkg,
    profileId: 'prof-001',
    schoolId: 'sch-001',
  });

  assert(res.tp.workflowStatus === 'SIAP', 'TP harus SIAP');
  assert(res.atp.items[0].focus === undefined, 'Focus tidak boleh dibuat secara sintetis');
  assert(res.atp.workflowStatus !== 'SIAP', 'ATP tidak boleh SIAP bila focus kosong');
}

// ==========================================
// SCENARIO H: Missing TP coverage -> ATP TIDAK BOLEH SIAP
// ==========================================
console.log('Testing Scenario H: Missing TP coverage -> ATP TIDAK BOLEH SIAP...');
{
  const state = createTestState();
  const pkg: ProjectTransferPackage = {
    schemaVersion: '1.0',
    academicYear: '2026/2027',
    curriculumType: 'KURIKULUM_MERDEKA',
    level: 'SD',
    grade: 'Kelas 4',
    phase: 'B',
    subject: 'Matematika',
    cp: [
      {
        code: 'E1',
        element: 'Bilangan',
        content: 'Deskripsi elemen bilangan.',
      },
    ],
    tp: [
      {
        code: 'E1-BLG-01',
        cpCode: 'E1',
        statement: 'Membaca dan menuliskan bilangan cacah sampai 10.000.',
        competence: 'Membaca dan menuliskan',
        materialScope: 'Bilangan cacah sampai 10.000',
      },
      {
        code: 'E1-BLG-02',
        cpCode: 'E1',
        statement: 'Membandingkan dan mengurutkan bilangan cacah sampai 10.000.',
        competence: 'Membandingkan dan mengurutkan',
        materialScope: 'Bilangan cacah sampai 10.000',
      },
    ],
    atp: [
      {
        order: 1,
        tpCode: 'E1-BLG-01',
      },
    ],
  };

  const res = performImportProjectTransferInState(state, {
    pkg,
    profileId: 'prof-001',
    schoolId: 'sch-001',
  });

  assert(res.tp.workflowStatus === 'SIAP', 'TP harus SIAP');
  assert(
    res.atp.workflowStatus !== 'SIAP',
    'ATP tidak boleh SIAP bila ada TP yang belum ter-cover'
  );
}

console.log('--- ALL REGRESSION TESTS PASSED SUCCESSFULLY ---');
