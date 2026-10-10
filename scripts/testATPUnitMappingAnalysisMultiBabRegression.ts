import assert from 'node:assert';
import { fallbackAnalyzeMapping, sanitizeMappingAnalysisResult } from '../server/mappingAnalysis';
import { TPData, ATPData, ATPUnitMappingData } from '../src/types';

console.log('=== RUNNING TESTS: Multi-Bab ATP Mapping Analysis & Deadlock Prevention ===');

// Setup mock data
const mockTPData: TPData = {
  id: 'tp-data-001',
  academicSettingId: 'acad-001',
  academicYear: '2025/2026',
  subjectCode: 'Matematika',
  phase: 'B',
  workflowStatus: 'SIAP',
  needsReview: false,
  items: [
    { id: 'TP1', code: 'E1-01', statement: 'Memahami bilangan cacah sampai 1000', competence: 'Memahami', contentScope: 'Bilangan' },
    { id: 'TP2', code: 'E1-02', statement: 'Melakukan operasi hitung bilangan', competence: 'Menghitung', contentScope: 'Operasi Bilangan' },
    { id: 'TP3', code: 'E1-03', statement: 'Memahami pecahan sederhana', competence: 'Memahami', contentScope: 'Pecahan' },
  ],
  updatedAt: '2026-01-01T00:00:00Z',
};

const mockATPData: ATPData = {
  id: 'atp-001',
  academicSettingId: 'acad-001',
  tpId: 'tp-data-001',
  academicYear: '2025/2026',
  subjectCode: 'Matematika',
  phase: 'B',
  workflowStatus: 'SIAP',
  needsReview: false,
  basedOnTpUpdatedAt: '2026-01-01T00:00:00Z',
  items: [
    {
      id: 'atp-1',
      stepNumber: 1,
      linkedTpIds: ['TP1', 'TP2', 'TP3'],
      focus: 'Operasi hitung dan pecahan',
      jp: 8,
      semester: 'GANJIL',
    },
  ],
  updatedAt: '2026-01-01T00:00:00Z',
};

// ==========================================
// CASE A: ATP completely unmapped, Bab 1 relevant
// ==========================================
console.log('Testing Case A: Unmapped ATP -> ASSIGN_ATP_TO_UNIT...');
{
  const mapping: ATPUnitMappingData = {
    id: 'map-01',
    academicSettingId: 'acad-001',
    atpId: 'atp-001',
    tpDataId: 'tp-data-001',
    units: [
      {
        id: 'unit-1',
        title: 'Bab 1: Operasi Bilangan dan Pecahan',
        order: 1,
        linkedAtpItemIds: [],
        linkedTpIds: [],
        materials: [{ id: 'm-1', title: 'Operasi Bilangan Cacah', order: 1, linkedAtpItemIds: [], linkedTpIds: [] }],
      },
    ],
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const analysis = fallbackAnalyzeMapping({
    tpData: mockTPData,
    atpData: mockATPData,
    currentMapping: mapping,
  });

  assert.strictEqual(analysis.summary.unmappedAtp, 1, 'ATP should be unmapped');
  const finding = analysis.atpFindings.find((f) => f.atpItemId === 'atp-1');
  assert.ok(finding, 'Finding for atp-1 must exist');
  assert.strictEqual(finding?.status, 'UNMAPPED');
  assert.ok(finding?.action, 'Action must be present');
  assert.strictEqual(finding.action?.type, 'ASSIGN_ATP_TO_UNIT');
  assert.strictEqual(finding.action?.targetUnitId, 'unit-1');
  assert.ok(Array.isArray(finding.action?.linkedTpIds) && finding.action.linkedTpIds.length > 0, 'linkedTpIds must be present');
  console.log('✅ Case A passed');
}

// ==========================================
// CASE B & C: Reproduction of Z=0 deadlock & Subset TP per Bab
// ==========================================
console.log('Testing Case B & C: Z=0 deadlock prevention & multi-Bab subset TP...');
{
  const mapping: ATPUnitMappingData = {
    id: 'map-02',
    academicSettingId: 'acad-001',
    atpId: 'atp-001',
    tpDataId: 'tp-data-001',
    units: [
      {
        id: 'unit-1',
        title: 'Bab 1: Bilangan',
        order: 1,
        linkedAtpItemIds: ['atp-1'],
        linkedTpIds: ['TP1', 'TP2'],
        materials: [{ id: 'm-1', title: 'Bilangan Cacah', order: 1, linkedAtpItemIds: ['atp-1'], linkedTpIds: ['TP1'] }],
      },
      {
        id: 'unit-2',
        title: 'Bab 2: Pecahan Sederhana',
        order: 2,
        linkedAtpItemIds: [], // Z=0 globally because atp-1 is in unit-1, but unit-2 has no lineage
        linkedTpIds: [],
        materials: [{ id: 'm-2', title: 'Konsep Pecahan', order: 1, linkedAtpItemIds: [], linkedTpIds: [] }],
      },
    ],
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const analysis = fallbackAnalyzeMapping({
    tpData: mockTPData,
    atpData: mockATPData,
    currentMapping: mapping,
  });

  // Even though mappedAtp = 1 (totalAtp = 1, so unmapped = 0, Z=0), unit-2 has no lineage and material 'Konsep Pecahan' matches atp-1 topic.
  // Analyzer should recommend ASSIGN_ATP_TO_UNIT to unit-2 with subset TP (TP3).
  const finding = analysis.atpFindings.find((f) => f.atpItemId === 'atp-1');
  assert.ok(finding, 'Finding for atp-1 must exist');
  assert.ok(finding?.action, 'Action recommending atp-1 to unit-2 must be present despite Z=0');
  assert.strictEqual(finding.action?.targetUnitId, 'unit-2');
  assert.ok(finding.action?.linkedTpIds.includes('TP3'), 'linkedTpIds should include TP3 relevant to pecahan');
  console.log('✅ Case B & C passed');
}

// ==========================================
// CASE D & G: Preserve existing Bab & Idempotent
// ==========================================
console.log('Testing Case D & G: Preserve existing Bab and Idempotency...');
{
  // If atp-1 is already in unit-2, sanitize should reject duplicate action
  const rawResult = {
    atpFindings: [
      {
        id: 'f-1',
        atpItemId: 'atp-1',
        status: 'ALIGNED',
        action: {
          type: 'ASSIGN_ATP_TO_UNIT',
          atpItemId: 'atp-1',
          targetUnitId: 'unit-1', // already in unit-1
          linkedTpIds: ['TP1'],
        },
      },
    ],
    materialFindings: [],
  };

  const mapping: ATPUnitMappingData = {
    id: 'map-03',
    academicSettingId: 'acad-001',
    atpId: 'atp-001',
    tpDataId: 'tp-data-001',
    units: [
      {
        id: 'unit-1',
        title: 'Bab 1',
        order: 1,
        linkedAtpItemIds: ['atp-1'],
        linkedTpIds: ['TP1'],
        materials: [],
      },
    ],
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const sanitized = sanitizeMappingAnalysisResult(rawResult, {
    tpData: mockTPData,
    atpData: mockATPData,
    currentMapping: mapping,
  });

  const sanitizedFinding = sanitized.atpFindings[0];
  assert.strictEqual(sanitizedFinding.action, undefined, 'Sanitizer must drop ASSIGN_ATP_TO_UNIT if unit already has that ATP (idempotent)');
  console.log('✅ Case D & G passed');
}

// ==========================================
// CASE E: Invalid TP rejected by sanitizer
// ==========================================
console.log('Testing Case E: Invalid TP rejected by sanitizer...');
{
  const rawResult = {
    atpFindings: [
      {
        id: 'f-1',
        atpItemId: 'atp-1',
        status: 'UNMAPPED',
        action: {
          type: 'ASSIGN_ATP_TO_UNIT',
          atpItemId: 'atp-1',
          targetUnitId: 'unit-1',
          linkedTpIds: ['TP_INVALID_OR_OUTSIDE'],
        },
      },
    ],
    materialFindings: [],
  };

  const mapping: ATPUnitMappingData = {
    id: 'map-04',
    academicSettingId: 'acad-001',
    atpId: 'atp-001',
    tpDataId: 'tp-data-001',
    units: [
      {
        id: 'unit-1',
        title: 'Bab 1',
        order: 1,
        linkedAtpItemIds: [],
        linkedTpIds: [],
        materials: [],
      },
    ],
    updatedAt: '2026-01-01T00:00:00Z',
  };

  const sanitized = sanitizeMappingAnalysisResult(rawResult, {
    tpData: mockTPData,
    atpData: mockATPData,
    currentMapping: mapping,
  });

  const sanitizedFinding = sanitized.atpFindings[0];
  assert.ok(sanitizedFinding.action?.linkedTpIds.every(id => ['TP1', 'TP2', 'TP3'].includes(id)), 'Sanitizer must fallback/filter linkedTpIds to valid canonical TPs belonging to ATP');
  console.log('✅ Case E passed');
}

console.log('=== ALL MULTI-BAB ANALYSIS REGRESSION TESTS PASSED SUCCESSFULLY ===');
