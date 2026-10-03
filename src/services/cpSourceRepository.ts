import { ActiveContext, CPSource, CPElem, CPVerificationStatus, normalizeCPVerificationStatus } from '../types';
import { CP_PRESETS, CPSamplePreset } from '../data/curriculumDefaults';

export interface CPSourceSearchResult {
  id: string;
  subject: string;
  level: string;
  grade: string;
  phase: string;
  curriculum: string;
  title: string;
  institution: string;
  documentYear: string;
  url?: string;
  page?: string;
  verificationStatus: CPVerificationStatus;
  generalDescription: string;
  elements: CPElem[];
  sourceMeta: CPSource;
  confidenceScore: number;
}

const ALIAS_CLUSTERS: string[][] = [
  // PJOK
  ['pjok', 'pendidikan jasmani olahraga dan kesehatan', 'pendidikan jasmani olahraga & kesehatan', 'pendidikan jasmani dan olahraga', 'pendidikan jasmani', 'penjas', 'penjasorkes', 'olahraga', 'kesehatan'],
  // Bahasa Indonesia
  ['bahasa indonesia', 'b indonesia', 'b indo', 'bindo', 'indonesia'],
  // Bahasa Inggris
  ['bahasa inggris', 'b inggris', 'b ing', 'binggris', 'english'],
  // IPAS
  ['ipas', 'ilmu pengetahuan alam dan sosial', 'ilmu pengetahuan alam & sosial', 'ipa dan ips', 'ipa & ips'],
  // IPA
  ['ipa', 'ilmu pengetahuan alam', 'sains', 'natural science', 'biologi dan fisika'],
  // IPS
  ['ips', 'ilmu pengetahuan sosial', 'social science', 'sosial'],
  // Matematika
  ['matematika', 'mtk', 'math', 'mathematics', 'matematik', 'berhitung'],
  // Pendidikan Pancasila
  ['pendidikan pancasila', 'pancasila', 'ppkn', 'pkn', 'pendidikan kewarganegaraan', 'kewarganegaraan'],
  // Informatika
  ['informatika', 'tik', 'teknologi informasi dan komunikasi', 'komputer', 'teknologi informasi', 'koding', 'coding', 'ilmu komputer'],
  // Seni Budaya & Rupa/Musik/Tari/Teater
  ['seni budaya', 'seni rupa', 'seni musik', 'seni tari', 'seni teater', 'seni dan prakarya', 'seni budaya dan prakarya', 'sbkp', 'seni'],
  // Prakarya & Kewirausahaan
  ['prakarya', 'kewirausahaan', 'prakarya dan kewirausahaan', 'pkwu', 'kerajinan'],
  // PAI & Budi Pekerti
  ['pendidikan agama islam dan budi pekerti', 'pendidikan agama islam', 'pai', 'agama islam', 'pabp', 'budi pekerti'],
  // Pendidikan Agama Kristen
  ['pendidikan agama kristen dan budi pekerti', 'pendidikan agama kristen', 'pak', 'agama kristen'],
  // Pendidikan Agama Katolik
  ['pendidikan agama katolik dan budi pekerti', 'pendidikan agama katolik', 'agama katolik'],
  // Sejarah
  ['sejarah', 'sejarah indonesia', 'history'],
  // Geografi, Sosiologi, Ekonomi, Fisika, Kimia, Biologi
  ['geografi'],
  ['sosiologi'],
  ['ekonomi', 'akuntansi'],
  ['fisika'],
  ['kimia'],
  ['biologi'],
  // Bahasa Daerah / Muatan Lokal
  ['muatan lokal', 'mulok', 'bahasa daerah', 'bahasa jawa', 'bahasa sunda', 'bahasa bali'],
];

const STOP_WORDS = new Set([
  'dan',
  'atau',
  'di',
  'ke',
  'dari',
  'pada',
  'untuk',
  'dengan',
  'mata',
  'pelajaran',
  'mapel',
  'bidang',
  'studi',
  'fase',
  'kelas',
  'kurikulum',
  'wajib',
  'pilihan',
  'sd',
  'smp',
  'sma',
  'smk',
]);

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTokens(normalized: string): string[] {
  return normalized
    .split(' ')
    .map((w) => w.trim())
    .filter((w) => w.length >= 2 && !STOP_WORDS.has(w));
}

function diceCoefficient(a: string, b: string): number {
  const cleanA = a.replace(/\s+/g, '');
  const cleanB = b.replace(/\s+/g, '');
  if (!cleanA || !cleanB) return 0;
  if (cleanA === cleanB) return 1;
  if (cleanA.length < 2 || cleanB.length < 2) return 0;

  const getBigrams = (str: string): Map<string, number> => {
    const bigrams = new Map<string, number>();
    for (let i = 0; i < str.length - 1; i++) {
      const bg = str.slice(i, i + 2);
      bigrams.set(bg, (bigrams.get(bg) || 0) + 1);
    }
    return bigrams;
  };

  const bigramsA = getBigrams(cleanA);
  const bigramsB = getBigrams(cleanB);

  let intersection = 0;
  for (const [bg, countA] of bigramsA.entries()) {
    if (bigramsB.has(bg)) {
      intersection += Math.min(countA, bigramsB.get(bg)!);
    }
  }

  const total = (cleanA.length - 1) + (cleanB.length - 1);
  return total > 0 ? (2 * intersection) / total : 0;
}

function computeSubjectRelevance(target: string, candidate: string): number {
  const normTarget = normalizeText(target);
  const normCandidate = normalizeText(candidate);

  if (!normTarget || !normCandidate) {
    return 0;
  }

  // 1. Exact match (highest score: 60)
  if (normTarget === normCandidate) {
    return 60;
  }

  // 2. Known alias clusters match (score: 55)
  for (const cluster of ALIAS_CLUSTERS) {
    const targetInCluster = cluster.some(
      (alias) => normTarget === alias || normTarget.includes(alias) || alias.includes(normTarget)
    );
    const candidateInCluster = cluster.some(
      (alias) => normCandidate === alias || normCandidate.includes(alias) || alias.includes(normCandidate)
    );

    if (targetInCluster && candidateInCluster) {
      return 55;
    }
  }

  // 3. Substring match (score: 45)
  if (
    normTarget.length >= 3 &&
    normCandidate.length >= 3 &&
    (normCandidate.includes(normTarget) || normTarget.includes(normCandidate))
  ) {
    return 45;
  }

  // 4. Token overlap matching (score: 25 - 40)
  const targetTokens = extractTokens(normTarget);
  const candidateTokens = extractTokens(normCandidate);

  if (targetTokens.length > 0 && candidateTokens.length > 0) {
    let matchedTokenCount = 0;
    for (const tToken of targetTokens) {
      const hasMatch = candidateTokens.some(
        (cToken) =>
          cToken === tToken ||
          (tToken.length >= 4 && cToken.startsWith(tToken)) ||
          (cToken.length >= 4 && tToken.startsWith(cToken))
      );
      if (hasMatch) {
        matchedTokenCount++;
      }
    }

    if (matchedTokenCount > 0) {
      const matchRatio = matchedTokenCount / Math.max(targetTokens.length, candidateTokens.length);
      return Math.round(25 + 15 * matchRatio);
    }
  }

  // 5. String similarity / fuzzy tolerance (score: 20 - 35)
  const similarity = diceCoefficient(normTarget, normCandidate);
  if (similarity >= 0.75) {
    return 35;
  }
  if (similarity >= 0.6) {
    return 25;
  }

  // Unrelated subject
  return 0;
}

/**
 * Official CP Source Repository & Registry
 * Prioritizes official government publications (Kemendikdasmen, BSKAP, Ruang GTK).
 * Fallbacks are transparently labeled as local_reference.
 */
class CPSourceRepository {
  private registry: CPSamplePreset[] = [...CP_PRESETS];

  /**
   * Search available CP entries by ActiveContext using tolerant relevance scoring.
   * Subject match / known aliases is the primary ranking signal.
   * Completely unrelated subjects are filtered out by the relevance threshold.
   */
  public search(context: Partial<ActiveContext>): CPSourceSearchResult[] {
    const rawTargetSubject = context.subject || '';
    const targetSubject = rawTargetSubject.trim();
    if (!targetSubject) {
      return [];
    }

    const targetLevel = (context.level || '').trim().toLowerCase();
    const targetPhase = (context.phase || '').trim().toLowerCase();
    const targetGrade = (context.grade || '').trim().toLowerCase();

    // Minimum subject relevance required so completely unrelated subjects are not included
    const RELEVANCE_THRESHOLD = 20;

    const scoredCandidates: { item: CPSamplePreset; index: number; score: number }[] = [];

    this.registry.forEach((item, index) => {
      const subjectScore = computeSubjectRelevance(targetSubject, item.subject);

      // Clearly unrelated subjects must not rank as valid results
      // Phase/grade alone must not make an unrelated subject a match
      if (subjectScore < RELEVANCE_THRESHOLD) {
        return;
      }

      let score = subjectScore;
      const itemPhase = (item.phase || '').toLowerCase();
      const itemLevel = (item.level || '').toLowerCase();
      const itemGrade = (item.grade || '').toLowerCase();

      // Phase match (up to +25)
      if (targetPhase && itemPhase === targetPhase) {
        score += 25;
      } else if (targetPhase && (itemPhase.includes(targetPhase) || targetPhase.includes(itemPhase))) {
        score += 15;
      }

      // Level match (+15)
      if (targetLevel && itemLevel === targetLevel) {
        score += 15;
      }

      // Grade match (up to +10)
      if (targetGrade && itemGrade === targetGrade) {
        score += 10;
      } else if (targetGrade && (itemGrade.includes(targetGrade) || targetGrade.includes(itemGrade))) {
        score += 5;
      }

      scoredCandidates.push({ item, index, score });
    });

    // Rank best matching candidates first
    scoredCandidates.sort((a, b) => b.score - a.score);

    return scoredCandidates.map(({ item, index, score }) => ({
      id: `src-${index + 1}`,
      subject: item.subject,
      level: item.level,
      grade: item.grade,
      phase: item.phase,
      curriculum: 'Kurikulum Merdeka',
      title: item.sourceInfo.title,
      institution: item.sourceInfo.institution,
      documentYear: item.sourceInfo.documentYear || '2024/2025',
      url: item.sourceInfo.url,
      page: item.sourceInfo.page,
      verificationStatus: normalizeCPVerificationStatus(item.sourceInfo.verificationStatus),
      generalDescription: item.generalDescription,
      elements: item.elements.map((el, elIdx) => ({
        id: `elem-${index + 1}-${elIdx + 1}`,
        code: `E${elIdx + 1}`,
        name: el.name,
        content: el.content,
      })),
      sourceMeta: item.sourceInfo,
      confidenceScore: score,
    }));
  }

  /**
   * Returns default fallback reference if no exact match is found
   */
  public getLocalReferenceFallback(context: Partial<ActiveContext>): CPSourceSearchResult {
    const defaultPhase = context.phase || 'Fase A';
    const defaultSubject = context.subject || 'Mata Pelajaran';
    const defaultGrade = context.grade || 'Kelas 1';

    return {
      id: 'fallback-local',
      subject: defaultSubject,
      level: context.level || 'SD',
      grade: defaultGrade,
      phase: defaultPhase,
      curriculum: context.curriculum || 'Kurikulum Merdeka',
      title: `Draft Dokumen Referensi Lokal - ${defaultSubject} (${defaultPhase})`,
      institution: 'Penyusunan Mandiri Guru (Lokal)',
      documentYear: new Date().getFullYear().toString(),
      url: 'https://kurikulum.kemdikbud.go.id/',
      page: `${defaultPhase} / ${defaultGrade}`,
      verificationStatus: 'local_reference',
      generalDescription: `Pada akhir ${defaultPhase}, peserta didik menguasai kompetensi dasar ${defaultSubject} sesuai tahapan perkembangan belajar pada ${defaultGrade}.`,
      elements: [
        {
          id: 'elem-fallback-1',
          code: 'E1',
          name: 'Pemahaman Konsep & Keterampilan',
          content: `Peserta didik mampu memahami konsep esensial dan mempraktikkan keterampilan utama ${defaultSubject} secara bertahap.`,
        },
      ],
      sourceMeta: {
        title: `Draft Referensi Lokal - ${defaultSubject} (${defaultPhase})`,
        institution: 'Penyusunan Mandiri Guru (Lokal)',
        documentYear: new Date().getFullYear().toString(),
        url: 'https://kurikulum.kemdikbud.go.id/',
        page: `${defaultPhase} / ${defaultGrade}`,
        retrievedAt: new Date().toISOString(),
        verificationStatus: 'local_reference',
      },
      confidenceScore: 10,
    };
  }
}

export const cpSourceRepository = new CPSourceRepository();
