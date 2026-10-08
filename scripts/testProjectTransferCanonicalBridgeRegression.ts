import { performImportProjectTransferInState } from '../src/services/projectTransferImportService';
import { validateProjectTransfer } from '../src/services/projectTransferService';
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
  assert(res.tp.status === 'DRAFT', `TP status harus DRAFT (got ${res.tp.status})`);

  assert(res.atp.items[0].linkedTpIds?.length === 1, 'ATP item 0 linkedTpIds harus berisikan ID TP');
  assert(res.atp.items[0].linkedTpIds?.[0] === res.tp.items[0].id, 'linkedTpIds[0] harus merujuk ke TPItem.id internal');
  assert(res.atp.workflowStatus === 'DRAFT', `ATP workflowStatus harus DRAFT (got ${res.atp.workflowStatus})`);
  assert(res.atp.status === 'DRAFT', `ATP status harus DRAFT (got ${res.atp.status})`);
  assert(res.atp.items[0].focus === undefined, 'Focus ATP item 0 harus undefined');

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

  const validation = validateProjectTransfer(pkg);
  assert(!validation.isValid, 'Validation harus gagal bila competence/materialScope kosong pada Merdeka');
  assert(validation.errors.some((e) => e.code === 'EMPTY_TP_COMPETENCE'), 'Harus ada error EMPTY_TP_COMPETENCE');
  assert(validation.errors.some((e) => e.code === 'EMPTY_TP_MATERIAL_SCOPE'), 'Harus ada error EMPTY_TP_MATERIAL_SCOPE');

  let importThrew = false;
  try {
    performImportProjectTransferInState(state, {
      pkg,
      profileId: 'prof-001',
      schoolId: 'sch-001',
    });
  } catch (err: any) {
    importThrew = true;
    assert(err.message.includes('ProjectTransferPackage tidak valid'), 'Pesan error import harus menunjukkan package tidak valid');
  }
  assert(importThrew, 'Import harus ditolak jika competence atau materialScope kosong pada Merdeka');
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

  const validation = validateProjectTransfer(pkg);
  assert(!validation.isValid, 'Validation harus gagal untuk kode TP non-canonical pada Merdeka');
  assert(validation.errors.some((e) => e.code === 'INVALID_MERDEKA_TP_CODE'), 'Harus ada error INVALID_MERDEKA_TP_CODE');

  let importThrew = false;
  try {
    performImportProjectTransferInState(state, {
      pkg,
      profileId: 'prof-001',
      schoolId: 'sch-001',
    });
  } catch (err: any) {
    importThrew = true;
    assert(err.message.includes('ProjectTransferPackage tidak valid'), 'Pesan error import harus menunjukkan package tidak valid');
  }
  assert(importThrew, 'Import harus ditolak untuk kode TP non-canonical pada Merdeka');
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
// SCENARIO F: TP valid secara isi tapi cpCode kosong
// ==========================================
console.log('Testing Scenario F: TP valid secara isi tapi cpCode kosong...');
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
        cpCode: '', // cpCode kosong!
        statement: 'Membaca bilangan cacah sampai 10.000.',
        competence: 'Membaca',
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

  const validation = validateProjectTransfer(pkg);
  assert(!validation.isValid, 'Validation harus gagal bila cpCode kosong pada Merdeka');
  assert(validation.errors.some((e) => e.code === 'EMPTY_TP_CP_REF'), 'Harus ada error EMPTY_TP_CP_REF');

  let importThrew = false;
  try {
    performImportProjectTransferInState(state, {
      pkg,
      profileId: 'prof-001',
      schoolId: 'sch-001',
    });
  } catch (err: any) {
    importThrew = true;
    assert(err.message.includes('ProjectTransferPackage tidak valid'), 'Pesan error import harus menunjukkan package tidak valid');
  }
  assert(importThrew, 'Import harus ditolak bila cpCode kosong pada Merdeka');
}

// ==========================================
// SCENARIO G: CP element kosong & TP merujuk cpCode E1
// ==========================================
console.log('Testing Scenario G: CP element kosong & TP merujuk cpCode E1...');
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
        element: '', // element CP kosong!
        content: 'Konten CP valid',
      },
    ],
    tp: [
      {
        code: 'E1-BLG-01',
        cpCode: 'E1',
        statement: 'Membaca bilangan cacah.',
        competence: 'Membaca',
        materialScope: 'Bilangan cacah',
      },
    ],
    atp: [
      {
        order: 1,
        tpCode: 'E1-BLG-01',
      },
    ],
  };

  const validation = validateProjectTransfer(pkg);
  assert(!validation.isValid, 'Validation harus gagal bila CP element kosong pada Merdeka');
  assert(validation.errors.some((e) => e.code === 'EMPTY_CP_ELEMENT'), 'Harus ada error EMPTY_CP_ELEMENT');

  let importThrew = false;
  try {
    performImportProjectTransferInState(state, {
      pkg,
      profileId: 'prof-001',
      schoolId: 'sch-001',
    });
  } catch (err: any) {
    importThrew = true;
    assert(err.message.includes('ProjectTransferPackage tidak valid'), 'Pesan error import harus menunjukkan package tidak valid');
  }
  assert(importThrew, 'Import harus ditolak bila CP element kosong pada Merdeka');
}

// ==========================================
// SCENARIO H: K13 Field Isolation
// ==========================================
console.log('Testing Scenario H: K13 Field Isolation...');
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

  assert(res.cpAnalysis === undefined, 'K13 cpAnalysis harus undefined');
  assert(res.yearPlan.subjectCode === undefined, 'K13 yearPlan.subjectCode harus undefined');
  assert(res.tp.cpId === undefined, 'K13 tp.cpId harus undefined');
  assert(res.tp.subjectCode === undefined, 'K13 tp.subjectCode harus undefined');
  assert(res.tp.basedOnCpUpdatedAt === undefined, 'K13 tp.basedOnCpUpdatedAt harus undefined');
  assert(res.atp.items[0].linkedTpIds === undefined, 'K13 atp.items[0].linkedTpIds harus undefined');
  assert(res.atp.subjectCode === undefined, 'K13 atp.subjectCode harus undefined');
  assert(res.atp.basedOnTpUpdatedAt === undefined, 'K13 atp.basedOnTpUpdatedAt harus undefined');
}

// ==========================================
// SCENARIO I: K13 Permissive Contract (Non-Canonical TP, missing element/competence are warnings only)
// ==========================================
console.log('Testing Scenario I: K13 Permissive Contract...');
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
        element: '', // Empty element allowed as warning in K13
        content: 'Memahami sifat-sifat operasi hitung.',
      },
    ],
    tp: [
      {
        code: 'TP-01', // Non-canonical code allowed in K13
        statement: 'Menjelaskan sifat komutatif.',
        competence: '', // Empty competence allowed as warning in K13
        materialScope: '', // Empty materialScope allowed as warning in K13
      },
    ],
    atp: [
      {
        order: 1,
        tpCode: 'TP-01',
      },
    ],
  };

  const validation = validateProjectTransfer(pkg);
  assert(validation.isValid, 'Validation harus valid untuk K13 meskipun element/competence/materialScope kosong atau TP code non-canonical');
  assert(validation.errors.length === 0, 'K13 tidak boleh menghasilkan ERROR untuk kelonggaran tersebut');
  assert(validation.warnings.length > 0, 'K13 harus menghasilkan WARNING untuk kelonggaran tersebut');

  const res = performImportProjectTransferInState(state, {
    pkg,
    profileId: 'prof-001',
    schoolId: 'sch-001',
  });
  assert(res.tp.items[0].code === 'TP-01', 'K13 import harus mempertahankan kode TP asli');
}

console.log('--- ALL REGRESSION TESTS PASSED SUCCESSFULLY ---');
