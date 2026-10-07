import {
  CPElem,
  TPItem,
  ATPItem,
  AcademicSetting,
  LearningPlan,
  TPData,
  ATPData,
  CPAnalysisData,
  ATPUnitMappingData,
  UnitExecutionPlanData,
  AssessmentCriterion,
} from '../types';
import { CognitiveAdaptationProfile, getCognitiveAdaptationProfile } from './cognitiveAdaptationService';
import {
  normalizeLearningExperiencePhase,
  normalizeAIAssessmentPlan,
  normalizeAIReflection,
  normalizeDeepLearningContext,
  normalizeAIResources,
} from './learningPlanService';

export interface CanonicalCPAnalysisResult {
  generalSummary: string;
  items: Array<{
    elementId?: string;
    elementName: string;
    scopeCode?: string;
    cpText?: string;
    cpCompetence: string;
    materialScope: string;
    meaningfulUnderstanding?: string;
    suggestedTp?: string;
  }>;
  engine?: 'gemini' | 'pedagogical_engine';
}

export interface GenerateTPParams {
  cpGeneral: string;
  cpElements: CPElem[];
  cpAnalysisItems?: any[];
  existingTps?: TPItem[];
  subject: string;
  grade: string;
  phase: string;
  curriculum: string;
  count?: number;
}

export interface GenerateTPResult {
  items: TPItem[];
  engine: 'gemini' | 'pedagogical_engine';
}

export interface GenerateATPParams {
  tps: TPItem[];
  cpGeneral: string;
  subject: string;
  grade: string;
  phase: string;
  academicYear: string;
  curriculum?: string;
  semester?: string;
  totalHoursPerWeek?: number;
}

export interface GenerateATPResult {
  rationale: string;
  items: Omit<ATPItem, 'id'>[];
}

export const GEMINI_API_KEY_STORAGE_KEY = 'alco_admin_gemini_api_key';

let inMemoryKey: string | null = null;

export function getGeminiApiKey(): string | null {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(GEMINI_API_KEY_STORAGE_KEY) || null;
    }
    return inMemoryKey;
  } catch {
    return inMemoryKey;
  }
}

export function saveGeminiApiKey(key: string): void {
  const trimmed = key.trim();
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(GEMINI_API_KEY_STORAGE_KEY, trimmed);
    }
    inMemoryKey = trimmed;
    notifyApiKeyUpdated(trimmed);
  } catch {
    inMemoryKey = trimmed;
    notifyApiKeyUpdated(trimmed);
  }
}

export function removeGeminiApiKey(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(GEMINI_API_KEY_STORAGE_KEY);
    }
    inMemoryKey = null;
    notifyApiKeyRemoved();
  } catch {
    inMemoryKey = null;
    notifyApiKeyRemoved();
  }
}

type KeyResolver = (key: string) => void;
type KeyRejecter = (err: Error) => void;

interface PendingKeyRequest {
  resolve: KeyResolver;
  reject: KeyRejecter;
}

let pendingRequests: PendingKeyRequest[] = [];
let modalOpenListeners: ((isOpen: boolean, initialError?: string) => void)[] = [];

export function subscribeApiKeyModal(listener: (isOpen: boolean, initialError?: string) => void): () => void {
  modalOpenListeners.push(listener);
  return () => {
    modalOpenListeners = modalOpenListeners.filter((l) => l !== listener);
  };
}

export function openApiKeyModal(initialError?: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    pendingRequests.push({ resolve, reject });
    modalOpenListeners.forEach((listener) => listener(true, initialError));
  });
}

export function closeApiKeyModal(): void {
  const err = new Error('Penyusunan AI dibatalkan: Kunci API Gemini diperlukan.');
  const requests = [...pendingRequests];
  pendingRequests = [];
  modalOpenListeners.forEach((listener) => listener(false));
  requests.forEach((r) => r.reject(err));
}

export function submitApiKeyFromModal(key: string): void {
  const trimmed = key.trim();
  if (!trimmed) return;
  saveGeminiApiKey(trimmed);
}

function notifyApiKeyUpdated(key: string): void {
  const requests = [...pendingRequests];
  pendingRequests = [];
  modalOpenListeners.forEach((listener) => listener(false));
  requests.forEach((r) => r.resolve(key));
}

function notifyApiKeyRemoved(): void {
  // Key removed
}

export async function ensureGeminiApiKey(): Promise<string> {
  const existing = getGeminiApiKey();
  if (existing && existing.trim()) {
    return existing.trim();
  }
  if (modalOpenListeners.length > 0) {
    return await openApiKeyModal();
  }
  return '';
}

export async function aiFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const makeRequest = async (currentKey?: string | null): Promise<Response> => {
    const headers = new Headers(options.headers || {});
    if (currentKey && currentKey.trim()) {
      headers.set('X-Gemini-API-Key', currentKey.trim());
    } else {
      headers.delete('X-Gemini-API-Key');
    }
    return fetch(url, {
      ...options,
      headers,
    });
  };

  // 1. Request PERTAMA tanpa local BYOK header agar server mendapat kesempatan memakai server key/fallback
  let res = await makeRequest(null);

  // 2. Jika response 200 adalah pedagogical_engine fallback DAN user punya local BYOK,
  // beri prioritas pada Gemini dengan retry TEPAT SATU KALI memakai key user.
  const localKey = getGeminiApiKey();
  if (res.ok && localKey && localKey.trim()) {
    try {
      const cloned = res.clone();
      const bodyJson = await cloned.json().catch(() => null);
      if (bodyJson && bodyJson.engine === 'pedagogical_engine') {
        const retryRes = await makeRequest(localKey.trim());
        if (retryRes.ok) {
          return retryRes;
        }
        if (retryRes.status === 401 || retryRes.status === 403) {
          removeGeminiApiKey();
        }
        // Jika retry gagal non-auth, gunakan hasil fallback pertama yang valid
        return res;
      }
    } catch {
      // not json or clone failed, return original res
      return res;
    }
  }

  if (res.ok) {
    return res;
  }

  // 3. Penanganan 401 / 403 pada request pertama (berasal dari server key / provider server, BUKAN local BYOK user):
  if (res.status === 401 || res.status === 403) {
    if (localKey && localKey.trim()) {
      // Jangan hapus local key karena belum pernah dikirim. Retry tepat satu kali dengan local key.
      const retryRes = await makeRequest(localKey.trim());
      if (retryRes.ok) {
        return retryRes;
      }

      // Jika request yang BENAR-BENAR membawa local key menghasilkan 401/403, barulah key dianggap invalid
      if (retryRes.status === 401 || retryRes.status === 403) {
        removeGeminiApiKey();
        if (modalOpenListeners.length > 0) {
          try {
            const newKey = await openApiKeyModal(
              'Kunci API Gemini tidak valid atau izin ditolak (401/403). Silakan periksa kembali dan masukkan API Key yang benar:'
            );
            if (newKey && newKey.trim()) {
              return await makeRequest(newKey.trim());
            }
          } catch {
            // Modal cancelled
          }
        }
      }
      return retryRes;
    } else {
      // Tidak ada local BYOK: buka modal jika listener tersedia
      if (modalOpenListeners.length > 0) {
        try {
          const newKey = await openApiKeyModal(
            'Layanan AI memerlukan API Key Gemini (BYOK). Silakan masukkan API Key Anda:'
          );
          if (newKey && newKey.trim()) {
            return await makeRequest(newKey.trim());
          }
        } catch {
          // Modal cancelled
        }
      }
      return res;
    }
  }

  // 4. Penanganan 503 + AI_NOT_CONFIGURED
  let isNotConfigured = false;
  if (res.status === 503) {
    try {
      const cloned = res.clone();
      const bodyJson = await cloned.json().catch(() => null);
      if (
        bodyJson &&
        (bodyJson.code === 'AI_NOT_CONFIGURED' ||
          (typeof bodyJson.error === 'string' && bodyJson.error.toLowerCase().includes('belum dikonfigurasi')))
      ) {
        isNotConfigured = true;
      }
    } catch {
      // not json or clone failed
    }
  }

  if (isNotConfigured) {
    let keyForRetry = localKey && localKey.trim() ? localKey.trim() : null;
    if (!keyForRetry && modalOpenListeners.length > 0) {
      try {
        keyForRetry = await openApiKeyModal(
          'Layanan AI belum dikonfigurasi pada server. Silakan masukkan API Key Gemini Anda (BYOK):'
        );
      } catch {
        keyForRetry = null;
      }
    }

    if (keyForRetry && keyForRetry.trim()) {
      const retryRes = await makeRequest(keyForRetry.trim());
      if (retryRes.status === 401 || retryRes.status === 403) {
        removeGeminiApiKey();
        if (modalOpenListeners.length > 0) {
          try {
            const freshKey = await openApiKeyModal(
              'Kunci API Gemini tidak valid atau izin ditolak (401/403). Silakan periksa kembali dan masukkan API Key yang benar:'
            );
            if (freshKey && freshKey.trim()) {
              return await makeRequest(freshKey.trim());
            }
          } catch {
            // Modal cancelled
          }
        }
      }
      return retryRes;
    }
  }

  return res;
}

/**
 * Maps raw backend or fetch errors into a clear, user-friendly Indonesian explanation.
 */
export function formatAIErrorMessage(error: any, actionName: string = 'memproses permintaan'): string {
  if (!error) return `Terjadi kendala saat ${actionName}. Silakan coba lagi.`;
  const raw = (error.message || String(error)).toLowerCase();

  if (raw.includes('layanan ai belum dikonfigurasi') || raw.includes('ai_not_configured')) {
    return 'Layanan AI belum dikonfigurasi pada server.';
  }
  if (raw.includes('starting server') || raw.includes('runtime preview sedang memulai ulang')) {
    return 'Runtime preview sedang memulai ulang atau mengintersep respons API.';
  }
  if (raw.includes('503') || raw.includes('high demand') || raw.includes('unavailable') || raw.includes('spikes in demand')) {
    return 'Layanan AI sedang mengalami lonjakan antrean trafik tinggi. Silakan klik tombol "Coba Lagi" dalam beberapa detik.';
  }
  if (raw.includes('429') || raw.includes('quota') || raw.includes('rate limit')) {
    return 'Batas kuota AI sementara tercapai. Mohon tunggu sebentar lalu coba kembali.';
  }
  if (raw.includes('failed to fetch') || raw.includes('network') || raw.includes('econnrefused')) {
    return 'Gagal terhubung ke server backend AI. Pastikan koneksi internet Anda aktif dan server berjalan.';
  }
  if (raw.includes('api key') || raw.includes('unauthorized') || raw.includes('401') || raw.includes('403')) {
    return 'Kunci API Gemini tidak valid atau belum dikonfigurasi. Silakan periksa kembali API Key Anda.';
  }
  if (raw.includes('timeout') || raw.includes('timed out')) {
    return 'Permintaan AI membutuhkan waktu terlalu lama. Silakan coba kembali dengan cakupan data yang lebih spesifik.';
  }

  return error.message || `Terjadi kesalahan saat ${actionName}. Silakan periksa kembali data Anda.`;
}

export async function analyzeCPWithAI(params: {
  cpText: string;
  elements: CPElem[];
  subject: string;
  grade: string;
  phase: string;
  curriculum: string;
}): Promise<CanonicalCPAnalysisResult> {
  try {
    const res = await aiFetch('/api/ai/analyze-cp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      if (errData.code === 'AI_NOT_CONFIGURED') {
        throw new Error('Layanan AI belum dikonfigurasi pada server.');
      }
      throw new Error(errData.error || `Gagal menganalisis CP (Status ${res.status})`);
    }

    const data = await res.json();
    const payload = data.data || data;
    return {
      ...payload,
      engine: data.engine === 'gemini' ? 'gemini' : 'pedagogical_engine',
    };
  } catch (err) {
    throw new Error(formatAIErrorMessage(err, 'menganalisis Capaian Pembelajaran'));
  }
}

export async function generateTPWithAI(params: GenerateTPParams): Promise<GenerateTPResult> {
  try {
    const { existingTps, ...payloadToSend } = params;
    const res = await aiFetch('/api/ai/generate-tp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payloadToSend),
    });

    const contentType = res.headers.get('Content-Type') || '';
    if (!contentType.includes('application/json')) {
      const text = await res.text().catch(() => '');
      if (text.includes('Starting Server')) {
        throw new Error('Runtime preview sedang memulai ulang atau mengintersep respons API.');
      }
      const mime = contentType.split(';')[0]?.trim() || contentType || 'unknown';
      throw new Error(`Endpoint AI TP tidak mengembalikan JSON (received ${mime}). (Status ${res.status})`);
    }

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      if (errData.code === 'AI_NOT_CONFIGURED') {
        throw new Error('Layanan AI belum dikonfigurasi pada server.');
      }
      throw new Error(errData.error || `Gagal menghasilkan TP dengan AI (Status ${res.status})`);
    }

    const data = await res.json();
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new Error('Respons AI TP tidak valid: format data harus berupa objek.');
    }
    if (!Array.isArray(data.items) || data.items.length === 0) {
      throw new Error('Respons AI TP tidak valid: "items" harus berupa array dan tidak boleh kosong.');
    }
    if (
      data.engine &&
      data.engine !== 'gemini' &&
      data.engine !== 'pedagogical_engine'
    ) {
      throw new Error('Respons AI TP tidak memiliki provenance engine yang valid.');
    }
    const resolvedEngine = (data.engine === 'pedagogical_engine' ? 'pedagogical_engine' : 'gemini') as 'gemini' | 'pedagogical_engine';
    for (let i = 0; i < data.items.length; i++) {
      const item = data.items[i];
      if (!item || typeof item !== 'object') {
        throw new Error(`Respons AI TP tidak valid: butir ke-${i + 1} bukan objek.`);
      }
      const stmt = item.statement || item.description;
      if (!stmt || typeof stmt !== 'string' || stmt.trim() === '') {
        throw new Error(`Respons AI TP tidak valid: butir ke-${i + 1} tidak memiliki statement/description yang sah.`);
      }
    }

    return {
      items: mergeGeneratedTPsWithExisting(
        data.items,
        params.existingTps || [],
        params.cpAnalysisItems || []
      ),
      engine: resolvedEngine,
    };
  } catch (err) {
    throw new Error(formatAIErrorMessage(err, 'merumuskan Tujuan Pembelajaran'));
  }
}

/**
 * Deterministic safe merge for TP regeneration.
 * Matches generated TPs to existing TPs using cpAnalysisItemIds, elementName, contentScope, statement.
 * Strictly preserves existing TPItem.id and teacher work. Never carries over stale cpAnalysisItemIds.
 */
export function mergeGeneratedTPsWithExisting(
  generatedItems: Array<Partial<TPItem>>,
  existingItems: TPItem[] = [],
  activeAnalysisItems: Array<{ id: string }> = []
): TPItem[] {
  const activeAnalysisItemIds = new Set<string>(
    activeAnalysisItems.map((a) => String(a.id)).filter(Boolean)
  );
  const hasCanonicalAnalysis = activeAnalysisItemIds.size > 0;

  if (!existingItems || existingItems.length === 0) {
    return generatedItems.map((g, idx) => {
      const stmt = g.statement || (g as any).description || '';
      return {
        id: g.id || `tp-item-${Date.now()}-${idx + 1}-${Math.random().toString(36).substring(2, 6)}`,
        code: g.code || `TP ${idx + 1}`,
        elementName: g.elementName || '',
        statement: stmt,
        description: stmt,
        competence: g.competence || '',
        contentScope: g.contentScope || '',
        p3Dimensions: Array.isArray(g.p3Dimensions) ? g.p3Dimensions : [],
        order: idx + 1,
        cpAnalysisItemIds: Array.isArray(g.cpAnalysisItemIds) ? g.cpAnalysisItemIds : [],
      };
    });
  }

  const matchedExistingIds = new Set<string>();
  const result: TPItem[] = [];

  const calculateMatchScore = (gen: Partial<TPItem>, exist: TPItem): number => {
    let score = 0;

    // 1. cpAnalysisItemIds overlap (highest priority)
    const genAnalysisIds = Array.isArray(gen.cpAnalysisItemIds) ? gen.cpAnalysisItemIds : [];
    const existAnalysisIds = Array.isArray(exist.cpAnalysisItemIds) ? exist.cpAnalysisItemIds : [];
    if (genAnalysisIds.length > 0 && existAnalysisIds.length > 0) {
      const overlap = genAnalysisIds.filter((id) => existAnalysisIds.includes(id));
      if (overlap.length > 0) {
        score += 10 * overlap.length;
      }
    }

    // 2. Exact or substring match on elementName
    const genElem = (gen.elementName || '').trim().toLowerCase();
    const existElem = (exist.elementName || '').trim().toLowerCase();
    if (genElem && existElem && (genElem === existElem || genElem.includes(existElem) || existElem.includes(genElem))) {
      score += 4;
    }

    // 3. Exact or keyword match on contentScope
    const genScope = (gen.contentScope || '').trim().toLowerCase();
    const existScope = (exist.contentScope || '').trim().toLowerCase();
    if (genScope && existScope && (genScope === existScope || genScope.includes(existScope) || existScope.includes(genScope))) {
      score += 5;
    }

    // 4. Code match
    const genCode = (gen.code || '').trim().toLowerCase();
    const existCode = (exist.code || '').trim().toLowerCase();
    if (genCode && existCode && genCode === existCode) {
      score += 3;
    }

    // 5. Statement similarity (supporting fallback)
    const genStmt = (gen.statement || (gen as any).description || '').trim().toLowerCase();
    const existStmt = (exist.statement || exist.description || '').trim().toLowerCase();
    if (genStmt && existStmt) {
      if (genStmt === existStmt) {
        score += 6;
      } else {
        const wordsGen = genStmt.split(/\s+/).filter((w) => w.length > 3);
        const wordsExist = existStmt.split(/\s+/).filter((w) => w.length > 3);
        const wordOverlap = wordsGen.filter((w) => wordsExist.includes(w)).length;
        if (wordOverlap >= 2) {
          score += 2;
        }
      }
    }

    return score;
  };

  for (let i = 0; i < generatedItems.length; i++) {
    const gen = generatedItems[i];
    let bestMatch: TPItem | null = null;
    let highestScore = 3;

    for (const exist of existingItems) {
      if (matchedExistingIds.has(exist.id)) continue;
      const score = calculateMatchScore(gen, exist);
      if (score > highestScore) {
        highestScore = score;
        bestMatch = exist;
      }
    }

    if (bestMatch) {
      matchedExistingIds.add(bestMatch.id);
      // Strictly PRESERVE existing TPItem.id!
      const isSemantic = (c?: string) => typeof c === 'string' && /^E\d+-[A-Za-z0-9]+-\d{2}$/.test(c.trim());
      const finalCode = bestMatch.code && isSemantic(bestMatch.code)
        ? bestMatch.code.trim().toUpperCase()
        : (gen.code || bestMatch.code || `E1-MAT-${String(result.length + 1).padStart(2, '0')}`);
      const finalScopeCode = bestMatch.scopeCode || gen.scopeCode;
      const finalStatement = bestMatch.statement?.trim() ? bestMatch.statement : (gen.statement || (gen as any).description || '');
      const finalElementName = bestMatch.elementName?.trim() ? bestMatch.elementName : (gen.elementName || '');
      const finalCompetence = bestMatch.competence?.trim() ? bestMatch.competence : (gen.competence || '');
      const finalContentScope = bestMatch.contentScope?.trim() ? bestMatch.contentScope : (gen.contentScope || '');
      const finalP3 = (bestMatch.p3Dimensions && bestMatch.p3Dimensions.length > 0)
        ? bestMatch.p3Dimensions
        : (Array.isArray(gen.p3Dimensions) ? gen.p3Dimensions : []);

      // Canonical lineage resolution: do NOT union with stale existing lineage.
      const genIds = Array.isArray(gen.cpAnalysisItemIds) ? gen.cpAnalysisItemIds : [];
      const existIds = Array.isArray(bestMatch.cpAnalysisItemIds) ? bestMatch.cpAnalysisItemIds : [];

      let finalAnalysisIds: string[];
      if (genIds.length > 0) {
        finalAnalysisIds = genIds;
      } else if (hasCanonicalAnalysis) {
        finalAnalysisIds = existIds.filter((id) => activeAnalysisItemIds.has(id));
      } else {
        finalAnalysisIds = existIds;
      }

      result.push({
        ...bestMatch,
        id: bestMatch.id, // Stable ID preserved!
        code: finalCode,
        scopeCode: finalScopeCode,
        elementName: finalElementName,
        statement: finalStatement,
        description: finalStatement,
        competence: finalCompetence,
        contentScope: finalContentScope,
        p3Dimensions: finalP3,
        cpAnalysisItemIds: finalAnalysisIds,
        order: result.length + 1,
      });
    } else {
      // New genuinely supported TP
      const stmt = gen.statement || (gen as any).description || '';
      result.push({
        id: `tp-item-${Date.now()}-${i + 1}-${Math.random().toString(36).substring(2, 6)}`,
        code: gen.code || `E1-MAT-${String(result.length + 1).padStart(2, '0')}`,
        scopeCode: gen.scopeCode || 'MAT',
        elementName: gen.elementName || '',
        statement: stmt,
        description: stmt,
        competence: gen.competence || '',
        contentScope: gen.contentScope || '',
        p3Dimensions: Array.isArray(gen.p3Dimensions) ? gen.p3Dimensions : [],
        order: result.length + 1,
        cpAnalysisItemIds: Array.isArray(gen.cpAnalysisItemIds) ? gen.cpAnalysisItemIds : [],
      });
    }
  }

  // Unmatched existing TPs processing
  for (const exist of existingItems) {
    if (!matchedExistingIds.has(exist.id)) {
      if (!hasCanonicalAnalysis) {
        result.push({
          ...exist,
          order: result.length + 1,
        });
      } else {
        const existIds = Array.isArray(exist.cpAnalysisItemIds) ? exist.cpAnalysisItemIds : [];
        const validLineageIds = existIds.filter((id) => activeAnalysisItemIds.has(id));
        if (validLineageIds.length > 0) {
          result.push({
            ...exist,
            cpAnalysisItemIds: validLineageIds,
            order: result.length + 1,
          });
        }
      }
    }
  }

  return result.map((item, idx) => ({ ...item, order: idx + 1 }));
}

export interface GenerateLearningPlanParams {
  academicSetting: AcademicSetting;
  tps: TPItem[];
  atpItems?: ATPItem[];
  topic?: string;
  allocatedJP?: number;
  cognitiveAdaptation?: CognitiveAdaptationProfile;
  meetings?: {
    meetingId: string;
    order: number;
    title: string;
    date?: string;
    jp: number;
    materials?: { id: string; title: string }[];
    linkedTpIds?: string[];
    linkedAtpItemIds?: string[];
  }[];
  kktpCriteria?: AssessmentCriterion[];
}

export async function generateLearningPlanWithAI(params: GenerateLearningPlanParams): Promise<Partial<LearningPlan>> {
  const paramsWithAdaptation = {
    ...params,
    cognitiveAdaptation: params.cognitiveAdaptation || getCognitiveAdaptationProfile(params.academicSetting, params.academicSetting.grade)
  };
  try {
    const res = await aiFetch('/api/ai/generate-learning-plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(paramsWithAdaptation),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      if (errData.code === 'AI_NOT_CONFIGURED') {
        throw new Error('Layanan AI belum dikonfigurasi pada server.');
      }
      throw new Error(errData.error || `Gagal menyusun draf Modul Ajar AI (Status ${res.status})`);
    }

    const data = await res.json();
    if (!data.data || typeof data.data !== 'object' || Array.isArray(data.data)) {
      throw new Error('Hasil respon AI Modul Ajar tidak berbentuk objek valid.');
    }

    // Runtime validation and normalization for critical structure
    if (typeof data.data.initialCompetency !== 'string' || data.data.initialCompetency.trim() === '') {
      throw new Error('Hasil respon AI Modul Ajar tidak memuat Kompetensi Awal (initialCompetency) yang valid.');
    }
    data.data.initialCompetency = data.data.initialCompetency.trim();

    const rawDimensions = Array.isArray(data.data.graduateProfileDimensions) ? data.data.graduateProfileDimensions : [];
    const validDimensions = rawDimensions.filter((d: any) => typeof d === 'string' && d.trim().length > 0).map((d: any) => d.trim());
    if (validDimensions.length === 0) {
      throw new Error('Hasil respon AI Modul Ajar tidak memuat Dimensi Profil Lulusan yang valid.');
    }
    data.data.graduateProfileDimensions = validDimensions;

    const normalizedResources = normalizeAIResources(data.data.resources);
    if (normalizedResources.length === 0) {
      throw new Error('Hasil respon AI Modul Ajar tidak memuat Sarana dan Prasarana / Sumber Belajar (resources) yang valid.');
    }
    data.data.resources = normalizedResources;

    if (typeof data.data.learningModel !== 'string' || data.data.learningModel.trim() === '') {
      throw new Error('Hasil respon AI Modul Ajar tidak memuat Model/Praktik Pembelajaran (learningModel) yang valid.');
    }
    data.data.learningModel = data.data.learningModel.trim();

    if (!Array.isArray(data.data.learningExperiences) || data.data.learningExperiences.length === 0) {
      throw new Error('Hasil respon AI Modul Ajar tidak memuat Pengalaman Belajar (learningExperiences).');
    }

    const phaseSet = new Set<string>();
    for (let i = 0; i < data.data.learningExperiences.length; i++) {
      const exp = data.data.learningExperiences[i];
      if (!exp || typeof exp !== 'object') {
        throw new Error(`Butir pengalaman belajar ke-${i + 1} tidak valid.`);
      }
      const normPhase = normalizeLearningExperiencePhase(exp.phase);
      if (!normPhase) {
        throw new Error(`Fase pengalaman belajar ke-${i + 1} ('${exp.phase}') tidak sah. Pilihan sah: UNDERSTAND, APPLY, REFLECT`);
      }
      exp.phase = normPhase;
      phaseSet.add(normPhase);
      if (!exp.description || typeof exp.description !== 'string' || exp.description.trim() === '') {
        throw new Error(`Deskripsi pengalaman belajar ke-${i + 1} kosong.`);
      }
      exp.id = `exp-ai-${i + 1}`;
    }
    for (const phase of ['UNDERSTAND', 'APPLY', 'REFLECT']) {
      if (!phaseSet.has(phase)) {
        throw new Error(`Hasil respon AI Modul Ajar belum memuat fase ${phase}.`);
      }
    }
    const normalizedAssessmentPlan = normalizeAIAssessmentPlan(data.data.assessmentPlan, params.tps.map((t) => t.id));
    if (normalizedAssessmentPlan.initial.length === 0) {
      throw new Error('Hasil respon AI Modul Ajar tidak memuat Rencana Asesmen Awal (initial / diagnostik) yang valid.');
    }
    if (normalizedAssessmentPlan.formative.length === 0) {
      throw new Error('Hasil respon AI Modul Ajar tidak memuat Rencana Asesmen Formatif (formative) yang valid.');
    }
    if (normalizedAssessmentPlan.summative.length === 0) {
      throw new Error('Hasil respon AI Modul Ajar tidak memuat Rencana Asesmen Sumatif (summative) yang valid.');
    }
    data.data.assessmentPlan = normalizedAssessmentPlan;
    data.data.reflection = normalizeAIReflection(data.data.reflection);
    data.data.deepLearningContext = normalizeDeepLearningContext(data.data.deepLearningContext);
    if (typeof params.allocatedJP === 'number' && params.allocatedJP > 0) {
      data.data.allocatedJP = params.allocatedJP;
    } else {
      delete data.data.allocatedJP;
    }

    if (paramsWithAdaptation.cognitiveAdaptation && !data.data.cognitiveAdaptation) {
      data.data.cognitiveAdaptation = paramsWithAdaptation.cognitiveAdaptation;
    }

    return data.data;
  } catch (err) {
    throw new Error(formatAIErrorMessage(err, 'menyusun Modul Ajar / RPP'));
  }
}

export async function generateATPWithAI(params: GenerateATPParams): Promise<GenerateATPResult> {
  try {
    const res = await aiFetch('/api/ai/generate-atp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      if (errData.code === 'AI_NOT_CONFIGURED') {
        throw new Error('Layanan AI belum dikonfigurasi pada server.');
      }
      throw new Error(errData.error || `Gagal menyusun ATP dengan AI (Status ${res.status})`);
    }

    const data = await res.json();
    if (!data.data || !Array.isArray(data.data.items) || data.data.items.length === 0) {
      throw new Error('Hasil respon AI ATP tidak memuat butir alur yang valid.');
    }

    const normalizedItems = data.data.items.map((item: any, idx: number) => {
      const rawLinked = Array.isArray(item.linkedTpIds) && item.linkedTpIds.length > 0
        ? item.linkedTpIds.map((id: any) => String(id).trim()).filter(Boolean)
        : item.tpId ? [String(item.tpId).trim()] : [];

      return {
        ...item,
        stepNumber: typeof item.stepNumber === 'number' && item.stepNumber > 0 ? item.stepNumber : idx + 1,
        linkedTpIds: rawLinked,
        focus: item.focus ? String(item.focus).trim() : undefined,
      };
    });

    return {
      rationale: data.data.rationale || '',
      items: normalizedItems,
    };
  } catch (err) {
    throw new Error(formatAIErrorMessage(err, 'menyusun Alur Tujuan Pembelajaran'));
  }
}

export async function refineTextWithAI(params: {
  text: string;
  instruction?: string;
  context?: string;
}): Promise<string> {
  try {
    const res = await aiFetch('/api/ai/refine-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Gagal menyempurnakan teks');
    }

    const data = await res.json();
    return data.refinedText;
  } catch (err) {
    throw new Error(formatAIErrorMessage(err, 'menyempurnakan kalimat'));
  }
}

export interface TeacherUnitConstraint {
  unitIndex: number;
  unitTitle: string;
}

export interface GenerateATPMappingParams {
  atpItems: Array<{
    id: string;
    stepNumber?: number;
    tpCode: string;
    tpStatement?: string;
    tpContentScope?: string;
    unitTitle?: string;
    materialScope?: string;
  }>;
  subject?: string;
  grade?: string;
  phase?: string;
  targetUnitCount?: number;
  teacherUnits?: TeacherUnitConstraint[];
  completeEmptyOnly?: boolean;
}

export interface ATPMappingResult {
  units: Array<{
    unitIndex: number;
    unitTitle: string;
    description?: string;
  }>;
  mappings: Array<{
    atpItemId: string;
    unitTitle: string;
    materialScope: string;
  }>;
}

export async function generateATPMappingWithAI(
  params: GenerateATPMappingParams
): Promise<ATPMappingResult> {
  try {
    const res = await aiFetch('/api/ai/generate-atp-mapping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      if (errData.code === 'AI_NOT_CONFIGURED') {
        throw new Error('Layanan AI belum dikonfigurasi pada server.');
      }
      throw new Error(errData.error || `Gagal menyusun pemetaan Unit/Bab dengan AI (Status ${res.status})`);
    }

    const data = await res.json();
    if (!data.data || !Array.isArray(data.data.mappings)) {
      throw new Error('Hasil respon AI Pemetaan Unit tidak memuat data pemetaan yang valid.');
    }
    return data.data;
  } catch (err) {
    throw new Error(formatAIErrorMessage(err, 'menyusun pemetaan Unit/Bab & Lingkup Materi'));
  }
}

export interface GenerateCanonicalATPUnitMappingParams {
  academicSettingId?: string;
  subject?: string;
  grade?: string;
  phase?: string;
  tpData: TPData;
  atpData: ATPData;
  cpAnalysisData?: CPAnalysisData;
  existingMapping?: ATPUnitMappingData;
  targetUnitCount?: number;
  targetMaterialCountPerUnit?: number;
}

export async function generateCanonicalATPUnitMappingWithAI(
  params: GenerateCanonicalATPUnitMappingParams
): Promise<ATPUnitMappingData> {
  try {
    const res = await aiFetch('/api/ai/generate-canonical-atp-unit-mapping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      if (errData.code === 'AI_NOT_CONFIGURED') {
        throw new Error('Layanan AI belum dikonfigurasi pada server.');
      }
      throw new Error(errData.error || `Gagal menyusun pemetaan Unit/Bab dengan AI (Status ${res.status})`);
    }

    const data = await res.json();
    if (!data.data || !Array.isArray(data.data.units)) {
      throw new Error('Hasil respon AI Pemetaan Unit tidak memuat data Bab / Unit yang valid.');
    }
    return data.data;
  } catch (err) {
    throw new Error(formatAIErrorMessage(err, 'menyusun pemetaan Unit/Bab & Lingkup Materi'));
  }
}

export interface MappingAnalysisResult {
  summary: {
    totalAtp: number;
    mappedAtp: number;
    unmappedAtp: number;
    alignedAtp: number;
    reviewAtp: number;
    alignableMaterials: number;
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

export interface AnalyzeATPUnitMappingParams {
  subject?: string;
  grade?: string;
  phase?: string;
  tpData: TPData;
  atpData: ATPData;
  currentMapping: ATPUnitMappingData;
}

export async function analyzeATPUnitMappingWithAI(
  params: AnalyzeATPUnitMappingParams
): Promise<MappingAnalysisResult> {
  try {
    const res = await aiFetch('/api/ai/analyze-atp-unit-mapping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      if (errData.code === 'AI_NOT_CONFIGURED') {
        throw new Error('Layanan AI belum dikonfigurasi pada server.');
      }
      throw new Error(errData.error || `Gagal menganalisis pemetaan Unit/Bab (Status ${res.status})`);
    }

    const data = await res.json();
    if (
      !data.data ||
      typeof data.data.summary !== 'object' ||
      !Array.isArray(data.data.atpFindings) ||
      !Array.isArray(data.data.materialFindings)
    ) {
      throw new Error('Hasil respon Analisis Pemetaan tidak memuat struktur data yang valid.');
    }
    return data.data;
  } catch (err) {
    throw new Error(formatAIErrorMessage(err, 'menganalisis pemetaan Bab & Lingkup Materi'));
  }
}

export interface AIMeetingSuggestion {
  title: string;
  materialIds: string[];
  linkedAtpItemIds: string[];
  linkedTpIds: string[];
}

export interface AIUnitMeetingSuggestion {
  unitId: string;
  meetings: AIMeetingSuggestion[];
}

export interface AIMeetingGenerationResult {
  units: AIUnitMeetingSuggestion[];
}

export interface AIMeetingDiagnostic {
  version?: number;
  stage?: string;
  code?: string;
  mappingId?: string;
  planId?: string;
  semester1LastUnitId?: string | null;
  semester1UnitIds?: string[];
  semester2UnitIds?: string[];
  capacity?: {
    semester1: {
      target: number;
      existing: number;
      requestedNew: number;
    };
    semester2: {
      target: number;
      existing: number;
      requestedNew: number;
    };
  };
  generated?: {
    semester1: number;
    semester2: number;
    deltaSemester1: number;
    deltaSemester2: number;
  };
  perUnit?: Array<{
    unitId: string;
    semester: 1 | 2;
    existingCount: number;
    targetNewCount?: number;
    generatedCount: number;
    delta?: number;
    suggestions?: Array<{
      suggestionIndex: number;
      title: string;
      materialIds: string[];
      linkedAtpItemIds: string[];
      linkedTpIds: string[];
    }>;
  }>;
  issue?: {
    unitId?: string;
    suggestionIndex?: number;
    title?: string;
    field?: 'unitId' | 'materialIds' | 'linkedAtpItemIds' | 'linkedTpIds';
    invalidId?: string;
  };
  missingCoverage?: Array<{
    unitId: string;
    materialIds: string[];
    atpItemIds: string[];
    tpIds: string[];
  }>;
}

export class AIMeetingGenerationError extends Error {
  code?: string;
  diagnostic?: AIMeetingDiagnostic;

  constructor(message: string, code?: string, diagnostic?: AIMeetingDiagnostic) {
    super(message);
    this.name = 'AIMeetingGenerationError';
    this.code = code;
    this.diagnostic = diagnostic;
  }
}

export interface GenerateUnitMeetingsWithAIParams {
  subject?: string;
  grade?: string;
  phase?: string;
  mapping: ATPUnitMappingData;
  tpData: TPData;
  atpData: ATPData;
  currentPlan: UnitExecutionPlanData;
  capacityContext?: {
    semester1LastUnitId: string | null;
    semester1: {
      targetMeetingCount: number;
      totalJP: number;
    };
    semester2: {
      targetMeetingCount: number;
      totalJP: number;
    };
  };
  unitMeetingTargets?: Array<{
    unitId: string;
    semester: 1 | 2;
    existingCount: number;
    newTargetCount: number;
  }>;
}

export async function generateUnitMeetingsWithAI(
  params: GenerateUnitMeetingsWithAIParams
): Promise<AIMeetingGenerationResult> {
  try {
    const res = await aiFetch('/api/ai/generate-unit-meetings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      if (errData.code === 'AI_NOT_CONFIGURED') {
        throw new AIMeetingGenerationError(
          'Layanan AI belum dikonfigurasi pada server.',
          'AI_NOT_CONFIGURED',
          errData.diagnostic
        );
      }
      const rawMsg = errData.error || `Gagal menyusun draf Pertemuan dengan AI (Status ${res.status})`;
      const formatted = formatAIErrorMessage(rawMsg, 'menyusun draf Pertemuan dengan AI');
      throw new AIMeetingGenerationError(formatted, errData.code, errData.diagnostic);
    }

    const data = await res.json();
    if (!data.data || !Array.isArray(data.data.units)) {
      throw new AIMeetingGenerationError('Hasil respon AI tidak memuat data unit meeting yang valid.', 'AI_FORMAT_INVALID');
    }
    return data.data;
  } catch (err: any) {
    if (err instanceof AIMeetingGenerationError) {
      throw err;
    }
    throw new AIMeetingGenerationError(
      formatAIErrorMessage(err, 'menyusun draf Pertemuan dengan AI'),
      'AI_GENERATION_ERROR'
    );
  }
}

import { MeetingReconciliationSafeOption } from './meetingReconciliationService';

export interface AIMeetingReconciliationRecommendation {
  action: 'RESCHEDULE' | 'MERGE' | 'REDUCE';
  candidateDate?: string;
  candidateSessionId?: string;
  targetMeetingId?: string;
  suggestedTitle?: string;
  reason: string;
}

export interface AIMeetingReconciliationRecommendationParams {
  subject: string;
  grade: string;
  phase: string;
  unitTitle: string;
  unresolvedMeetingTitle: string;
  sourceMaterials: string[];
  sourceAtpSummary: string[];
  sourceTpSummary: string[];
  adjacentMeetings: Array<{
    meetingId: string;
    title: string;
    materials: string[];
    isPrevious: boolean;
  }>;
  safeOptions: MeetingReconciliationSafeOption[];
}

export interface AIMeetingReconciliationRecommendationResponse {
  success: boolean;
  code?: string;
  error?: string;
  recommendation?: AIMeetingReconciliationRecommendation;
}

export async function requestMeetingReconciliationAI(
  params: AIMeetingReconciliationRecommendationParams
): Promise<AIMeetingReconciliationRecommendationResponse> {
  try {
    const res = await aiFetch('/api/ai/recommend-meeting-reconciliation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      return {
        success: false,
        code: errData.code || 'AI_RECONCILIATION_ERROR',
        error: errData.error || `Layanan AI mengalami kendala (${res.status})`,
      };
    }

    return await res.json();
  } catch (err: any) {
    return {
      success: false,
      code: 'AI_RECONCILIATION_ERROR',
      error: `Gagal memproses rekomendasi AI: ${err.message || String(err)}`,
    };
  }
}


