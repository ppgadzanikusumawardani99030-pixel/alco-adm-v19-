import {
  Student,
  AcademicSetting,
  StudentLearningReport,
} from '../types';

/**
 * Format string identitas kelas secara bersih dan deterministik.
 * Menghindari bug duplikasi prefix seperti "Kelas Kelas 1 A" -> "Kelas 1 A".
 */
export function formatClassIdentity(grade?: string, classSection?: string): string {
  if (!grade) {
    return classSection ? `Kelas ${classSection}` : '';
  }

  const trimmedGrade = grade.trim();
  // Jika nilai grade sudah diawali kata "Kelas" atau "Kls", jangan tambahkan lagi
  const baseGrade = /^(?:kelas|kls)\b/i.test(trimmedGrade)
    ? trimmedGrade
    : `Kelas ${trimmedGrade}`;

  const trimmedSection = (classSection || '').trim();
  if (trimmedSection) {
    if (baseGrade.toLowerCase().endsWith(trimmedSection.toLowerCase())) {
      return baseGrade;
    }
    return `${baseGrade} ${trimmedSection}`;
  }

  return baseGrade;
}

export interface StudentReportGenerationInput {
  student: Student;
  academicSetting: AcademicSetting;
  semesterPlanId?: string;
  scores?: { title: string; score: number; type: string }[];
  tpStatements?: string[];
  finalGrade?: number;
  achievementStatus?: 'Sangat Baik' | 'Baik' | 'Perlu Bimbingan' | string;
}

/**
 * Normalisasi dan validasi respons AI agar selalu mematuhi Canonical Report Content Contract:
 * - ringkasan perkembangan
 * - kekuatan / capaian utama
 * - hal yang perlu dikembangkan
 * - narasi / tindak lanjut
 * - aktivitas bersama keluarga di rumah
 */
export function normalizeStudentReport(
  raw: any,
  input: StudentReportGenerationInput
): StudentLearningReport {
  const { student, academicSetting, semesterPlanId } = input;
  const name = student.name || 'Murid';
  const subject = academicSetting.subject || 'Pembelajaran';
  const gradeFormatted = formatClassIdentity(academicSetting.grade, academicSetting.classSection);

  // Fallback defaults jika salah satu bagian kosong dari output AI
  const fallback = createDeterministicStudentReport(input);

  const developmentSummary =
    typeof raw?.developmentSummary === 'string' && raw.developmentSummary.trim()
      ? raw.developmentSummary.trim()
      : fallback.developmentSummary;

  const strengths =
    Array.isArray(raw?.strengths) && raw.strengths.filter((s: any) => typeof s === 'string' && s.trim()).length > 0
      ? raw.strengths.map((s: any) => String(s).trim())
      : fallback.strengths;

  const growthAreas =
    Array.isArray(raw?.growthAreas) && raw.growthAreas.filter((s: any) => typeof s === 'string' && s.trim()).length > 0
      ? raw.growthAreas.map((s: any) => String(s).trim())
      : fallback.growthAreas;

  const followUpNarrative =
    typeof raw?.followUpNarrative === 'string' && raw.followUpNarrative.trim()
      ? raw.followUpNarrative.trim()
      : fallback.followUpNarrative;

  const homeActivities =
    Array.isArray(raw?.homeActivities) && raw.homeActivities.filter((s: any) => typeof s === 'string' && s.trim()).length > 0
      ? raw.homeActivities.map((s: any) => String(s).trim())
      : fallback.homeActivities;

  return {
    id: `rep-${student.id}-${semesterPlanId || academicSetting.id}`,
    studentId: student.id,
    studentName: student.name,
    academicSettingId: academicSetting.id,
    semesterPlanId,
    nisn: student.nisn,
    className: gradeFormatted,
    period: `Semester ${academicSetting.semester} Tahun Ajaran ${academicSetting.academicYear}`,
    age: student.age,
    finalGrade: input.finalGrade ?? (raw?.finalGrade ? Number(raw.finalGrade) : undefined),
    achievementStatus: input.achievementStatus || raw?.achievementStatus || 'Baik',
    developmentSummary,
    strengths,
    growthAreas,
    followUpNarrative,
    homeActivities,
    generatedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'COMPLETED',
  };
}

/**
 * Pembangun laporan kanonikal deterministik berbasis data asesmen murid.
 * Menjamin laporan komprehensif 5 bagian selalu tersedia tanpa crash.
 */
export function createDeterministicStudentReport(
  input: StudentReportGenerationInput
): StudentLearningReport {
  const { student, academicSetting, semesterPlanId, finalGrade = 82, achievementStatus = 'Baik', tpStatements = [] } = input;
  const name = student.name || 'Murid';
  const subject = academicSetting.subject || 'Mata Pelajaran';
  const gradeFormatted = formatClassIdentity(academicSetting.grade, academicSetting.classSection);
  const isHighAchiever = finalGrade >= 85;
  const isNeedsGuidance = finalGrade < 75;

  let developmentSummary = '';
  let strengths: string[] = [];
  let growthAreas: string[] = [];
  let followUpNarrative = '';
  let homeActivities: string[] = [];

  const mainTp = tpStatements[0] || `kompetensi dasar ${subject}`;
  const secondaryTp = tpStatements[1] || `penerapan konsep materi ${subject}`;

  if (isHighAchiever) {
    developmentSummary = `Ananda ${name} menunjukkan perkembangan belajar yang sangat memuaskan dan antusiasme tinggi pada pembelajaran ${subject}. ${name} mampu memahami konsep secara mendalam, aktif berpartisipasi dalam diskusi kelompok, serta konsisten menyelesaikan tugas dan asesmen dengan ketelitian yang baik.`;
    strengths = [
      `Menguasai dengan sangat baik capaian pembelajaran terkait ${mainTp}.`,
      `Mampu menghubungkan konsep ${subject} dengan konteks pengalaman nyata sehari-hari secara mandiri.`,
      `Menunjukkan sikap bernalar kritis, kolaboratif, dan percaya diri saat mempresentasikan hasil karya.`,
    ];
    growthAreas = [
      `Dapat diberikan stimulasi tambahan untuk memperdalam penalaran analitis dan eksplorasi materi yang lebih menantang (pengayaan).`,
      `Mendorong ananda untuk menjadi tutor sebaya bagi rekan yang memerlukan bimbingan.`,
    ];
    followUpNarrative = `Guru akan memfasilitasi program pengayaan dan memberikan tantangan proyek terarah agar kapasitas intelektual dan kreativitas Ananda ${name} terus berkembang optimal.`;
    homeActivities = [
      `Ayo bermain bersama di rumah: Mengajak ananda mendiskusikan fenomena sehari-hari yang berkaitan dengan materi ${subject}.`,
      `Mendampingi ananda membaca buku referensi bertema petualangan sains atau literasi eksploratif.`,
      `Memberikan apresiasi atas usaha dan ketekunan yang telah ditunjukkan ananda selama satu semester ini.`,
    ];
  } else if (isNeedsGuidance) {
    developmentSummary = `Ananda ${name} menunjukkan kemauan belajar dan usaha yang baik pada pembelajaran ${subject}. Meskipun masih memerlukan pendampingan intensif pada beberapa capaian pembelajaran, ananda merespons bimbingan guru secara positif dan menunjukkan progres ketuntasan yang menjanjikan.`;
    strengths = [
      `Menunjukkan minat dan keterlibatan aktif saat pembelajaran dilakukan dengan media visual dan aktivitas manipulatif.`,
      `Memiliki semangat kerja sama yang baik saat melakukan kegiatan kelompok terbimbing.`,
    ];
    growthAreas = [
      `Perlu penguatan pemahaman konsep dasar terkait ${mainTp}.`,
      `Perlu latihan bertahap dalam menyelesaikan tugas mandiri agar lebih percaya diri dan terbiasa dengan instruksi terstruktur.`,
    ];
    followUpNarrative = `Guru akan memberikan pendampingan remedial perorangan dengan strategi penyederhanaan langkah instruksi dan penggunaan media konkret untuk memperkuat fondasi konsep Ananda ${name}.`;
    homeActivities = [
      `Ayo bermain bersama di rumah: Melakukan permainan edukatif santai seperti tebak kata atau manipulasi benda di sekitar rumah.`,
      `Meluangkan waktu 15–20 menit setiap malam untuk membaca bersama dan mengulang konsep inti secara menggembirakan.`,
      `Memberikan dorongan semangat tanpa membebani agar rasa percaya diri ananda semakin terbangun.`,
    ];
  } else {
    developmentSummary = `Ananda ${name} menunjukkan perkembangan belajar yang baik dan stabil pada mata pelajaran ${subject}. Ananda mampu mengikuti seluruh rangkaian aktivitas belajar dengan tertib, memahami capaian pembelajaran esensial, serta menunjukkan hubungan sosial yang harmonis dengan teman sebaya.`;
    strengths = [
      `Tuntas menguasai konsep dasar ${mainTp} sesuai kriteria ketuntasan.`,
      `Mampu mengaplikasikan keterampilan ${secondaryTp} secara terarah dalam penugasan kelas.`,
      `Menunjukkan sikap mandiri dan disiplin dalam mengumpulkan tugas harian.`,
    ];
    growthAreas = [
      `Perlu didorong untuk lebih berani mengemukakan ide atau pertanyaan secara terbuka di depan kelas.`,
      `Dapat ditingkatkan ketelitian dalam menyelesaikan soal-soal penalaran aplikatif.`,
    ];
    followUpNarrative = `Guru akan terus memotivasi Ananda ${name} melalui apresiasi berkala dan memberi kesempatan memimpin aktivitas kelompok kecil untuk memperkuat rasa percaya diri.`;
    homeActivities = [
      `Ayo bermain bersama di rumah: Mengajak ananda menceritakan kembali pengalaman belajar yang paling menarik di sekolah.`,
      `Melibatkan ananda dalam kegiatan harian keluarga yang melibatkan perencanaan sederhana dan pengamatan langsung.`,
      `Menyediakan ruang eksplorasi bacaan bertema pengetahuan umum untuk memperkaya wawasan ananda.`,
    ];
  }

  return {
    id: `rep-${student.id}-${semesterPlanId || academicSetting.id}`,
    studentId: student.id,
    studentName: student.name,
    academicSettingId: academicSetting.id,
    semesterPlanId,
    nisn: student.nisn,
    className: gradeFormatted,
    period: `Semester ${academicSetting.semester} Tahun Ajaran ${academicSetting.academicYear}`,
    age: student.age,
    finalGrade,
    achievementStatus,
    developmentSummary,
    strengths,
    growthAreas,
    followUpNarrative,
    homeActivities,
    generatedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'COMPLETED',
  };
}
