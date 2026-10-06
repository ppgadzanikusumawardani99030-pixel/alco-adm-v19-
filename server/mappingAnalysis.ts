import { TPData, ATPData, ATPUnitMappingData } from '../src/types';

export interface MappingAnalysisResult {
  summary: {
    totalAtp: number;
    mappedAtp: number;
    unmappedAtp: number;
    alignedAtp: number;
    reviewAtp: number;
    missingMaterialSuggestions: number;
    manualMaterialReview: number;
  };

  atpFindings: Array<{
    id: string;
    atpItemId: string;
    status: 'ALIGNED' | 'UNMAPPED' | 'REVIEW';

    currentUnitId?: string;
    suggestedUnitId?: string;
    suggestedMaterialId?: string;

    supportingTpIds: string[];

    strength?: 'STRONG' | 'MODERATE' | 'LOW';

    reason: string;

    action?: {
      type: 'ASSIGN_ATP_TO_UNIT';
      atpItemId: string;
      targetUnitId: string;
      targetMaterialId?: string;
    };
  }>;

  materialFindings: Array<{
    id: string;

    status: 'SUPPORTED' | 'ALIGNABLE' | 'MISSING_MATERIAL' | 'MANUAL_REVIEW';

    unitId: string;
    materialId?: string;

    suggestedTitle?: string;

    supportingTpIds: string[];
    supportingAtpItemIds: string[];

    strength?: 'STRONG' | 'MODERATE' | 'LOW';

    reason: string;

    action?: {
      type: 'ADD_MATERIAL_TO_UNIT';
      targetUnitId: string;
      title: string;
      linkedTpIds: string[];
      linkedAtpItemIds: string[];
    } | {
      type: 'ALIGN_EXISTING_MATERIAL';
      targetUnitId: string;
      targetMaterialId: string;
      linkedAtpItemIds: string[];
      linkedTpIds: string[];
    };
  }>;
}

export interface AnalyzeATPUnitMappingServerParams {
  subject?: string;
  grade?: string;
  phase?: string;
  tpData: TPData;
  atpData: ATPData;
  currentMapping: ATPUnitMappingData;
}

const INDONESIAN_STOPWORDS = new Set([
  'dan', 'atau', 'yang', 'di', 'ke', 'dari', 'pada', 'dalam', 'untuk', 'dengan',
  'adalah', 'sebagai', 'oleh', 'ini', 'itu', 'serta', 'dapat', 'secara',
  'tentang', 'atas', 'bawah', 'antara', 'melalui', 'agar', 'supaya', 'akan',
  'telah', 'sudah', 'belum', 'bab', 'unit', 'materi', 'langkah', 'tujuan',
  'pembelajaran', 'peserta', 'didik', 'siswa', 'guru', 'kelas', 'fase',
  'mampu', 'memahami', 'mempraktikkan', 'menerapkan', 'menjelaskan', 'mengidentifikasi'
]);

function extractSubstantiveTokens(text: string): string[] {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^\w\s\d]/g, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 2 && !INDONESIAN_STOPWORDS.has(t));
}

function getCanonicalTpsForAtpItem(atpItem: any): string[] {
  if (!atpItem) return [];
  if (Array.isArray(atpItem.linkedTpIds) && atpItem.linkedTpIds.length > 0) {
    return atpItem.linkedTpIds;
  }
  if (atpItem.tpId) {
    return [atpItem.tpId];
  }
  return [];
}

/**
 * Builds the AI prompt for analyzing teacher's manual mapping against TP and ATP.
 */
export function buildMappingAnalysisPrompt(params: AnalyzeATPUnitMappingServerParams): string {
  const { subject, grade, phase, tpData, atpData, currentMapping } = params;

  // Build TP Map
  const tpMap = new Map<string, any>();
  (tpData.items || []).forEach((t) => {
    tpMap.set(t.id, t);
  });

  // Prepare ATP context using canonical linkedTpIds
  const atpContext = (atpData.items || []).map((item, idx) => {
    const rawLinked = getCanonicalTpsForAtpItem(item);

    const linkedTps = rawLinked.map((id) => {
      const t = tpMap.get(id);
      return {
        tpId: id,
        code: t?.code || 'TP',
        statement: t?.statement || '',
        contentScope: t?.contentScope || '',
        competence: t?.competence || '',
      };
    });

    return {
      atpItemId: item.id,
      stepNumber: item.stepNumber || idx + 1,
      focus: item.focus || '',
      linkedTps,
    };
  });

  // Prepare Teacher's Manual Units & Materials
  const unitsContext = (currentMapping.units || []).map((u, idx) => {
    return {
      unitId: u.id,
      order: u.order || idx + 1,
      title: u.title || `Bab ${idx + 1}`,
      assignedAtpItemIds: u.linkedAtpItemIds || [],
      materials: (u.materials || []).map((m, mIdx) => ({
        materialId: m.id,
        order: m.order || mIdx + 1,
        title: m.title || '',
        linkedAtpItemIds: m.linkedAtpItemIds || [],
        linkedTpIds: m.linkedTpIds || [],
      })),
    };
  });

  return `Anda adalah Asisten Pedagogis Ahli Kurikulum Merdeka.
TUGAS ANDA ADALAH MELAKUKAN ANALISIS PEMETAAN (READ-ONLY ANALYSIS) antara Bab & Lingkup Materi manual yang telah disusun oleh guru dengan Capaian TP & Alur Tujuan Pembelajaran (ATP).

=== PRINSIP UTAMA & BATASAN KETAT ===
1. STRUKTUR BAB & LINGKUP MATERI GURU ADALAH AUTHORITY UTAMA (berasal dari arahan sekolah/Korwil/guru).
2. ANDA TIDAK BOLEH:
   - Menghapus Bab
   - Mengubah judul Bab
   - Menghapus Lingkup Materi
   - Mengubah judul Lingkup Materi manual
   - Membuat Bab baru (ID Bab fiktif dilarang)
   - Membuat TP fiktif atau ATP fiktif
   - Mengubah urutan langkah ATP
3. KONTRAK CANONICAL ATP: Setiap langkah ATP dapat mendukung 1..n Bab/Unit. Langkah ATP tidak dibatasi hanya untuk satu Bab tunggal. Setiap Bab/Materi berhak memilih subset TP yang relevan dari ATP tersebut.
4. ANALISIS SEMANTIK KONSERVATIF:
   - Jangan menyarankan Bab tanpa bukti keselarasan yang kuat/jelas.
   - Jika suatu langkah ATP memiliki keterkaitan ambigu ke beberapa Bab, atau tidak ada Bab yang cocok, beri status "REVIEW" tanpa action otomatis.
   - Jangan otomatis menandai ATP existing sebagai "ALIGNED" jika tidak ada keselarasan yang cukup jelas.

=== KETENTUAN KHUSUS UNTUK LINGKUP MATERI MANUAL (ALIGN_EXISTING_MATERIAL) ===
Untuk setiap Lingkup Materi manual yang ada pada Bab:
- Jika materi sudah selaras secara lengkap dan benar dengan TP/ATP: status = "SUPPORTED".
- Jika materi manual memiliki silsilah (lineage) kosong atau belum lengkap, tetapi ada keselarasan semantik yang kuat dengan TP/ATP canonical tertentu:
  * Berikan status "ALIGNABLE".
  * Berikan action type "ALIGN_EXISTING_MATERIAL".
  * Material harus memilih SUBSET TP yang benar-benar relevan dengan Lingkup Materi tersebut. JANGAN otomatis memasukkan semua TP dari ATP jika ada TP yang tidak relevan.
  * Format action:
    {
      "type": "ALIGN_EXISTING_MATERIAL",
      "targetUnitId": "id bab tempat materi berada",
      "targetMaterialId": "id materi manual tersebut",
      "linkedAtpItemIds": ["id ATP canonical"],
      "linkedTpIds": ["subset id TP canonical yang relevan"]
    }
- Jika keselarasan ambigu, lemah, atau tidak ditemukan: status = "MANUAL_REVIEW" tanpa memberikan action.

=== DATA PEMBELAJARAN ===
Mata Pelajaran: ${subject || 'Mata Pelajaran'}
Kelas / Fase: ${grade || ''} (${phase || ''})

=== STRUKTUR BAB & MATERI MANUAL GURU (CURRENT LOCAL DRAFT) ===
${JSON.stringify(unitsContext, null, 2)}

=== DAFTAR ALUR TUJUAN PEMBELAJARAN (CANONICAL ATP & TP) ===
${JSON.stringify(atpContext, null, 2)}

=== INSTRUKSI ANALISIS ===
1. ANALISIS ATP (atpFindings):
   - Periksa setiap ATP dalam DAFTAR ATP. Rekomendasikan unitId jika belum dipetakan.

2. ANALISIS LINGKUP MATERI (materialFindings):
   - Periksa semua Lingkup Materi manual yang ada pada Bab.
   - Untuk materi manual dengan silsilah kosong atau belum selaras, lakukan pemetaan semantik ke TP/ATP dalam Bab tersebut dengan "ALIGN_EXISTING_MATERIAL".
   - Jika ada kebutuhan materi baru: berikan "MISSING_MATERIAL" dengan action "ADD_MATERIAL_TO_UNIT".

Kembalikan respon DALAM FORMAT JSON VALID yang mematuhi skema berikut:
{
  "summary": {
    "totalAtp": number,
    "mappedAtp": number,
    "unmappedAtp": number,
    "alignedAtp": number,
    "reviewAtp": number,
    "missingMaterialSuggestions": number,
    "manualMaterialReview": number
  },
  "atpFindings": [
    {
      "id": "finding-atp-1",
      "atpItemId": "string",
      "status": "ALIGNED" | "UNMAPPED" | "REVIEW",
      "currentUnitId": "string (opsional)",
      "suggestedUnitId": "string (opsional)",
      "suggestedMaterialId": "string (opsional)",
      "supportingTpIds": ["string"],
      "strength": "STRONG" | "MODERATE" | "LOW",
      "reason": "string",
      "action": {
        "type": "ASSIGN_ATP_TO_UNIT",
        "atpItemId": "string",
        "targetUnitId": "string",
        "targetMaterialId": "string (opsional)"
      }
    }
  ],
  "materialFindings": [
    {
      "id": "finding-mat-1",
      "status": "SUPPORTED" | "ALIGNABLE" | "MISSING_MATERIAL" | "MANUAL_REVIEW",
      "unitId": "string",
      "materialId": "string (opsional)",
      "suggestedTitle": "string (opsional)",
      "supportingTpIds": ["string"],
      "supportingAtpItemIds": ["string"],
      "strength": "STRONG" | "MODERATE" | "LOW",
      "reason": "string",
      "action": {
        "type": "ADD_MATERIAL_TO_UNIT",
        "targetUnitId": "string",
        "title": "string",
        "linkedTpIds": ["string"],
        "linkedAtpItemIds": ["string"]
      } | {
        "type": "ALIGN_EXISTING_MATERIAL",
        "targetUnitId": "string",
        "targetMaterialId": "string",
        "linkedAtpItemIds": ["string"],
        "linkedTpIds": ["string"]
      }
    }
  ]
}`;
}

/**
 * Sanitizes and validates AI findings against canonical IDs deterministically.
 */
export function sanitizeMappingAnalysisResult(
  rawResult: any,
  params: AnalyzeATPUnitMappingServerParams
): MappingAnalysisResult {
  const { tpData, atpData, currentMapping } = params;

  const validTpIds = new Set((tpData.items || []).map((t) => t.id));
  const validAtpIds = new Set((atpData.items || []).map((a) => a.id));
  const validUnitIds = new Set((currentMapping.units || []).map((u) => u.id));
  const validMaterialMap = new Map<string, string>(); // materialId -> unitId

  (currentMapping.units || []).forEach((u) => {
    (u.materials || []).forEach((m) => {
      validMaterialMap.set(m.id, u.id);
    });
  });

  const atpMap = new Map<string, any>();
  (atpData.items || []).forEach((item) => {
    atpMap.set(item.id, item);
  });

  const rawAtpFindings: any[] = Array.isArray(rawResult?.atpFindings) ? rawResult.atpFindings : [];
  const rawMaterialFindings: any[] = Array.isArray(rawResult?.materialFindings) ? rawResult.materialFindings : [];

  const atpFindings: MappingAnalysisResult['atpFindings'] = [];
  const materialFindings: MappingAnalysisResult['materialFindings'] = [];

  // 1. Sanitize ATP Findings
  rawAtpFindings.forEach((f, idx) => {
    const atpItemId = String(f?.atpItemId || '').trim();
    if (!validAtpIds.has(atpItemId)) return; // Drop invalid ATP reference

    const status = f?.status === 'ALIGNED' || f?.status === 'UNMAPPED' || f?.status === 'REVIEW'
      ? f.status
      : 'REVIEW';

    const currentUnitId = f?.currentUnitId && validUnitIds.has(f.currentUnitId) ? f.currentUnitId : undefined;
    const suggestedUnitId = f?.suggestedUnitId && validUnitIds.has(f.suggestedUnitId) ? f.suggestedUnitId : undefined;
    const suggestedMaterialId = f?.suggestedMaterialId && validMaterialMap.has(f.suggestedMaterialId)
      ? f.suggestedMaterialId
      : undefined;

    const supportingTpIds = (Array.isArray(f?.supportingTpIds) ? f.supportingTpIds : [])
      .map((id: any) => String(id).trim())
      .filter((id: string) => validTpIds.has(id));

    let action: MappingAnalysisResult['atpFindings'][0]['action'] = undefined;
    if (
      status === 'UNMAPPED' &&
      f?.action &&
      f.action.type === 'ASSIGN_ATP_TO_UNIT' &&
      f.action.atpItemId === atpItemId &&
      f.action.targetUnitId &&
      validUnitIds.has(f.action.targetUnitId)
    ) {
      const targetMatId = f.action.targetMaterialId;
      const targetMatValid = targetMatId && validMaterialMap.get(targetMatId) === f.action.targetUnitId;

      action = {
        type: 'ASSIGN_ATP_TO_UNIT',
        atpItemId,
        targetUnitId: f.action.targetUnitId,
        targetMaterialId: targetMatValid ? targetMatId : undefined,
      };
    }

    // Multi-Bab subset validation check
    const mappedUnitsForAtp = (currentMapping.units || []).filter((u) =>
      (u.linkedAtpItemIds || []).includes(atpItemId)
    );

    if (mappedUnitsForAtp.length > 1) {
      const atpObj = (atpData.items || []).find((a) => a.id === atpItemId);
      const canonicalTpIds = getCanonicalTpsForAtpItem(atpObj).filter((id) => validTpIds.has(id));

      const unitSubsets = mappedUnitsForAtp.map((u) => {
        const subset = (u.linkedTpIds || []).filter((id: string) => canonicalTpIds.includes(id));
        return { unit: u, subset, nonEmpty: subset.length > 0 };
      });

      const allSubsetsNonEmpty = unitSubsets.every((s) => s.nonEmpty);
      const unionSubset = new Set<string>();
      unitSubsets.forEach((s) => s.subset.forEach((id) => unionSubset.add(id)));
      const allCanonicalCovered = canonicalTpIds.length > 0 && canonicalTpIds.every((id) => unionSubset.has(id));

      const isMultiBabValid = allSubsetsNonEmpty && allCanonicalCovered;
      if (isMultiBabValid) {
        atpFindings.push({
          id: f?.id ? String(f.id) : `finding-atp-${idx + 1}`,
          atpItemId,
          status: 'ALIGNED',
          currentUnitId: undefined,
          suggestedUnitId: undefined,
          suggestedMaterialId: undefined,
          supportingTpIds: canonicalTpIds,
          strength: 'STRONG',
          reason: f?.reason && typeof f.reason === 'string' && f.reason.trim().length > 0
            ? f.reason.trim()
            : 'Pembagian TP lintas Bab valid dan lengkap.',
          action: undefined,
        });
      } else {
        atpFindings.push({
          id: f?.id ? String(f.id) : `finding-atp-${idx + 1}`,
          atpItemId,
          status: 'REVIEW',
          currentUnitId: undefined,
          suggestedUnitId: undefined,
          suggestedMaterialId: undefined,
          supportingTpIds: canonicalTpIds,
          strength: 'LOW',
          reason: 'Pembagian TP lintas Bab belum lengkap atau ada subset TP kosong sehingga perlu peninjauan guru.',
          action: undefined,
        });
      }
      return;
    }

    atpFindings.push({
      id: f?.id ? String(f.id) : `finding-atp-${idx + 1}`,
      atpItemId,
      status,
      currentUnitId,
      suggestedUnitId,
      suggestedMaterialId,
      supportingTpIds,
      strength: f?.strength === 'STRONG' || f?.strength === 'LOW' ? f.strength : 'MODERATE',
      reason: f?.reason && typeof f.reason === 'string' ? f.reason.trim() : 'Perlu ditinjau keselarasan materi.',
      action,
    });
  });

  // 2. Sanitize Material Findings
  rawMaterialFindings.forEach((m, idx) => {
    const unitId = String(m?.unitId || '').trim();
    if (!validUnitIds.has(unitId)) return; // Drop invalid unit reference

    let status =
      m?.status === 'SUPPORTED' || m?.status === 'ALIGNABLE' || m?.status === 'MISSING_MATERIAL' || m?.status === 'MANUAL_REVIEW'
        ? m.status
        : 'MANUAL_REVIEW';

    const materialId = m?.materialId && validMaterialMap.has(m.materialId) ? m.materialId : undefined;
    const suggestedTitle = m?.suggestedTitle ? String(m.suggestedTitle).trim() : undefined;

    const supportingTpIds = (Array.isArray(m?.supportingTpIds) ? m.supportingTpIds : [])
      .map((id: any) => String(id).trim())
      .filter((id: string) => validTpIds.has(id));

    const supportingAtpItemIds = (Array.isArray(m?.supportingAtpItemIds) ? m.supportingAtpItemIds : [])
      .map((id: any) => String(id).trim())
      .filter((id: string) => validAtpIds.has(id));

    let action: MappingAnalysisResult['materialFindings'][0]['action'] = undefined;

    if (
      status === 'MISSING_MATERIAL' &&
      m?.action &&
      m.action.type === 'ADD_MATERIAL_TO_UNIT' &&
      m.action.targetUnitId &&
      validUnitIds.has(m.action.targetUnitId) &&
      m.action.title &&
      String(m.action.title).trim().length > 0
    ) {
      action = {
        type: 'ADD_MATERIAL_TO_UNIT',
        targetUnitId: m.action.targetUnitId,
        title: String(m.action.title).trim(),
        linkedTpIds: (Array.isArray(m.action.linkedTpIds) ? m.action.linkedTpIds : []).filter((id: string) =>
          validTpIds.has(id)
        ),
        linkedAtpItemIds: (Array.isArray(m.action.linkedAtpItemIds) ? m.action.linkedAtpItemIds : []).filter(
          (id: string) => validAtpIds.has(id)
        ),
      };
    } else if (
      status === 'ALIGNABLE' &&
      m?.action &&
      m.action.type === 'ALIGN_EXISTING_MATERIAL'
    ) {
      const targetUnitId = String(m.action.targetUnitId || '').trim();
      const targetMaterialId = String(m.action.targetMaterialId || '').trim();

      const unitExists = validUnitIds.has(targetUnitId);
      const matExists = validMaterialMap.has(targetMaterialId);
      const belongsToUnit = validMaterialMap.get(targetMaterialId) === targetUnitId;

      const rawAtpIds = (Array.isArray(m.action.linkedAtpItemIds) ? m.action.linkedAtpItemIds : [])
        .map((id: any) => String(id).trim());
      const rawTpIds = (Array.isArray(m.action.linkedTpIds) ? m.action.linkedTpIds : [])
        .map((id: any) => String(id).trim());

      const allAtpIdsValid = rawAtpIds.length > 0 && rawAtpIds.every((id) => validAtpIds.has(id));
      const allTpIdsValid = rawTpIds.length > 0 && rawTpIds.every((id) => validTpIds.has(id));

      let allTpSupported = allAtpIdsValid && allTpIdsValid;
      if (allTpSupported) {
        for (const tpId of rawTpIds) {
          let supported = false;
          for (const atpId of rawAtpIds) {
            const atpItem = atpMap.get(atpId);
            const canonTps = getCanonicalTpsForAtpItem(atpItem);
            if (canonTps.includes(tpId)) {
              supported = true;
              break;
            }
          }
          if (!supported) {
            allTpSupported = false;
            break;
          }
        }
      }

      if (
        unitExists &&
        matExists &&
        belongsToUnit &&
        allTpSupported
      ) {
        action = {
          type: 'ALIGN_EXISTING_MATERIAL',
          targetUnitId,
          targetMaterialId,
          linkedAtpItemIds: rawAtpIds,
          linkedTpIds: rawTpIds,
        };
      } else {
        status = 'MANUAL_REVIEW';
        action = undefined;
      }
    }

    materialFindings.push({
      id: m?.id ? String(m.id) : `finding-mat-${idx + 1}`,
      status,
      unitId,
      materialId,
      suggestedTitle,
      supportingTpIds,
      supportingAtpItemIds,
      strength: m?.strength === 'STRONG' || m?.strength === 'LOW' ? m.strength : 'MODERATE',
      reason: m?.reason && typeof m.reason === 'string' ? m.reason.trim() : 'Peninjauan lingkup materi.',
      action,
    });
  });

  // 3. Deterministically Recompute Summary
  const allAtpItems = atpData.items || [];
  const assignedAtpSet = new Set<string>();
  (currentMapping.units || []).forEach((u) => {
    (u.linkedAtpItemIds || []).forEach((id) => assignedAtpSet.add(id));
  });

  const totalAtp = allAtpItems.length;
  const mappedAtp = allAtpItems.filter((it) => assignedAtpSet.has(it.id)).length;
  const unmappedAtp = totalAtp - mappedAtp;
  const alignedAtp = atpFindings.filter((f) => f.status === 'ALIGNED').length;
  const reviewAtp = atpFindings.filter((f) => f.status === 'REVIEW').length;
  const missingMaterialSuggestions = materialFindings.filter((f) => f.status === 'MISSING_MATERIAL').length;
  const manualMaterialReview = materialFindings.filter((f) => f.status === 'MANUAL_REVIEW').length;

  return {
    summary: {
      totalAtp,
      mappedAtp,
      unmappedAtp,
      alignedAtp,
      reviewAtp,
      missingMaterialSuggestions,
      manualMaterialReview,
    },
    atpFindings,
    materialFindings,
  };
}

/**
 * Deterministic fallback analyzer with conservative semantic evaluation.
 */
export function fallbackAnalyzeMapping(params: AnalyzeATPUnitMappingServerParams): MappingAnalysisResult {
  const { tpData, atpData, currentMapping } = params;

  const tpMap = new Map<string, any>();
  (tpData.items || []).forEach((t) => {
    tpMap.set(t.id, t);
  });

  const units = currentMapping.units || [];
  const atpItems = atpData.items || [];

  const assignedAtpSet = new Set<string>();
  const atpToUnitsMap = new Map<string, typeof units>();

  units.forEach((u) => {
    (u.linkedAtpItemIds || []).forEach((id) => {
      assignedAtpSet.add(id);
      const list = atpToUnitsMap.get(id) || [];
      list.push(u);
      atpToUnitsMap.set(id, list);
    });
  });

  // Precompute Unit manual profiles (Primary Authority)
  const unitManualProfiles = units.map((u) => {
    const unitTitleTokens = extractSubstantiveTokens(u.title || '');
    const materialTitleTokens = (u.materials || []).flatMap((m) => extractSubstantiveTokens(m.title || ''));
    return {
      unit: u,
      unitTitleTokens,
      materialTitleTokens,
      manualTokens: Array.from(new Set([...unitTitleTokens, ...materialTitleTokens])),
    };
  });

  const atpFindings: MappingAnalysisResult['atpFindings'] = [];
  const materialFindings: MappingAnalysisResult['materialFindings'] = [];

  atpItems.forEach((item, idx) => {
    const rawLinked = getCanonicalTpsForAtpItem(item);

    const itemFocusTokens = extractSubstantiveTokens(item.focus || '');
    const itemTpTokens = rawLinked.flatMap((id) => {
      const t = tpMap.get(id);
      return extractSubstantiveTokens(`${t?.statement || ''} ${t?.contentScope || ''} ${t?.competence || ''}`);
    });
    const itemScopeCodes = rawLinked
      .map((id) => tpMap.get(id)?.scopeCode)
      .filter((sc): sc is string => typeof sc === 'string' && sc.trim().length > 0);

    const allItemTokens = Array.from(new Set([...itemFocusTokens, ...itemTpTokens]));

    const mappedUnits = atpToUnitsMap.get(item.id) || [];
    const isMapped = mappedUnits.length > 0;

    // Compute match score against each unit while strictly EXCLUDING current ATP from unit context
    const scores = unitManualProfiles.map((prof) => {
      const u = prof.unit;

      let primaryScore = 0;
      const matchingTitleTokens = prof.unitTitleTokens.filter((t) => allItemTokens.includes(t));
      const matchingMatTokens = prof.materialTitleTokens.filter((t) => allItemTokens.includes(t));
      primaryScore += matchingTitleTokens.length * 3.0;
      primaryScore += matchingMatTokens.length * 3.0;

      const otherAtpIds = (u.linkedAtpItemIds || []).filter((id) => id !== item.id);
      const otherAtpItems = atpItems.filter((it) => otherAtpIds.includes(it.id));

      const otherAtpFocusTokens = otherAtpItems.flatMap((a) => extractSubstantiveTokens(a.focus || ''));
      const otherTpTokens = otherAtpItems.flatMap((a) => {
        const ids = getCanonicalTpsForAtpItem(a);
        return ids.flatMap((id) => {
          const t = tpMap.get(id);
          return extractSubstantiveTokens(`${t?.statement || ''} ${t?.contentScope || ''} ${t?.competence || ''}`);
        });
      });
      const otherTpScopeCodes = otherAtpItems.flatMap((a) => {
        const ids = getCanonicalTpsForAtpItem(a);
        return ids
          .map((id) => tpMap.get(id)?.scopeCode)
          .filter((sc): sc is string => typeof sc === 'string' && sc.trim().length > 0);
      });

      let secondaryScore = 0;
      const matchingOtherFocus = otherAtpFocusTokens.filter((t) => allItemTokens.includes(t));
      const matchingOtherTp = otherTpTokens.filter((t) => allItemTokens.includes(t));
      const hasMatchingScopeCode =
        itemScopeCodes.length > 0 && otherTpScopeCodes.some((sc) => itemScopeCodes.includes(sc));

      secondaryScore += matchingOtherFocus.length * 1.5;
      secondaryScore += matchingOtherTp.length * 1.5;
      if (hasMatchingScopeCode) {
        secondaryScore += 2.0;
      }

      const totalScore = primaryScore + secondaryScore;

      return {
        unit: u,
        primaryScore,
        secondaryScore,
        totalScore,
      };
    });

    scores.sort((a, b) => b.totalScore - a.totalScore);
    const best = scores[0];
    const second = scores[1];

    if (isMapped) {
      if (mappedUnits.length > 1) {
        const canonicalTpIds = rawLinked.filter((id) => tpMap.has(id));

        const unitSubsets = mappedUnits.map((u) => {
          const subset = (u.linkedTpIds || []).filter((id: string) => canonicalTpIds.includes(id));
          return {
            unit: u,
            subset,
            nonEmpty: subset.length > 0,
          };
        });

        const allSubsetsNonEmpty = unitSubsets.every((s) => s.nonEmpty);
        const unionSubset = new Set<string>();
        unitSubsets.forEach((s) => s.subset.forEach((id) => unionSubset.add(id)));
        const allCanonicalCovered = canonicalTpIds.length > 0 && canonicalTpIds.every((id) => unionSubset.has(id));

        const isValidMultiBab = allSubsetsNonEmpty && allCanonicalCovered;
        const babList = mappedUnits.map((u) => `Bab ${u.order}`).join(', ');

        if (isValidMultiBab) {
          atpFindings.push({
            id: `atp-find-${idx + 1}`,
            atpItemId: item.id,
            status: 'ALIGNED',
            currentUnitId: undefined,
            supportingTpIds: canonicalTpIds,
            strength: 'STRONG',
            reason: `Langkah ATP ini mendukung ${mappedUnits.length} Bab (${babList}) dengan pembagian subset TP yang valid dan lengkap.`,
          });
        } else {
          const missingCount = canonicalTpIds.filter((id) => !unionSubset.has(id)).length;
          const emptyUnits = unitSubsets.filter((s) => !s.nonEmpty).map((s) => `Bab ${s.unit.order}`).join(', ');
          let reasonText = `Pembagian TP untuk langkah ATP ini lintas Bab (${babList}) belum lengkap atau belum valid.`;
          if (missingCount > 0) {
            reasonText += ` Terdapat ${missingCount} TP canonical yang belum dicakup oleh Bab mana pun.`;
          }
          if (emptyUnits) {
            reasonText += ` ${emptyUnits} memuat ATP ini tetapi memiliki subset TP kosong.`;
          }
          atpFindings.push({
            id: `atp-find-${idx + 1}`,
            atpItemId: item.id,
            status: 'REVIEW',
            currentUnitId: undefined,
            supportingTpIds: canonicalTpIds,
            strength: 'LOW',
            reason: reasonText,
          });
        }
      } else {
        const currentUnit = mappedUnits[0];
        const currentUnitId = currentUnit.id;
        const currentScoreInfo = scores.find((s) => s.unit.id === currentUnitId);
        const currentPrimaryScore = currentScoreInfo?.primaryScore || 0;
        const currentTotalScore = currentScoreInfo?.totalScore || 0;

        const isAligned = currentPrimaryScore >= 3.0 || (currentPrimaryScore >= 2.0 && currentTotalScore >= 4.0);

        if (isAligned) {
          atpFindings.push({
            id: `atp-find-${idx + 1}`,
            atpItemId: item.id,
            status: 'ALIGNED',
            currentUnitId,
            supportingTpIds: rawLinked,
            strength: currentPrimaryScore >= 5.0 ? 'STRONG' : 'MODERATE',
            reason: `Langkah ATP dan rumusan TP tertaut selaras dengan fokus Bab ${currentUnit?.order || ''}: '${currentUnit?.title || ''}'.`,
          });
        } else {
          atpFindings.push({
            id: `atp-find-${idx + 1}`,
            atpItemId: item.id,
            status: 'REVIEW',
            currentUnitId,
            supportingTpIds: rawLinked,
            strength: 'LOW',
            reason: 'Hubungan ATP dengan Bab saat ini belum cukup kuat untuk dinyatakan selaras secara otomatis.',
          });
        }
      }
    } else {
      if (!best || best.totalScore < 3.0 || (best.primaryScore === 0 && best.totalScore < 4.0)) {
        atpFindings.push({
          id: `atp-find-${idx + 1}`,
          atpItemId: item.id,
          status: 'REVIEW',
          supportingTpIds: rawLinked,
          strength: 'LOW',
          reason: 'Belum ditemukan bukti keselarasan yang cukup kuat dengan Bab yang ada sehingga perlu penentuan guru.',
        });
      } else if (second && second.totalScore > 0 && best.totalScore - second.totalScore < 1.5 && best.totalScore < 6.0) {
        atpFindings.push({
          id: `atp-find-${idx + 1}`,
          atpItemId: item.id,
          status: 'REVIEW',
          supportingTpIds: rawLinked,
          strength: 'LOW',
          reason: `Langkah ATP memiliki keterkaitan yang hampir sama dengan beberapa Bab (Bab ${best.unit.order} & Bab ${second.unit.order}) sehingga perlu penentuan guru.`,
        });
      } else {
        const matchingMat = (best.unit.materials || []).find((m) =>
          extractSubstantiveTokens(m.title || '').some((t) => allItemTokens.includes(t))
        );

        const isStrong = best.totalScore >= 6.0;
        atpFindings.push({
          id: `atp-find-${idx + 1}`,
          atpItemId: item.id,
          status: 'UNMAPPED',
          suggestedUnitId: best.unit.id,
          suggestedMaterialId: matchingMat?.id,
          supportingTpIds: rawLinked,
          strength: isStrong ? 'STRONG' : 'MODERATE',
          reason: `Topik langkah ATP memiliki keterkaitan substantif dengan tema Bab ${best.unit.order}: '${best.unit.title}'.`,
          action: {
            type: 'ASSIGN_ATP_TO_UNIT',
            atpItemId: item.id,
            targetUnitId: best.unit.id,
            targetMaterialId: matchingMat?.id,
          },
        });
      }
    }
  });

  // EVALUATE MATERIALS CONSERVATIVELY
  units.forEach((u, uIdx) => {
    const unitAtpIds = u.linkedAtpItemIds || [];
    const unitTps = (u.linkedTpIds || []).map((id) => tpMap.get(id)).filter(Boolean);
    const unitAtps = atpItems.filter((it) => unitAtpIds.includes(it.id));

    const unitSubstantiveText = [
      u.title || '',
      ...unitAtps.map((a) => a.focus || ''),
      ...unitTps.map((t) => `${t.statement || ''} ${t.contentScope || ''}`),
    ].join(' ');

    const unitTokens = extractSubstantiveTokens(unitSubstantiveText);

    (u.materials || []).forEach((m, mIdx) => {
      const mTokens = extractSubstantiveTokens(m.title || '');
      if (mTokens.length === 0) {
        materialFindings.push({
          id: `mat-find-${uIdx + 1}-${mIdx + 1}`,
          status: 'MANUAL_REVIEW',
          unitId: u.id,
          materialId: m.id,
          supportingTpIds: m.linkedTpIds || [],
          supportingAtpItemIds: m.linkedAtpItemIds || [],
          strength: 'LOW',
          reason: 'Lingkup materi belum memiliki judul yang valid.',
        });
        return;
      }

      // Check if it already has valid lineage
      const lineageValid = (m.linkedAtpItemIds || []).length > 0 && (m.linkedTpIds || []).length > 0;
      let allTpSupportedInMat = lineageValid;
      if (lineageValid) {
        for (const tpId of m.linkedTpIds || []) {
          let supported = false;
          for (const atpId of m.linkedAtpItemIds || []) {
            const atpItem = tpMap.get(tpId) ? atpItems.find((a) => a.id === atpId) : null;
            const canonTps = getCanonicalTpsForAtpItem(atpItem);
            if (canonTps.includes(tpId)) {
              supported = true;
              break;
            }
          }
          if (!supported) {
            allTpSupportedInMat = false;
            break;
          }
        }
      }

      if (lineageValid && allTpSupportedInMat) {
        materialFindings.push({
          id: `mat-find-${uIdx + 1}-${mIdx + 1}`,
          status: 'SUPPORTED',
          unitId: u.id,
          materialId: m.id,
          supportingTpIds: m.linkedTpIds || [],
          supportingAtpItemIds: m.linkedAtpItemIds || [],
          strength: 'STRONG',
          reason: `Lingkup materi '${m.title}' didukung secara penuh oleh silsilah TP/ATP saat ini.`,
        });
        return;
      }

      // Find strong unique semantic match with ANY ATP step in parent unit
      let bestAtpItem: any = null;
      let bestOverlapScore = 0;
      let secondBestOverlapScore = 0;

      unitAtps.forEach((atpItem) => {
        const atpFocusTokens = extractSubstantiveTokens(atpItem.focus || '');
        const canonTps = getCanonicalTpsForAtpItem(atpItem);
        const atpTpTokens = canonTps.flatMap((id) => {
          const t = tpMap.get(id);
          return extractSubstantiveTokens(`${t?.statement || ''} ${t?.contentScope || ''}`);
        });
        const combinedTokens = Array.from(new Set([...atpFocusTokens, ...atpTpTokens]));
        const overlapCount = mTokens.filter((t) => combinedTokens.includes(t)).length;

        if (overlapCount > bestOverlapScore) {
          secondBestOverlapScore = bestOverlapScore;
          bestOverlapScore = overlapCount;
          bestAtpItem = atpItem;
        } else if (overlapCount > secondBestOverlapScore) {
          secondBestOverlapScore = overlapCount;
        }
      });

      const hasStrongUniqueMatch =
        bestOverlapScore >= 2 &&
        (bestOverlapScore - secondBestOverlapScore >= 1);

      if (hasStrongUniqueMatch && bestAtpItem) {
        // Material selects SUBSET TP relevant to that Material.
        // We select the TPs of bestAtpItem whose tokens overlap with mTokens.
        // Fallback to the first TP of bestAtpItem if none overlap, but never expand to all.
        const canonTps = getCanonicalTpsForAtpItem(bestAtpItem);
        const relevantTps = canonTps.filter((tpId) => {
          const t = tpMap.get(tpId);
          const tTokens = extractSubstantiveTokens(`${t?.statement || ''} ${t?.contentScope || ''}`);
          return mTokens.some((tok) => tTokens.includes(tok));
        });

        const selectedTps = relevantTps;

        if (selectedTps.length > 0) {
          materialFindings.push({
            id: `mat-find-${uIdx + 1}-${mIdx + 1}`,
            status: 'ALIGNABLE',
            unitId: u.id,
            materialId: m.id,
            supportingTpIds: selectedTps,
            supportingAtpItemIds: [bestAtpItem.id],
            strength: bestOverlapScore >= 3 ? 'STRONG' : 'MODERATE',
            reason: `Lingkup materi '${m.title}' dapat diselaraskan dengan langkah ATP '${bestAtpItem.focus || bestAtpItem.id}'.`,
            action: {
              type: 'ALIGN_EXISTING_MATERIAL',
              targetUnitId: u.id,
              targetMaterialId: m.id,
              linkedAtpItemIds: [bestAtpItem.id],
              linkedTpIds: selectedTps,
            },
          });
          return;
        }
      }

      // No alignment found
      materialFindings.push({
        id: `mat-find-${uIdx + 1}-${mIdx + 1}`,
        status: 'MANUAL_REVIEW',
        unitId: u.id,
        materialId: m.id,
        supportingTpIds: m.linkedTpIds || [],
        supportingAtpItemIds: m.linkedAtpItemIds || [],
        strength: 'LOW',
        reason: 'Belum ditemukan keselarasan semantik yang cukup kuat. Perlu ditinjau guru.',
      });
    });
  });

  return sanitizeMappingAnalysisResult({ atpFindings, materialFindings }, params);
}
