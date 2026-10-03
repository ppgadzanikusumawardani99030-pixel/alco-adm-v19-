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

    status: 'SUPPORTED' | 'MISSING_MATERIAL' | 'MANUAL_REVIEW';

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
    const rawLinked = Array.isArray(item.linkedTpIds) && item.linkedTpIds.length > 0
      ? item.linkedTpIds
      : item.tpId
      ? [item.tpId]
      : [];

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
3. KONTRAK CANONICAL ATP: Setiap langkah ATP dapat memiliki MULTIPLE TP pada 'linkedTps'. Anda HARUS membaca seluruh TP tertaut tersebut secara utuh (bukan hanya TP pertama).
4. ANALISIS SEMANTIK: Gunakan pemahaman substansi pedagogis, bukan sekadar exact string matching. Perbedaan diksi wajar jika substansi materi selaras.

=== DATA PEMBELAJARAN ===
Mata Pelajaran: ${subject || 'Mata Pelajaran'}
Kelas / Fase: ${grade || ''} (${phase || ''})

=== STRUKTUR BAB & MATERI MANUAL GURU (CURRENT LOCAL DRAFT) ===
${JSON.stringify(unitsContext, null, 2)}

=== DAFTAR ALUR TUJUAN PEMBELAJARAN (CANONICAL ATP & TP) ===
${JSON.stringify(atpContext, null, 2)}

=== INSTRUKSI ANALISIS ===
1. ANALISIS ATP (atpFindings):
   - Untuk setiap ATP dalam DAFTAR ATP:
     A. Jika ATP BELUM DIPETAKAN (belum ada di unit manapun):
        - Jika ada Bab existing yang jelas relevan dengan seluruh/sebagian besar TP di ATP tersebut:
          status = "UNMAPPED", suggestedUnitId = <ID Bab existing>, strength = "STRONG"|"MODERATE"|"LOW", reason = <alasan singkat pedagogis>.
          action = { type: "ASSIGN_ATP_TO_UNIT", atpItemId: <id>, targetUnitId: <existingUnitId>, targetMaterialId?: <existingMaterialId> }
        - Jika tidak ada Bab existing yang cocok:
          status = "REVIEW", reason = <alasan perlu ditinjau guru>, (JANGAN berikan action).
     B. Jika ATP SUDAH TERPETAKAN ke suatu Bab:
        - Jika seluruh TP pada ATP tersebut selaras dengan Bab dan materi Bab:
          status = "ALIGNED", currentUnitId = <ID Bab saat ini>, reason = <konfirmasi keselarasan>.
        - Jika ada mismatch semantik:
          status = "REVIEW", currentUnitId = <ID Bab saat ini>, reason = <penjelasan gap materi>. (JANGAN buat action otomatis).

2. ANALISIS LINGKUP MATERI (materialFindings):
   - Periksa Lingkup Materi manual di setiap Bab:
     - Jika materi didukung oleh TP/ATP di Bab tersebut: status = "SUPPORTED", unitId = <unitId>, materialId = <materialId>, reason = <penjelasan>.
     - Jika ada materi manual yang belum memiliki korelasi jelas dengan TP/ATP: status = "MANUAL_REVIEW", unitId = <unitId>, materialId = <materialId>, reason = "Belum ditemukan hubungan yang cukup jelas dengan TP/ATP saat ini. Perlu ditinjau guru.".
   - Jika ada kebutuhan kompetensi TP/ATP dalam suatu Bab yang belum terwakili oleh materi manual yang ada:
     - status = "MISSING_MATERIAL", unitId = <existingUnitId>, suggestedTitle = <judul ringkas materi>, reason = <alasan penambahan>,
       action = { type: "ADD_MATERIAL_TO_UNIT", targetUnitId: <existingUnitId>, title: <judul materi baru>, linkedTpIds: [<id TP terkait>], linkedAtpItemIds: [<id ATP terkait>] }.

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
      "status": "SUPPORTED" | "MISSING_MATERIAL" | "MANUAL_REVIEW",
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
      f.action.targetUnitId &&
      validUnitIds.has(f.action.targetUnitId)
    ) {
      action = {
        type: 'ASSIGN_ATP_TO_UNIT',
        atpItemId,
        targetUnitId: f.action.targetUnitId,
        targetMaterialId: f.action.targetMaterialId && validMaterialMap.has(f.action.targetMaterialId)
          ? f.action.targetMaterialId
          : undefined,
      };
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

    const status =
      m?.status === 'SUPPORTED' || m?.status === 'MISSING_MATERIAL' || m?.status === 'MANUAL_REVIEW'
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
 * Deterministic fallback analyzer when AI service is offline or unavailable.
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
  const atpToUnitMap = new Map<string, string>();

  units.forEach((u) => {
    (u.linkedAtpItemIds || []).forEach((id) => {
      assignedAtpSet.add(id);
      atpToUnitMap.set(id, u.id);
    });
  });

  const atpFindings: MappingAnalysisResult['atpFindings'] = [];
  const materialFindings: MappingAnalysisResult['materialFindings'] = [];

  atpItems.forEach((item, idx) => {
    const rawLinked = Array.isArray(item.linkedTpIds) && item.linkedTpIds.length > 0
      ? item.linkedTpIds
      : item.tpId
      ? [item.tpId]
      : [];

    const isMapped = assignedAtpSet.has(item.id);
    const currentUnitId = atpToUnitMap.get(item.id);

    if (isMapped) {
      atpFindings.push({
        id: `atp-find-${idx + 1}`,
        atpItemId: item.id,
        status: 'ALIGNED',
        currentUnitId,
        supportingTpIds: rawLinked,
        strength: 'STRONG',
        reason: 'Langkah ATP telah terpetakan pada Bab.',
      });
    } else {
      // Find best candidate unit based on simple keyword/semantic overlap or order distribution
      let bestUnit = units[0];
      let bestScore = -1;

      const itemKeywords = [
        item.focus || '',
        ...rawLinked.map((id) => `${tpMap.get(id)?.statement || ''} ${tpMap.get(id)?.contentScope || ''}`),
      ]
        .join(' ')
        .toLowerCase()
        .split(/\s+/);

      units.forEach((u, uIdx) => {
        const uText = `${u.title} ${(u.materials || []).map((m) => m.title).join(' ')}`.toLowerCase();
        let score = 0;
        itemKeywords.forEach((w) => {
          if (w.length > 3 && uText.includes(w)) score += 2;
        });
        if (score > bestScore) {
          bestScore = score;
          bestUnit = u;
        }
      });

      if (bestUnit) {
        atpFindings.push({
          id: `atp-find-${idx + 1}`,
          atpItemId: item.id,
          status: 'UNMAPPED',
          suggestedUnitId: bestUnit.id,
          supportingTpIds: rawLinked,
          strength: bestScore > 0 ? 'STRONG' : 'MODERATE',
          reason: bestScore > 0
            ? `Topik langkah ATP selaras dengan tema '${bestUnit.title}'.`
            : `Diusulkan dipetakan ke '${bestUnit.title}' untuk melengkapi alur bab.`,
          action: {
            type: 'ASSIGN_ATP_TO_UNIT',
            atpItemId: item.id,
            targetUnitId: bestUnit.id,
          },
        });
      } else {
        atpFindings.push({
          id: `atp-find-${idx + 1}`,
          atpItemId: item.id,
          status: 'REVIEW',
          supportingTpIds: rawLinked,
          strength: 'LOW',
          reason: 'Langkah ATP belum terpetakan dan memerlukan penentuan Bab oleh guru.',
        });
      }
    }
  });

  // Evaluate Materials
  units.forEach((u, uIdx) => {
    (u.materials || []).forEach((m, mIdx) => {
      materialFindings.push({
        id: `mat-find-${uIdx + 1}-${mIdx + 1}`,
        status: m.title && m.title.trim().length > 0 ? 'SUPPORTED' : 'MANUAL_REVIEW',
        unitId: u.id,
        materialId: m.id,
        supportingTpIds: m.linkedTpIds || [],
        supportingAtpItemIds: m.linkedAtpItemIds || [],
        strength: 'STRONG',
        reason: m.title && m.title.trim().length > 0
          ? 'Lingkup materi terdaftar dalam struktur Bab.'
          : 'Lingkup materi masih kosong dan perlu dilengkapi guru.',
      });
    });
  });

  return sanitizeMappingAnalysisResult({ atpFindings, materialFindings }, params);
}
