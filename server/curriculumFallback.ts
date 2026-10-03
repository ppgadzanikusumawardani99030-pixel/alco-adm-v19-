/**
 * Pedagogical Rule-Based Engine & Fallback Generator for Kurikulum Merdeka
 * Used when GEMINI_API_KEY is not configured or when AI services are temporarily unreachable.
 */

export interface FallbackAnalyzeCPParams {
  cpText?: string;
  elements?: Array<{ id?: string; elementId?: string; name: string; content: string }>;
  subject?: string;
  grade?: string;
  phase?: string;
  curriculum?: string;
}

export function deriveScopeCode(scopeText?: string): string {
  if (!scopeText || !scopeText.trim()) return 'MAT';
  const words = scopeText.trim().replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    const code = words.map((w) => w[0].toUpperCase()).slice(0, 4).join('');
    if (code.length >= 2) return code;
  }
  const word = words[0].toUpperCase();
  if (word.length <= 4) return word;
  return word.slice(0, 3);
}

export function fallbackAnalyzeCP(params: FallbackAnalyzeCPParams) {
  const subject = params.subject || 'Mata Pelajaran';
  const grade = params.grade || '';
  const phase = params.phase || '';
  const cpGeneralText = (params.cpText || '').trim();
  const rawElements = Array.isArray(params.elements) ? params.elements : [];

  const commonKKOList = [
    'Menganalisis', 'Memahami', 'Mengidentifikasi', 'Menerapkan', 'Mengevaluasi',
    'Merancang', 'Mempraktikkan', 'Menyajikan', 'Mengomunikasikan', 'Menciptakan',
    'Menjelaskan', 'Membandingkan', 'Mendeskripsikan', 'Menyusun'
  ];

  const extractCompetenceFromText = (text: string): string => {
    if (!text) return '';
    const matched = commonKKOList.filter((kko) => new RegExp(`\\b${kko}\\b`, 'i').test(text));
    if (matched.length > 0) {
      return matched.join(' & ');
    }
    return ''; // Leave empty if uncertain!
  };

  const extractScopeFromText = (text: string): string => {
    if (!text) return '';
    const clean = text
      .replace(/^(pada akhir fase|peserta didik mampu|murid mampu|pada fase ini|peserta didik dapat)\s+/i, '')
      .trim();
    if (clean.length > 0) {
      return clean.length > 120 ? `${clean.substring(0, 117)}...` : clean;
    }
    return ''; // Leave empty if uncertain!
  };

  const items: Array<{
    elementId?: string;
    elementName: string;
    scopeCode: string;
    cpText: string;
    cpCompetence: string;
    materialScope: string;
    meaningfulUnderstanding: string;
    suggestedTp: string;
  }> = [];

  if (rawElements.length > 0) {
    rawElements.forEach((elem, idx) => {
      const elemName = elem.name?.trim() || `Elemen ${idx + 1}`;
      const elemContent = elem.content?.trim() || '';
      const elemId = (elem.id && elem.id.trim()) || (elem.elementId && elem.elementId.trim()) || undefined;

      const competence = extractCompetenceFromText(elemContent);
      const scope = extractScopeFromText(elemContent);
      const scopeCode = deriveScopeCode(scope || elemName);
      const suggestedTp = competence && scope ? `Peserta didik mampu ${competence.toLowerCase()} ${scope}.` : '';

      items.push({
        elementId: elemId,
        elementName: elemName,
        scopeCode,
        cpText: elemContent,
        cpCompetence: competence,
        materialScope: scope,
        meaningfulUnderstanding: '',
        suggestedTp,
      });
    });
  } else if (cpGeneralText) {
    const competence = extractCompetenceFromText(cpGeneralText);
    const scope = extractScopeFromText(cpGeneralText);
    const scopeCode = deriveScopeCode(scope || 'Umum');
    const suggestedTp = competence && scope ? `Peserta didik mampu ${competence.toLowerCase()} ${scope}.` : '';

    items.push({
      elementId: undefined,
      elementName: 'Capaian Umum',
      scopeCode,
      cpText: cpGeneralText,
      cpCompetence: competence,
      materialScope: scope,
      meaningfulUnderstanding: '',
      suggestedTp,
    });
  }

  const generalSummary = cpGeneralText || (items.length > 0 ? items.map((i) => `${i.elementName}: ${i.cpText}`).join('; ') : `Analisis Capaian Pembelajaran ${subject} ${grade} (${phase}).`);

  return {
    generalSummary,
    items,
  };
}

export interface FallbackGenerateTPParams {
  cpGeneral?: string;
  cpElements?: { code?: string; name: string; content: string }[];
  cpAnalysisItems?: Array<{
    id: string;
    elementId?: string;
    elementName?: string;
    scopeCode?: string;
    cpCompetence?: string;
    materialScope?: string;
    suggestedTp?: string;
  }>;
  existingTps?: Array<{
    id: string;
    code?: string;
    scopeCode?: string;
    elementName?: string;
    statement: string;
    competence?: string;
    contentScope?: string;
    p3Dimensions?: string[];
    cpAnalysisItemIds?: string[];
    order?: number;
  }>;
  subject?: string;
  grade?: string;
  phase?: string;
  curriculum?: string;
  count?: number;
}

export function fallbackGenerateTP(params: FallbackGenerateTPParams) {
  const cpGeneralText = (params.cpGeneral || '').trim();
  const validElements = (params.cpElements || []).filter((e) => e && e.content && e.content.trim().length > 0);
  const cpAnalysisItems = Array.isArray(params.cpAnalysisItems) ? params.cpAnalysisItems : [];
  const existingTps = Array.isArray(params.existingTps) ? params.existingTps : [];

  // INSUFFICIENT CANONICAL SOURCE -> FAIL/BLOCK (return empty)
  if (!cpGeneralText && validElements.length === 0 && cpAnalysisItems.length === 0) {
    return existingTps;
  }

  const sequenceCounters = new Map<string, number>();

  const getSemanticCode = (elemName: string, scopeText: string, providedElemCode?: string, providedScopeCode?: string): { code: string; scopeCode: string } => {
    let elemCode = providedElemCode;
    if (!elemCode) {
      const foundIdx = validElements.findIndex((e) => e.name && elemName && e.name.toLowerCase().trim() === elemName.toLowerCase().trim());
      elemCode = foundIdx !== -1 ? (validElements[foundIdx].code || `E${foundIdx + 1}`) : 'E1';
    }
    const scopeCode = providedScopeCode || deriveScopeCode(scopeText);
    const key = `${elemCode}-${scopeCode}`;
    const seq = (sequenceCounters.get(key) || 0) + 1;
    sequenceCounters.set(key, seq);
    return {
      code: `${elemCode}-${scopeCode}-${String(seq).padStart(2, '0')}`,
      scopeCode,
    };
  };

  const rawGeneratedItems: Array<{
    code: string;
    scopeCode: string;
    elementName: string;
    statement: string;
    competence: string;
    contentScope: string;
    p3Dimensions: string[];
    graduateProfileDimensions?: string[];
    cpAnalysisItemIds: string[];
  }> = [];

  if (cpAnalysisItems.length > 0) {
    // ATOMIC TP PROCESSING (Process each CPAnalysisItem independently - No merging across analysis items)
    for (let i = 0; i < cpAnalysisItems.length; i++) {
      const cpa = cpAnalysisItems[i];
      const elemName = (cpa.elementName || '').trim();
      const comp = cpa.cpCompetence?.trim() || 'Memahami & Menerapkan';
      const scope = (cpa.materialScope || '').trim();
      const analysisId = String(cpa.id);

      // Check for decomposition: If single item has clearly distinct compound scopes separated by semicolon or newline
      const compoundParts = scope.split(/[;\n]/).map((p) => p.trim()).filter((p) => p.length > 2);

      if (compoundParts.length > 1) {
        // Decompose into focused atomic TPs, each referencing this single CPAnalysisItem
        compoundParts.forEach((part) => {
          const { code, scopeCode } = getSemanticCode(elemName, part, undefined, cpa.scopeCode);
          rawGeneratedItems.push({
            code,
            scopeCode,
            elementName: elemName,
            statement: `Peserta didik mampu ${comp.toLowerCase()} ${part} secara mandiri dan bernalar kritis.`,
            competence: comp,
            contentScope: part,
            p3Dimensions: ['Bernalar Kritis', 'Mandiri'],
            graduateProfileDimensions: ['Bernalar Kritis', 'Mandiri'],
            cpAnalysisItemIds: [analysisId],
          });
        });
      } else {
        // Single atomic TP
        const finalScope = scope || 'Materi Pokok';
        const statement = cpa.suggestedTp && cpa.suggestedTp.length > 15
          ? cpa.suggestedTp
          : `Peserta didik mampu ${comp.toLowerCase()} ${finalScope} secara mandiri dan bernalar kritis.`;

        const { code, scopeCode } = getSemanticCode(elemName, finalScope, undefined, cpa.scopeCode);
        rawGeneratedItems.push({
          code,
          scopeCode,
          elementName: elemName,
          statement,
          competence: comp,
          contentScope: finalScope,
          p3Dimensions: ['Bernalar Kritis', 'Mandiri'],
          graduateProfileDimensions: ['Bernalar Kritis', 'Mandiri'],
          cpAnalysisItemIds: [analysisId],
        });
      }
    }
  } else if (validElements.length > 0) {
    validElements.forEach((elem) => {
      const elemName = elem.name ? elem.name.trim() : '';
      const cleanContent = elem.content ? elem.content.slice(0, 100).trim() : '';
      if (!cleanContent) return;

      const { code, scopeCode } = getSemanticCode(elemName, cleanContent, elem.code);
      rawGeneratedItems.push({
        code,
        scopeCode,
        elementName: elemName,
        statement: `Peserta didik mampu memahami dan menerapkan konsep ${elemName ? elemName.toLowerCase() + ' terkait ' : ''}${cleanContent} secara mandiri dan bernalar kritis.`,
        competence: 'Memahami & Menerapkan',
        contentScope: cleanContent,
        p3Dimensions: ['Bernalar Kritis', 'Mandiri'],
        graduateProfileDimensions: ['Bernalar Kritis', 'Mandiri'],
        cpAnalysisItemIds: [],
      });
    });
  } else if (cpGeneralText) {
    const scope = cpGeneralText.slice(0, 80).trim();
    const { code, scopeCode } = getSemanticCode('Capaian Umum', scope, 'E1');
    rawGeneratedItems.push({
      code,
      scopeCode,
      elementName: '',
      statement: `Peserta didik mampu memahami dan menjelaskan capaian ${cpGeneralText.slice(0, 100).trim()} secara komprehensif.`,
      competence: 'Memahami & Menjelaskan',
      contentScope: scope,
      p3Dimensions: ['Bernalar Kritis', 'Mandiri'],
      graduateProfileDimensions: ['Bernalar Kritis', 'Mandiri'],
      cpAnalysisItemIds: [],
    });
  }

  // Safe merge with existingTps if provided
  if (existingTps.length > 0) {
    const matchedExistingIds = new Set<string>();
    const merged: Array<any> = [];

    for (let i = 0; i < rawGeneratedItems.length; i++) {
      const gen = rawGeneratedItems[i];
      let bestMatch: any = null;
      let highestScore = 3;

      for (const exist of existingTps) {
        if (matchedExistingIds.has(exist.id)) continue;
        let score = 0;

        // cpAnalysisItemIds overlap
        const genIds = gen.cpAnalysisItemIds || [];
        const existIds = exist.cpAnalysisItemIds || [];
        if (genIds.length > 0 && existIds.length > 0 && genIds.some((id) => existIds.includes(id))) {
          score += 10;
        }

        // Element name match
        if (gen.elementName && exist.elementName && gen.elementName.toLowerCase() === exist.elementName.toLowerCase()) {
          score += 4;
        }

        // Content scope match
        if (gen.contentScope && exist.contentScope && (gen.contentScope.toLowerCase().includes(exist.contentScope.toLowerCase()) || exist.contentScope.toLowerCase().includes(gen.contentScope.toLowerCase()))) {
          score += 5;
        }

        if (score > highestScore) {
          highestScore = score;
          bestMatch = exist;
        }
      }

      if (bestMatch) {
        matchedExistingIds.add(bestMatch.id);
        merged.push({
          ...bestMatch,
          id: bestMatch.id, // Mandatory stable ID!
          statement: bestMatch.statement || gen.statement,
          competence: bestMatch.competence || gen.competence,
          contentScope: bestMatch.contentScope || gen.contentScope,
          elementName: bestMatch.elementName || gen.elementName,
          p3Dimensions: bestMatch.p3Dimensions && bestMatch.p3Dimensions.length > 0 ? bestMatch.p3Dimensions : gen.p3Dimensions,
          cpAnalysisItemIds: gen.cpAnalysisItemIds,
        });
      } else {
        merged.push({
          ...gen,
          id: `tp-item-${Date.now()}-${i + 1}`,
        });
      }
    }

    // Preserve existing unmatched TPs
    existingTps.forEach((exist) => {
      if (!matchedExistingIds.has(exist.id)) {
        merged.push(exist);
      }
    });

    return merged.map((it, idx) => ({ ...it, order: idx + 1 }));
  }

  return rawGeneratedItems;
}

export interface FallbackGenerateATPParams {
  tps: Array<{
    id?: string;
    code: string;
    statement: string;
    elementName?: string;
    competence?: string;
    contentScope?: string;
    p3Dimensions?: string[];
  }>;
  cpGeneral?: string;
  subject?: string;
  grade?: string;
  phase?: string;
  semester?: string;
  academicYear?: string;
  totalHoursPerWeek?: number;
}

export function fallbackGenerateATP(params: FallbackGenerateATPParams) {
  const subject = params.subject || '';
  const grade = params.grade || '';
  const phase = params.phase || '';
  const tps = params.tps || [];

  const items = tps.map((tp, idx) => {
    const stepNum = idx + 1;
    const material = tp.contentScope || '';
    return {
      stepNumber: stepNum,
      tpId: tp.id || '',
      tpCode: tp.code || '',
      tpStatement: tp.statement || '',
      materialScope: material,
      allocatedJP: null,
      jp: null as any,
      p3Dimensions: tp.p3Dimensions && tp.p3Dimensions.length > 0 ? tp.p3Dimensions : [],
      assessmentPlan: '',
      glossary: '',
      resources: '',
    };
  });

  return {
    rationale: subject && grade
      ? `Alur Tujuan Pembelajaran (ATP) untuk ${subject} ${grade} (${phase}).`
      : 'Alur Tujuan Pembelajaran (ATP).',
    items,
  };
}

export function fallbackRefineText(text: string, instruction?: string, context?: string) {
  if (!text) return '';
  const trimmed = text.trim();
  // Capitalize sentence start and trim multiple spaces
  const clean = trimmed
    .replace(/\s+/g, ' ')
    .replace(/(^\w|\.\s+\w)/gm, (match) => match.toUpperCase());
  return clean;
}

export interface FallbackGenerateLearningPlanParams {
  academicSetting?: {
    subject?: string;
    grade?: string;
    phase?: string;
    curriculum?: string;
    academicYear?: string;
    semester?: string;
  };
  tps?: Array<{
    id?: string;
    code?: string;
    statement?: string;
    contentScope?: string;
    competence?: string;
  }>;
  atpItems?: Array<{
    id?: string;
    stepNumber?: number;
    materialScope?: string;
    jp?: number;
  }>;
  topic?: string;
}

export function fallbackGenerateLearningPlan(params: FallbackGenerateLearningPlanParams) {
  const subject = params.academicSetting?.subject || '';
  const grade = params.academicSetting?.grade || '';
  const tps = params.tps || [];
  const primaryTp = tps[0];
  const topicName = params.topic || primaryTp?.contentScope || primaryTp?.statement || `Topik Pembelajaran ${subject}`.trim();
  const tpCodeStr = primaryTp?.code ? `[${primaryTp.code}] ` : '';
  const linkedTpIds = tps.map((t) => t.id).filter(Boolean) as string[];

  return {
    title: `Draf Modul Ajar: ${topicName}`,
    topic: topicName,
    meaningfulUnderstanding: `Murid memahami konsep esensial ${topicName} dan mampu menerapkannya secara mandiri serta kritis dalam konteks kehidupan sehari-hari.`,
    triggerQuestions: [
      `Mengapa pemahaman tentang ${topicName} penting dalam kehidupan sehari-hari?`,
      `Bagaimana kita dapat menerapkan konsep ini untuk menyelesaikan permasalahan di lingkungan sekitar?`
    ],
    learningExperiences: [
      {
        id: `exp-1-${Date.now()}`,
        phase: 'UNDERSTAND',
        description: `Murid mengamati contoh kontekstual, mendiskusikan konsep dasar ${topicName}, dan mengidentifikasi bagian-bagian utamanya.`,
        durationMinutes: 35,
        linkedTpIds
      },
      {
        id: `exp-2-${Date.now()}`,
        phase: 'APPLY',
        description: `Murid secara berpasangan/kelompok melakukan eksplorasi dan menyelesaikan latihan penerapan ${topicName}.`,
        durationMinutes: 45,
        linkedTpIds
      },
      {
        id: `exp-3-${Date.now()}`,
        phase: 'REFLECT',
        description: `Murid menyimpulkan pemahaman, melakukan refleksi diri tentang tantangan belajar, dan merencanakan langkah perbaikan.`,
        durationMinutes: 20,
        linkedTpIds
      }
    ],
    deepLearningContext: {
      principles: ['MINDFUL', 'MEANINGFUL', 'JOYFUL'],
      graduateProfileDimensions: ['Bernalar Kritis', 'Mandiri']
    },
    graduateProfileDimensions: ['Bernalar Kritis', 'Mandiri'],
    learningSteps: {
      opening: [
        {
          id: `step-open-${Date.now()}`,
          stepName: 'Kegiatan Awal / Apersepsi',
          description: `Guru menyapa murid, memeriksa presensi, menyampaikan tujuan pembelajaran ${tpCodeStr}${topicName}, serta memberikan pertanyaan pemantik.`,
          durationMinutes: 10
        }
      ],
      core: [
        {
          id: `step-core-${Date.now()}`,
          stepName: 'Kegiatan Inti (Eksplorasi & Aplikasi)',
          description: `Murid terlibat aktif dalam aktivitas berkesadaran dan pemecahan masalah ${topicName} secara terbimbing dan mandiri.`,
          durationMinutes: 70
        }
      ],
      closing: [
        {
          id: `step-close-${Date.now()}`,
          stepName: 'Kegiatan Penutup & Refleksi',
          description: `Guru dan murid merangkum poin penting pembelajaran, melakukan refleksi, dan menyampaikan tindak lanjut untuk pertemuan berikutnya.`,
          durationMinutes: 10
        }
      ]
    },
    assessmentPlan: {
      initial: [
        {
          id: `asm-init-${Date.now()}`,
          type: 'INITIAL',
          technique: 'Tanya Jawab / Diagnostik Singkat',
          description: `Mengecek kesiapan dan pengetahuan awal murid mengenai ${topicName}.`,
          linkedTpIds
        }
      ],
      formative: [
        {
          id: `asm-form-${Date.now()}`,
          type: 'FORMATIVE',
          technique: 'Observasi Performa & Diskusi Kelompok',
          description: `Memantau keterlibatan, pemahaman konsep, dan sikap kolaboratif murid selama proses belajar.`,
          linkedTpIds
        }
      ],
      summative: [
        {
          id: `asm-sum-${Date.now()}`,
          type: 'SUMMATIVE',
          technique: 'Tes Subformatif / Unjuk Kerja',
          description: `Mengukur pencapaian Tujuan Pembelajaran ${tpCodeStr} pada akhir topik.`,
          linkedTpIds
        }
      ]
    },
    differentiation: {
      content: `Penyediaan materi visual/teks sesuai kesiapan belajar murid.`,
      process: `Bimbingan khusus bagi murid yang memerlukan pendampingan dan tantangan tambahan bagi yang cepat paham.`,
      product: `Murid diberikan pilihan bentuk penyajian hasil tugas (diagram, tulisan, atau presentasi lisan).`
    },
    reflection: {
      teacher: `Apakah seluruh murid mencapai target pembelajaran? Kendala apa yang dihadapi dan bagaimana solusinya?`,
      student: `Bagian mana dari pembelajaran ${topicName} yang paling menarik dan bagian mana yang masih memerlukan latihan?`
    },
    enrichmentPlan: `Pemberian soal tantangan kontekstual tingkat lanjut bagi murid dengan pencapaian di atas rata-rata.`,
    remedialPlan: `Bimbingan perorangan/kelompok kecil dan penyederhanaan latihan bagi murid yang belum tuntas.`,
    resources: [
      { id: `res-1-${Date.now()}`, title: `Buku Siswa ${subject} ${grade}`.trim() },
      { id: `res-2-${Date.now()}`, title: `Lembar Kerja Murid (LKM) ${topicName}` }
    ],
    allocatedJP: params.atpItems && params.atpItems.length > 0 ? params.atpItems.reduce((acc, curr) => acc + (curr.jp || 2), 0) : 2
  };
}

export interface FallbackATPMappingParams {
  atpItems: Array<{
    id: string;
    stepNumber?: number;
    tpCode?: string;
    tpStatement?: string;
    unitTitle?: string;
    materialScope?: string;
  }>;
  targetUnitCount: number;
  teacherUnits: Record<number, string>;
  subject?: string;
}

export function fallbackGenerateATPMapping(params: FallbackATPMappingParams) {
  const { atpItems, targetUnitCount, teacherUnits, subject = 'Mata Pelajaran' } = params;
  const count = Math.max(1, Math.min(20, targetUnitCount || 6));
  const totalItems = Math.max(1, atpItems.length);

  // Build units list
  const units: Array<{ unitIndex: number; unitTitle: string; description: string }> = [];
  for (let u = 1; u <= count; u++) {
    const existingTitle = teacherUnits[u];
    const unitTitle =
      existingTitle && existingTitle.trim().length > 0
        ? existingTitle.trim()
        : `Bab ${u}: Pembelajaran ${subject} Bagian ${u}`;
    units.push({
      unitIndex: u,
      unitTitle,
      description: `Materi pembelajaran unit ke-${u}`,
    });
  }

  // Distribute ATP items across units chronologically
  const mappings: Array<{ atpItemId: string; unitTitle: string; materialScope: string }> = [];

  atpItems.forEach((item, idx) => {
    // Calculate which unit this item falls into (balanced distribution)
    const unitIdx = Math.min(count, Math.floor((idx / totalItems) * count) + 1);
    const assignedUnit = units.find((u) => u.unitIndex === unitIdx) || units[0];

    const finalUnitTitle =
      item.unitTitle && item.unitTitle.trim().length > 0
        ? item.unitTitle.trim()
        : assignedUnit.unitTitle;

    let derivedMaterial =
      item.materialScope && item.materialScope.trim().length > 0
        ? item.materialScope.trim()
        : '';

    if (!derivedMaterial) {
      if (item.tpStatement) {
        // Extract meaningful topic from TP statement
        const cleanStmt = item.tpStatement.replace(/^(peserta didik|murid|siswa)\s+(dapat|mampu)\s+/i, '');
        derivedMaterial = cleanStmt.length > 60 ? `${cleanStmt.substring(0, 57)}...` : cleanStmt;
      } else {
        derivedMaterial = `Materi Pokok Langkah #${item.stepNumber || idx + 1}`;
      }
    }

    mappings.push({
      atpItemId: item.id,
      unitTitle: finalUnitTitle,
      materialScope: derivedMaterial,
    });
  });

  return {
    units,
    mappings,
  };
}

export interface FallbackCanonicalUnitMappingParams {
  academicSettingId?: string;
  subject?: string;
  grade?: string;
  phase?: string;
  tpData: {
    id?: string;
    updatedAt?: string;
    items: Array<{
      id: string;
      code?: string;
      scopeCode?: string;
      elementName?: string;
      statement: string;
      competence?: string;
      contentScope?: string;
      cpAnalysisId?: string;
      cpAnalysisItemIds?: string[];
      order?: number;
    }>;
  };
  atpData: {
    id?: string;
    updatedAt?: string;
    items: Array<{
      id: string;
      stepNumber: number;
      tpId?: string;
      tpCode?: string;
      tpStatement?: string;
      unitTitle?: string;
      materialScope?: string;
    }>;
  };
  cpAnalysisData?: {
    id?: string;
    items?: Array<{
      id: string;
      elementId?: string;
      elementName: string;
      scopeCode?: string;
      cpCompetence: string;
      materialScope: string;
      suggestedTp?: string;
    }>;
  };
  existingMapping?: {
    id?: string;
    academicSettingId?: string;
    atpId?: string;
    tpDataId?: string;
    units: Array<{
      id: string;
      title: string;
      order: number;
      linkedTpIds: string[];
      linkedAtpItemIds: string[];
      materials: Array<{
        id: string;
        title: string;
        order: number;
        linkedTpIds: string[];
        linkedAtpItemIds: string[];
      }>;
    }>;
  };
  targetUnitCount?: number;
  targetMaterialCountPerUnit?: number;
}

export function fallbackGenerateCanonicalATPUnitMapping(
  params: FallbackCanonicalUnitMappingParams
) {
  const {
    academicSettingId = '',
    subject = 'Mata Pelajaran',
    tpData,
    atpData,
    cpAnalysisData,
    existingMapping,
    targetUnitCount,
  } = params;

  const validTpItems = Array.isArray(tpData?.items) ? tpData.items : [];
  const tpMap = new Map<string, (typeof validTpItems)[0]>();
  validTpItems.forEach((tp) => tpMap.set(tp.id, tp));

  const validAtpItems = Array.isArray(atpData?.items)
    ? [...atpData.items].sort((a, b) => (a.stepNumber || 0) - (b.stepNumber || 0))
    : [];
  const atpMap = new Map<string, (typeof validAtpItems)[0]>();
  validAtpItems.forEach((atp) => atpMap.set(atp.id, atp));

  const cpAnalysisItems = Array.isArray(cpAnalysisData?.items) ? cpAnalysisData.items : [];
  const cpaMap = new Map<string, (typeof cpAnalysisItems)[0]>();
  cpAnalysisItems.forEach((cpa) => cpaMap.set(cpa.id, cpa));

  // Indonesian stopwords for semantic keyword extraction
  const STOPWORDS = new Set([
    'dan', 'atau', 'pada', 'dalam', 'dengan', 'untuk', 'secara', 'yang', 'serta',
    'dapat', 'mampu', 'peserta', 'didik', 'siswa', 'murid', 'pembelajaran', 'materi',
    'konsep', 'memahami', 'mengidentifikasi', 'menjelaskan', 'mempraktikkan', 'menganalisis',
    'merancang', 'melakukan', 'tentang', 'terhadap', 'sebagai', 'melalui', 'proses',
    'tahap', 'bagian', 'berbagai', 'macam', 'jenis', 'dasar', 'awal', 'akhir', 'menggunakan'
  ]);

  const extractKeywords = (text: string): string[] => {
    if (!text) return [];
    const clean = text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ');
    const tokens = clean.split(/\s+/).filter((t) => t.length > 2 && !STOPWORDS.has(t));
    return Array.from(new Set(tokens));
  };

  // Helper to extract clean content summary from TP
  const extractTopicFromTp = (tp?: (typeof validTpItems)[0]): string => {
    if (!tp) return 'Materi Pembelajaran';
    if (tp.contentScope && tp.contentScope.trim().length > 0) {
      return tp.contentScope.trim();
    }
    // Check linked CP analysis
    if (tp.cpAnalysisItemIds && tp.cpAnalysisItemIds.length > 0) {
      for (const cpaId of tp.cpAnalysisItemIds) {
        const cpa = cpaMap.get(cpaId);
        if (cpa && cpa.materialScope && cpa.materialScope.trim().length > 0) {
          return cpa.materialScope.trim();
        }
      }
    }
    const cleanStmt = (tp.statement || '')
      .replace(/^(peserta didik|murid|siswa)\s+(dapat|mampu)\s+/i, '')
      .trim();
    return cleanStmt.length > 60 ? `${cleanStmt.substring(0, 57)}...` : cleanStmt || 'Materi Pembelajaran';
  };

  const CROSS_CUTTING_TOKENS = new Set([
    'profil', 'pelajar', 'pancasila', 'lulusan', 'karakter', 'evaluasi', 'diri', 
    'refleksi', 'sikap', 'tanggung', 'jawab', 'kolaborasi', 'nilai', 'sosial', 
    'moral', 'perilaku', 'akhlak', 'gotong', 'royong', 'mandiri', 'kreatif', 
    'kritis', 'kebinekaan', 'spiritual', 'emosional'
  ]);

  const NEUTRAL_WORDS = new Set([
    'dalam', 'pada', 'melalui', 'saat', 'kegiatan', 'aktivitas', 'pembelajaran',
    'dan', 'atau', 'dengan', 'untuk', 'secara', 'yang', 'serta', 'ke', 'di', 'dari',
    'sebagai', 'dapat', 'mampu', 'oleh', 'adalah', 'adapun', 'ini', 'itu', 'ia', 'mereka'
  ]);

  const SHARED_GENERIC_NEUTRAL_WORDS = new Set([...CROSS_CUTTING_TOKENS, ...NEUTRAL_WORDS]);

  const isCrossCuttingTp = (tp?: (typeof validTpItems)[0]): boolean => {
    if (!tp) return false;

    const checkSubstantiveCrossCutting = (text: string): boolean => {
      if (!text) return false;
      const clean = text.toLowerCase().trim();
      
      // 1. Check strong semantic anchor phrases
      if (
        clean.includes('tanggung jawab') ||
        clean.includes('evaluasi diri') ||
        clean.includes('profil lulusan') ||
        clean.includes('profil pelajar pancasila') ||
        clean.includes('pengembangan karakter') ||
        clean.includes('gotong royong')
      ) {
        return true;
      }
      
      // 2. Strong standalone keywords (guaranteed to be cross-cutting)
      const strongKeywords = [
        'karakter', 'refleksi', 'kolaborasi', 'sikap', 'akhlak'
      ];
      
      const words = clean.replace(/[^a-zA-Z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
      if (words.some(w => strongKeywords.includes(w))) {
        return true;
      }

      // 3. Guard ambiguous tokens: they must have supporting cross-cutting vocabulary to match
      const ambiguousTokens = new Set(['nilai', 'sosial', 'moral', 'spiritual', 'emosional', 'kebinekaan']);
      const supportTokens = new Set([
        'nilai', 'sosial', 'moral', 'spiritual', 'emosional', 'kebinekaan', 
        'mandiri', 'kreatif', 'kritis', 'profil', 'diri', 'karakter', 'sikap', 'akhlak',
        'global', 'pancasila', 'lulusan', 'kolaborasi', 'refleksi', 'tanggung', 'jawab'
      ]);

      let hasAmbiguous = false;
      let supportCount = 0;
      
      words.forEach(w => {
        if (ambiguousTokens.has(w)) {
          hasAmbiguous = true;
        }
        if (supportTokens.has(w)) {
          supportCount++;
        }
      });

      if (hasAmbiguous && supportCount >= 2) {
        return true;
      }
      
      return false;
    };

    const checkStatementCrossCutting = (statement: string): boolean => {
      if (!statement) return false;
      const clean = statement.toLowerCase().trim();

      // 1. Check strong semantic anchor phrases
      if (
        clean.includes('tanggung jawab') ||
        clean.includes('evaluasi diri') ||
        clean.includes('profil lulusan') ||
        clean.includes('profil pelajar pancasila') ||
        clean.includes('pengembangan karakter') ||
        clean.includes('gotong royong')
      ) {
        return true;
      }

      // 2. Strong standalone concepts
      const strongKeywords = [
        'karakter', 'refleksi', 'kolaborasi', 'sikap', 'akhlak'
      ];

      const words = clean.replace(/[^a-zA-Z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
      if (words.some((w) => strongKeywords.includes(w))) {
        return true;
      }

      return false;
    };

    // 1. contentScope check (primary signal)
    if (tp.contentScope && checkSubstantiveCrossCutting(tp.contentScope)) {
      return true;
    }

    // 2. elementName check
    if (tp.elementName && checkSubstantiveCrossCutting(tp.elementName)) {
      return true;
    }

    // 3. statement check
    if (tp.statement && checkStatementCrossCutting(tp.statement)) {
      return true;
    }

    return false;
  };

  const areTpsSemanticallyRelated = (
    tpA?: (typeof validTpItems)[0],
    tpB?: (typeof validTpItems)[0]
  ): boolean => {
    if (!tpA || !tpB) return false;
    if (tpA.id === tpB.id) return true;

    // Direct contentScope match
    const scopeA = tpA.contentScope?.trim().toLowerCase();
    const scopeB = tpB.contentScope?.trim().toLowerCase();
    if (scopeA && scopeB && (scopeA === scopeB || scopeA.includes(scopeB) || scopeB.includes(scopeA))) {
      return true;
    }

    // scopeCode match
    const scA = tpA.scopeCode?.trim().toUpperCase();
    const scB = tpB.scopeCode?.trim().toUpperCase();
    if (scA && scB && scA === scB) {
      return true;
    }

    // Keyword overlap on scope or statement
    const kwA = extractKeywords(`${tpA.contentScope || ''} ${tpA.statement || ''}`);
    const kwB = extractKeywords(`${tpB.contentScope || ''} ${tpB.statement || ''}`);
    const overlap = kwA.filter((k) => kwB.includes(k));
    return overlap.length >= 1;
  };

  // Helper matching functions for existing Units / Materials
  const findBestExistingUnitMatchLocal = (u: any, existingUnits: any[]): any => {
    if (!Array.isArray(existingUnits) || existingUnits.length === 0) return null;
    if (u.id) {
      const match = existingUnits.find(eu => eu.id === u.id);
      if (match) return match;
    }
    let bestMatch: any = null;
    let maxOverlap = 0;
    const uAtpIds = new Set(u.linkedAtpItemIds || []);
    const uTpIds = new Set(u.linkedTpIds || []);
    for (const eu of existingUnits) {
      let overlapCount = 0;
      if (Array.isArray(eu.linkedAtpItemIds)) {
        eu.linkedAtpItemIds.forEach((id: string) => { if (uAtpIds.has(id)) overlapCount += 3; });
      }
      if (Array.isArray(eu.linkedTpIds)) {
        eu.linkedTpIds.forEach((id: string) => { if (uTpIds.has(id)) overlapCount += 1; });
      }
      if (overlapCount > maxOverlap) {
        maxOverlap = overlapCount;
        bestMatch = eu;
      }
    }
    if (maxOverlap > 0) return bestMatch;
    let bestTitleMatch: any = null;
    let maxTitleSimilarity = 0.4;
    const normTitleU = (u.title || '').toLowerCase().replace(/^(bab|unit)\s*\d*[:\-]?\s*/i, '').trim();
    const kwU = extractKeywords(normTitleU);
    for (const eu of existingUnits) {
      const normTitleEU = (eu.title || '').toLowerCase().replace(/^(bab|unit)\s*\d*[:\-]?\s*/i, '').trim();
      if (normTitleU === normTitleEU) return eu;
      const kwEU = extractKeywords(normTitleEU);
      const overlap = kwU.filter(k => kwEU.includes(k));
      const similarity = overlap.length / Math.max(1, Math.max(kwU.length, kwEU.length));
      if (similarity > maxTitleSimilarity) {
        maxTitleSimilarity = similarity;
        bestTitleMatch = eu;
      }
    }
    return bestTitleMatch;
  };

  const findBestExistingMaterialMatchLocal = (m: any, existingMaterials: any[]): any => {
    if (!Array.isArray(existingMaterials) || existingMaterials.length === 0) return null;
    if (m.id) {
      const match = existingMaterials.find(em => em.id === m.id);
      if (match) return match;
    }
    let bestMatch: any = null;
    let maxOverlap = 0;
    const mAtpIds = new Set(m.linkedAtpItemIds || []);
    const mTpIds = new Set(m.linkedTpIds || []);
    for (const em of existingMaterials) {
      let overlapCount = 0;
      if (Array.isArray(em.linkedAtpItemIds)) {
        em.linkedAtpItemIds.forEach((id: string) => { if (mAtpIds.has(id)) overlapCount += 3; });
      }
      if (Array.isArray(em.linkedTpIds)) {
        em.linkedTpIds.forEach((id: string) => { if (mTpIds.has(id)) overlapCount += 1; });
      }
      if (overlapCount > maxOverlap) {
        maxOverlap = overlapCount;
        bestMatch = em;
      }
    }
    if (maxOverlap > 0) return bestMatch;
    let bestTitleMatch: any = null;
    let maxTitleSimilarity = 0.4;
    const normTitleM = (m.title || '').toLowerCase().trim();
    const kwM = extractKeywords(normTitleM);
    for (const em of existingMaterials) {
      const normTitleEM = (em.title || '').toLowerCase().trim();
      if (normTitleM === normTitleEM) return em;
      const kwEM = extractKeywords(normTitleEM);
      const overlap = kwM.filter(k => kwEM.includes(k));
      const similarity = overlap.length / Math.max(1, Math.max(kwM.length, kwEM.length));
      if (similarity > maxTitleSimilarity) {
        maxTitleSimilarity = similarity;
        bestTitleMatch = em;
      }
    }
    return bestTitleMatch;
  };

  // If existingMapping has units, strictly preserve teacher structure and matching
  if (existingMapping && Array.isArray(existingMapping.units) && existingMapping.units.length > 0) {
    const updatedUnits = existingMapping.units.map((unit, uIdx) => {
      const order = unit.order || uIdx + 1;
      const linkedTpIds = (unit.linkedTpIds || []).filter((id) => tpMap.has(id));
      const linkedAtpItemIds = (unit.linkedAtpItemIds || []).filter((id) => atpMap.has(id));
      const linkedTps = linkedTpIds.map((id) => tpMap.get(id)).filter(Boolean);

      let unitTitle = unit.title?.trim();
      if (!unitTitle) {
        const fallbackTopic = linkedTps.length > 0 ? extractTopicFromTp(linkedTps[0]) : `Bagian ${order}`;
        unitTitle = `Bab ${order}: ${fallbackTopic}`;
      }

      let materials = Array.isArray(unit.materials) ? [...unit.materials] : [];
      if (materials.length > 0) {
        materials = materials.map((mat, mIdx) => {
          const matOrder = mat.order || mIdx + 1;
          const matLinkedTpIds = (mat.linkedTpIds || []).filter((id) => tpMap.has(id));
          const matLinkedAtpItemIds = (mat.linkedAtpItemIds || []).filter((id) => atpMap.has(id));

          let matTitle = mat.title?.trim();
          if (!matTitle) {
            const topic = matLinkedTpIds.length > 0 && tpMap.get(matLinkedTpIds[0])
              ? extractTopicFromTp(tpMap.get(matLinkedTpIds[0]))
              : (linkedTps[mIdx] ? extractTopicFromTp(linkedTps[mIdx]) : `Lingkup Materi ${matOrder}`);
            matTitle = topic;
          }

          return {
            id: mat.id || `mat-${Date.now()}-${uIdx + 1}-${matOrder}`,
            title: matTitle,
            order: matOrder,
            linkedTpIds: matLinkedTpIds.length > 0 ? matLinkedTpIds : [...linkedTpIds],
            linkedAtpItemIds: matLinkedAtpItemIds.length > 0 ? matLinkedAtpItemIds : [...linkedAtpItemIds],
          };
        });
      } else {
        const distinctScopes: string[] = [];
        linkedTps.forEach((tp) => {
          const t = extractTopicFromTp(tp);
          if (t && !distinctScopes.some((s) => s.toLowerCase() === t.toLowerCase())) {
            distinctScopes.push(t);
          }
        });

        if (distinctScopes.length > 0) {
          materials = distinctScopes.map((scopeTitle, mIdx) => {
            const supportingTps = linkedTps.filter((t) => extractTopicFromTp(t).toLowerCase() === scopeTitle.toLowerCase());
            const supportingTpIds = supportingTps.map((t) => t!.id);
            const matchingAtps = validAtpItems.filter((atp) => supportingTpIds.includes(atp.tpId || ''));
            return {
              id: `mat-${Date.now()}-${uIdx + 1}-${mIdx + 1}`,
              title: scopeTitle,
              order: mIdx + 1,
              linkedTpIds: supportingTpIds.length > 0 ? supportingTpIds : [...linkedTpIds],
              linkedAtpItemIds: matchingAtps.length > 0 ? matchingAtps.map((a) => a.id) : [...linkedAtpItemIds],
            };
          });
        } else {
          materials = [
            {
              id: `mat-${Date.now()}-${uIdx + 1}-1`,
              title: unitTitle.replace(/^Bab\s+\d+:\s*/i, ''),
              order: 1,
              linkedTpIds: [...linkedTpIds],
              linkedAtpItemIds: [...linkedAtpItemIds],
            },
          ];
        }
      }

      return {
        id: unit.id || `unit-${Date.now()}-${order}`,
        title: unitTitle,
        order,
        linkedTpIds,
        linkedAtpItemIds,
        materials,
      };
    });

    const resultMapping = {
      id: existingMapping.id || `aum-${Date.now()}`,
      academicSettingId: existingMapping.academicSettingId || academicSettingId,
      atpId: atpData.id || '',
      tpDataId: tpData.id || '',
      units: updatedUnits,
      basedOnTpUpdatedAt: tpData.updatedAt,
      basedOnAtpUpdatedAt: atpData.updatedAt,
      updatedAt: new Date().toISOString(),
    };
    return enforceCanonicalMappingInvariants(resultMapping, validTpItems, validAtpItems);
  }

  // Initial Generation: Deterministic Semantic Clustering along canonical ATP sequence
  const count = targetUnitCount ? Math.max(1, Math.min(20, targetUnitCount)) : undefined;

  // Split into cross-cutting and non-cross-cutting to prevent bridging
  const nonCrossCuttingAtpItems = validAtpItems.filter(atp => {
    const tp = atp.tpId ? tpMap.get(atp.tpId) : undefined;
    return !isCrossCuttingTp(tp);
  });
  const crossCuttingAtpItems = validAtpItems.filter(atp => {
    const tp = atp.tpId ? tpMap.get(atp.tpId) : undefined;
    return isCrossCuttingTp(tp);
  });

  const rawClusters: Array<(typeof validAtpItems)> = [];
  let currentCluster: (typeof validAtpItems) = [];

  nonCrossCuttingAtpItems.forEach((atp) => {
    if (currentCluster.length === 0) {
      currentCluster.push(atp);
    } else {
      const atpTp = atp.tpId ? tpMap.get(atp.tpId) : undefined;
      const clusterTps = currentCluster.map((a) => (a.tpId ? tpMap.get(a.tpId) : undefined)).filter(Boolean);
      const isRelated = clusterTps.some((cTp) => areTpsSemanticallyRelated(atpTp, cTp));

      if (isRelated) {
        currentCluster.push(atp);
      } else {
        rawClusters.push(currentCluster);
        currentCluster = [atp];
      }
    }
  });

  if (currentCluster.length > 0) {
    rawClusters.push(currentCluster);
  }

  let semanticClusters = rawClusters;
  if (semanticClusters.length === 0 && validAtpItems.length > 0) {
    semanticClusters = [[...validAtpItems]];
  }

  // Organic balancing against target count (only if count is specified)
  if (count) {
    while (semanticClusters.length > count && semanticClusters.length > 1) {
      let bestMergeIdx = 0;
      let highestSimilarity = -1;

      for (let i = 0; i < semanticClusters.length - 1; i++) {
        const c1 = semanticClusters[i];
        const c2 = semanticClusters[i + 1];
        const tp1 = c1.map((a) => (a.tpId ? tpMap.get(a.tpId) : undefined)).filter(Boolean);
        const tp2 = c2.map((a) => (a.tpId ? tpMap.get(a.tpId) : undefined)).filter(Boolean);

        let sim = 0;
        tp1.forEach((t1) => {
          tp2.forEach((t2) => {
            if (areTpsSemanticallyRelated(t1, t2)) sim += 2;
            const kw1 = extractKeywords(t1?.statement || '');
            const kw2 = extractKeywords(t2?.statement || '');
            sim += kw1.filter((k) => kw2.includes(k)).length;
          });
        });

        if (c1.length === 1 || c2.length === 1) sim += 1;

        if (sim > highestSimilarity) {
          highestSimilarity = sim;
          bestMergeIdx = i;
        }
      }

      const merged = [...semanticClusters[bestMergeIdx], ...semanticClusters[bestMergeIdx + 1]];
      semanticClusters.splice(bestMergeIdx, 2, merged);
    }
  }

  // Build Bab units from the semantic clusters
  const units: Array<{
    id: string;
    title: string;
    order: number;
    linkedTpIds: string[];
    linkedAtpItemIds: string[];
    materials: Array<{
      id: string;
      title: string;
      order: number;
      linkedTpIds: string[];
      linkedAtpItemIds: string[];
    }>;
  }> = [];

  semanticClusters.forEach((cluster, cIdx) => {
    const unitOrder = cIdx + 1;
    const unitId = `unit-${Date.now()}-${unitOrder}`;
    
    const linkedAtpItemIds = cluster.map((a) => a.id);
    const linkedTpIdsSet = new Set<string>();
    cluster.forEach((a) => {
      if (a.tpId && tpMap.has(a.tpId)) {
        linkedTpIdsSet.add(a.tpId);
      }
    });

    // 1. Link relevant cross-cutting ATP items using semantic relevance
    crossCuttingAtpItems.forEach((ccAtp) => {
      const ccTp = ccAtp.tpId ? tpMap.get(ccAtp.tpId) : undefined;
      if (!ccTp) return;

      const unitTps = Array.from(linkedTpIdsSet).map(id => tpMap.get(id)).filter(Boolean);
      
      const hasOverlap = unitTps.some(uTp => {
        if (ccTp.scopeCode && uTp.scopeCode && ccTp.scopeCode.trim().toUpperCase() === uTp.scopeCode.trim().toUpperCase()) {
          return true;
        }
        const ccScope = (ccTp.contentScope || '').toLowerCase().trim();
        const uScope = (uTp.contentScope || '').toLowerCase().trim();
        if (ccScope && uScope && (ccScope === uScope || ccScope.includes(uScope) || uScope.includes(ccScope))) {
          return true;
        }
        const kwCC = extractKeywords(`${ccTp.contentScope || ''} ${ccTp.statement || ''}`);
        const kwUTp = extractKeywords(`${uTp.contentScope || ''} ${uTp.statement || ''}`);
        return kwCC.some(k => kwUTp.includes(k));
      });

      const ccScopeClean = (ccTp.contentScope || '').toLowerCase().trim();
      
      const unspecificScopeCode = !ccTp.scopeCode || 
        ccTp.scopeCode.trim() === '' || 
        ccTp.scopeCode.trim().toUpperCase() === 'MAT' || 
        ccTp.scopeCode.trim().toUpperCase() === 'GEN';

      const cleanWords = ccScopeClean.replace(/[^a-zA-Z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
      const hasSpecificTopic = cleanWords.some(w => w.length > 2 && !SHARED_GENERIC_NEUTRAL_WORDS.has(w));

      const isTrulyGlobal = unspecificScopeCode && (!ccScopeClean || ccScopeClean === '' || !hasSpecificTopic);

      if (hasOverlap || isTrulyGlobal) {
        if (!linkedTpIdsSet.has(ccAtp.tpId!)) {
          linkedTpIdsSet.add(ccAtp.tpId!);
        }
        if (!linkedAtpItemIds.includes(ccAtp.id)) {
          linkedAtpItemIds.push(ccAtp.id);
        }
      }
    });

    const linkedTpIds = Array.from(linkedTpIdsSet);
    const linkedTps = linkedTpIds.map((id) => tpMap.get(id)).filter(Boolean);

    // Determine representative Bab title from dominant content scope
    let mainTopic = '';
    const nonCrossCuttingTps = linkedTps.filter((t) => !isCrossCuttingTp(t));
    const titleCandidates = (nonCrossCuttingTps.length > 0 ? nonCrossCuttingTps : linkedTps)
      .map((t) => extractTopicFromTp(t))
      .filter((s) => s.length > 0);

    if (titleCandidates.length > 0) {
      mainTopic = titleCandidates[0];
    } else {
      mainTopic = `Materi Pembelajaran Bagian ${unitOrder}`;
    }

    const unitTitle = `Bab ${unitOrder}: ${mainTopic.replace(/^(bab|unit)\s*\d*[:\-]?\s*/i, '')}`;

    // Decompose into distinct supported Lingkup Materi
    const materials: Array<{
      id: string;
      title: string;
      order: number;
      linkedTpIds: string[];
      linkedAtpItemIds: string[];
    }> = [];

    const distinctScopeMap = new Map<string, { tpIds: Set<string>; atpIds: Set<string> }>();

    // 2. Build primary materials from non-cross-cutting TPs
    const nonCCTps = linkedTps.filter(tp => !isCrossCuttingTp(tp));
    const ccTps = linkedTps.filter(tp => isCrossCuttingTp(tp));

    const tpsToProcess = nonCCTps.length > 0 ? nonCCTps : linkedTps;
    tpsToProcess.forEach((tp) => {
      const scopeTitle = extractTopicFromTp(tp);
      const normalizedKey = scopeTitle.toLowerCase().trim();

      if (!distinctScopeMap.has(normalizedKey)) {
        distinctScopeMap.set(normalizedKey, { tpIds: new Set(), atpIds: new Set() });
      }

      const entry = distinctScopeMap.get(normalizedKey)!;
      entry.tpIds.add(tp.id);
      validAtpItems
        .filter((a) => a.tpId === tp.id && linkedAtpItemIds.includes(a.id))
        .forEach((a) => entry.atpIds.add(a.id));
    });

    // 2b. Match cross-cutting TPs to primary materials if there is semantic evidence
    ccTps.forEach((ccTp) => {
      let matchedMaterialKey: string | null = null;
      let highestSim = 0;

      distinctScopeMap.forEach((entry, normKey) => {
        const firstTpId = Array.from(entry.tpIds)[0];
        const mTp = tpMap.get(firstTpId);
        if (!mTp) return;

        let sim = 0;
        if (ccTp.scopeCode && mTp.scopeCode && ccTp.scopeCode.trim().toUpperCase() === mTp.scopeCode.trim().toUpperCase()) {
          sim += 10;
        }
        const ccScope = (ccTp.contentScope || '').toLowerCase().trim();
        const mScope = (mTp.contentScope || '').toLowerCase().trim();
        if (ccScope && mScope && (ccScope === mScope || ccScope.includes(mScope) || mScope.includes(ccScope))) {
          sim += 5;
        }
        const kwCC = extractKeywords(`${ccTp.contentScope || ''} ${ccTp.statement || ''}`);
        const kwMTp = extractKeywords(`${mTp.contentScope || ''} ${mTp.statement || ''}`);
        sim += kwCC.filter(k => kwMTp.includes(k)).length;

        if (sim > highestSim && sim >= 2) {
          highestSim = sim;
          matchedMaterialKey = normKey;
        }
      });

      if (matchedMaterialKey) {
        const entry = distinctScopeMap.get(matchedMaterialKey)!;
        entry.tpIds.add(ccTp.id);
        validAtpItems
          .filter((a) => a.tpId === ccTp.id && linkedAtpItemIds.includes(a.id))
          .forEach((a) => entry.atpIds.add(a.id));
      }
    });

    let matIndex = 1;
    distinctScopeMap.forEach((entry, normKey) => {
      const originalTp = linkedTps.find((t) => extractTopicFromTp(t).toLowerCase().trim() === normKey);
      const title = originalTp ? extractTopicFromTp(originalTp) : normKey;

      const matTpIds = Array.from(entry.tpIds);
      const matAtpIds = Array.from(entry.atpIds);

      let finalMatAtpIds = matAtpIds;
      if (finalMatAtpIds.length === 0) {
        finalMatAtpIds = validAtpItems
          .filter((a) => a.tpId && matTpIds.includes(a.tpId) && linkedAtpItemIds.includes(a.id))
          .map((a) => a.id);
      }

      materials.push({
        id: `mat-${Date.now()}-${unitOrder}-${matIndex}`,
        title,
        order: matIndex,
        linkedTpIds: matTpIds,
        linkedAtpItemIds: finalMatAtpIds,
      });
      matIndex++;
    });

    if (materials.length === 0) {
      const nonCCTpIds = nonCCTps.map(t => t.id);
      const nonCCAtpIds = validAtpItems.filter(a => a.tpId && nonCCTpIds.includes(a.tpId) && linkedAtpItemIds.includes(a.id)).map(a => a.id);

      materials.push({
        id: `mat-${Date.now()}-${unitOrder}-1`,
        title: mainTopic.replace(/^(bab|unit)\s*\d*[:\-]?\s*/i, ''),
        order: 1,
        linkedTpIds: nonCCTpIds.length > 0 ? nonCCTpIds : linkedTpIds,
        linkedAtpItemIds: nonCCAtpIds.length > 0 ? nonCCAtpIds : linkedAtpItemIds,
      });
    }

    units.push({
      id: unitId,
      title: unitTitle,
      order: unitOrder,
      linkedTpIds,
      linkedAtpItemIds,
      materials,
    });
  });

  const finalMapping = {
    id: `aum-${Date.now()}`,
    academicSettingId,
    atpId: atpData.id || '',
    tpDataId: tpData.id || '',
    units,
    basedOnTpUpdatedAt: tpData.updatedAt,
    basedOnAtpUpdatedAt: atpData.updatedAt,
    updatedAt: new Date().toISOString(),
  };

  return enforceCanonicalMappingInvariants(finalMapping, validTpItems, validAtpItems);
}

export function enforceCanonicalMappingInvariants(
  mapping: any,
  validTpItems: any[],
  validAtpItems: any[]
): any {
  if (!mapping || !Array.isArray(mapping.units)) return mapping;

  const tpMap = new Map<string, any>();
  validTpItems.forEach((tp) => tpMap.set(tp.id, tp));

  const atpMap = new Map<string, any>();
  validAtpItems.forEach((atp) => atpMap.set(atp.id, atp));

  const seenUnitIds = new Set<string>();
  const seenMaterialIds = new Set<string>();

  mapping.units.forEach((unit: any, uIdx: number) => {
    if (!unit.id || seenUnitIds.has(unit.id)) {
      unit.id = `unit-sanitized-${Date.now()}-${uIdx}-${Math.random().toString(36).substring(2, 6)}`;
    }
    seenUnitIds.add(unit.id);

    if (Array.isArray(unit.materials)) {
      unit.materials.forEach((mat: any, mIdx: number) => {
        if (!mat.id || seenMaterialIds.has(mat.id)) {
          mat.id = `mat-sanitized-${Date.now()}-${uIdx}-${mIdx}-${Math.random().toString(36).substring(2, 6)}`;
        }
        seenMaterialIds.add(mat.id);
      });
    }
  });

  mapping.units.forEach((unit: any) => {
    let unitTpIds = (Array.isArray(unit.linkedTpIds) ? unit.linkedTpIds : [])
      .filter((id: string) => tpMap.has(id));
    let unitAtpIds = (Array.isArray(unit.linkedAtpItemIds) ? unit.linkedAtpItemIds : [])
      .filter((id: string) => atpMap.has(id));

    unitAtpIds.forEach((atpId: string) => {
      const atp = atpMap.get(atpId);
      if (atp && atp.tpId && !unitTpIds.includes(atp.tpId)) {
        unitTpIds.push(atp.tpId);
      }
    });

    unit.linkedTpIds = Array.from(new Set(unitTpIds));
    unit.linkedAtpItemIds = Array.from(new Set(unitAtpIds));

    if (Array.isArray(unit.materials)) {
      unit.materials.forEach((mat: any) => {
        let matTpIds = (Array.isArray(mat.linkedTpIds) ? mat.linkedTpIds : [])
          .filter((id: string) => tpMap.has(id) && unit.linkedTpIds.includes(id));
        let matAtpIds = (Array.isArray(mat.linkedAtpItemIds) ? mat.linkedAtpItemIds : [])
          .filter((id: string) => atpMap.has(id) && unit.linkedAtpItemIds.includes(id));

        matAtpIds.forEach((atpId: string) => {
          const atp = atpMap.get(atpId);
          if (atp && atp.tpId && !matTpIds.includes(atp.tpId)) {
            matTpIds.push(atp.tpId);
          }
        });

        matTpIds.forEach((tpId: string) => {
          const hasSupportingAtp = matAtpIds.some(atpId => atpMap.get(atpId)?.tpId === tpId);
          if (!hasSupportingAtp) {
            const unitAtpItemsForTp = unit.linkedAtpItemIds.filter((atpId: string) => atpMap.get(atpId)?.tpId === tpId);
            unitAtpItemsForTp.forEach((atpId: string) => {
              if (!matAtpIds.includes(atpId)) {
                matAtpIds.push(atpId);
              }
            });
          }
        });

        mat.linkedTpIds = Array.from(new Set(matTpIds));
        mat.linkedAtpItemIds = Array.from(new Set(matAtpIds));
      });
    }
  });

  const coveredAtpItemIds = new Set<string>();
  mapping.units.forEach((u: any) => {
    (u.linkedAtpItemIds || []).forEach((id: string) => coveredAtpItemIds.add(id));
  });

  const missingAtpItems = validAtpItems.filter(atp => !coveredAtpItemIds.has(atp.id));
  if (missingAtpItems.length > 0) {
    missingAtpItems.forEach(atp => {
      const tp = atp.tpId ? tpMap.get(atp.tpId) : undefined;
      if (!tp) return;

      let bestUnit: any = null;
      let highestUnitSim = 0;

      mapping.units.forEach((u: any) => {
        let sim = 0;
        const uTps = (u.linkedTpIds || []).map((id: string) => tpMap.get(id)).filter(Boolean);
        uTps.forEach((uTp: any) => {
          if (tp.scopeCode && uTp.scopeCode && tp.scopeCode.trim().toUpperCase() === uTp.scopeCode.trim().toUpperCase()) {
            sim += 10;
          }
          const ccScope = (tp.contentScope || '').toLowerCase().trim();
          const uScope = (uTp.contentScope || '').toLowerCase().trim();
          if (ccScope && uScope && (ccScope === uScope || ccScope.includes(uScope) || uScope.includes(ccScope))) {
            sim += 5;
          }
          const kw1 = (tp.contentScope || tp.statement || '').toLowerCase().split(/\s+/).filter((s: string) => s.length > 2);
          const kw2 = (uTp.contentScope || uTp.statement || '').toLowerCase().split(/\s+/).filter((s: string) => s.length > 2);
          sim += kw1.filter((k: string) => kw2.includes(k)).length;
        });

        if (sim > highestUnitSim) {
          highestUnitSim = sim;
          bestUnit = u;
        }
      });

      if (bestUnit && highestUnitSim >= 2) {
        if (!bestUnit.linkedTpIds.includes(tp.id)) {
          bestUnit.linkedTpIds.push(tp.id);
        }
        if (!bestUnit.linkedAtpItemIds.includes(atp.id)) {
          bestUnit.linkedAtpItemIds.push(atp.id);
        }

        let bestMat: any = null;
        let highestMatSim = 0;

        bestUnit.materials.forEach((mat: any) => {
          let sim = 0;
          const matTps = (mat.linkedTpIds || []).map((id: string) => tpMap.get(id)).filter(Boolean);
          matTps.forEach((mTp: any) => {
            if (tp.scopeCode && mTp.scopeCode && tp.scopeCode.trim().toUpperCase() === mTp.scopeCode.trim().toUpperCase()) {
              sim += 10;
            }
            const ccScope = (tp.contentScope || '').toLowerCase().trim();
            const mScope = (mTp.contentScope || '').toLowerCase().trim();
            if (ccScope && mScope && (ccScope === mScope || ccScope.includes(mScope) || mScope.includes(ccScope))) {
              sim += 5;
            }
            const kw1 = (tp.contentScope || tp.statement || '').toLowerCase().split(/\s+/).filter((s: string) => s.length > 2);
            const kw2 = (mTp.contentScope || mTp.statement || '').toLowerCase().split(/\s+/).filter((s: string) => s.length > 2);
            sim += kw1.filter((k: string) => kw2.includes(k)).length;
          });

          if (sim > highestMatSim) {
            highestMatSim = sim;
            bestMat = mat;
          }
        });

        if (bestMat && highestMatSim >= 2) {
          if (!bestMat.linkedTpIds.includes(tp.id)) {
            bestMat.linkedTpIds.push(tp.id);
          }
          if (!bestMat.linkedAtpItemIds.includes(atp.id)) {
            bestMat.linkedAtpItemIds.push(atp.id);
          }
        } else {
          const matOrder = bestUnit.materials.length + 1;
          const newMatTitle = tp.contentScope || tp.statement || `Materi ${matOrder}`;
          bestUnit.materials.push({
            id: `mat-recovered-${Date.now()}-${bestUnit.id}-${matOrder}`,
            title: newMatTitle.length > 80 ? `${newMatTitle.substring(0, 77)}...` : newMatTitle,
            order: matOrder,
            linkedTpIds: [tp.id],
            linkedAtpItemIds: [atp.id]
          });
        }
      } else {
        const newUnitOrder = mapping.units.length + 1;
        const uTitle = tp.contentScope || tp.statement || `Unit ${newUnitOrder}`;
        const newUnitTitle = `Bab ${newUnitOrder}: ${uTitle.length > 60 ? `${uTitle.substring(0, 57)}...` : uTitle}`;
        const newUnitId = `unit-recovered-${Date.now()}-${newUnitOrder}`;

        mapping.units.push({
          id: newUnitId,
          title: newUnitTitle,
          order: newUnitOrder,
          linkedTpIds: [tp.id],
          linkedAtpItemIds: [atp.id],
          materials: [
            {
              id: `mat-recovered-${Date.now()}-${newUnitId}-1`,
              title: tp.contentScope || tp.statement || `Materi 1`,
              order: 1,
              linkedTpIds: [tp.id],
              linkedAtpItemIds: [atp.id]
            }
          ]
        });
      }
    });
  }

  mapping.units.sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
  mapping.units.forEach((unit: any) => {
    if (Array.isArray(unit.materials)) {
      unit.materials.sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
    }
  });

  return mapping;
}



