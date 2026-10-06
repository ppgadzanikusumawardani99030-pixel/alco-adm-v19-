import React, { useState, useMemo } from 'react';
import {
  FileText,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Save,
  Printer,
  ChevronRight,
  User,
  HeartHandshake,
  TrendingUp,
  Target,
  Home,
  RotateCcw,
} from 'lucide-react';
import {
  Student,
  AcademicSetting,
  TeacherProfile,
  SchoolData,
  TPData,
  Assessment,
  AssessmentResult,
  StudentLearningReport,
} from '../../types';
import {
  formatClassIdentity,
  normalizeStudentReport,
  createDeterministicStudentReport,
} from '../../services/studentReportService';
import { generateStudentReportWithAI } from '../../services/aiService';

interface StudentReportManagerProps {
  school: SchoolData;
  profile: TeacherProfile;
  academicSetting: AcademicSetting;
  semesterPlanId?: string;
  tp?: TPData;
  students: Student[];
  assessments: Assessment[];
  assessmentResults: AssessmentResult[];
  studentReports?: StudentLearningReport[];
  onSaveStudentReports: (reports: StudentLearningReport[]) => void;
}

interface BatchProgress {
  isActive: boolean;
  total: number;
  completed: number;
  currentStudentName: string;
  failedCount: number;
}

export const StudentReportManager: React.FC<StudentReportManagerProps> = ({
  school,
  profile,
  academicSetting,
  semesterPlanId,
  tp,
  students = [],
  assessments = [],
  assessmentResults = [],
  studentReports = [],
  onSaveStudentReports,
}) => {
  const [selectedStudentId, setSelectedStudentId] = useState<string>(
    students[0]?.id || ''
  );
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Batch Progress state
  const [batchProgress, setBatchProgress] = useState<BatchProgress>({
    isActive: false,
    total: 0,
    completed: 0,
    currentStudentName: '',
    failedCount: 0,
  });

  // Single generation loading state
  const [isSingleGenerating, setIsSingleGenerating] = useState<boolean>(false);

  // Editing state for selected report
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [editDevelopmentSummary, setEditDevelopmentSummary] = useState<string>('');
  const [editStrengths, setEditStrengths] = useState<string>('');
  const [editGrowthAreas, setEditGrowthAreas] = useState<string>('');
  const [editFollowUpNarrative, setEditFollowUpNarrative] = useState<string>('');
  const [editHomeActivities, setEditHomeActivities] = useState<string>('');

  // Map of student grades
  const studentGradeMap = useMemo(() => {
    const map = new Map<string, { finalGrade: number; achievementStatus: 'Sangat Baik' | 'Baik' | 'Perlu Bimbingan'; scores: { title: string; score: number; type: string }[] }>();

    for (const std of students) {
      const studentRes = assessmentResults.filter((r) => r.studentId === std.id);
      const scores = studentRes.map((r) => {
        const a = assessments.find((x) => x.id === r.assessmentId);
        return {
          title: a?.title || 'Asesmen',
          score: r.score,
          type: a?.type || 'formatif',
        };
      });

      const formatifScores = studentRes
        .filter((r) => {
          const a = assessments.find((x) => x.id === r.assessmentId);
          return a?.type === 'formatif';
        })
        .map((r) => r.score);

      const sumatifLMScores = studentRes
        .filter((r) => {
          const a = assessments.find((x) => x.id === r.assessmentId);
          return a?.type === 'sumatif_lingkup_materi';
        })
        .map((r) => r.score);

      const sumatifSAS = studentRes
        .filter((r) => {
          const a = assessments.find((x) => x.id === r.assessmentId);
          return a?.type === 'sumatif_akhir_semester';
        })
        .map((r) => r.score);

      const avgFormatif =
        formatifScores.length > 0
          ? Math.round(formatifScores.reduce((a, b) => a + b, 0) / formatifScores.length)
          : 80;
      const avgSumatifLM =
        sumatifLMScores.length > 0
          ? Math.round(sumatifLMScores.reduce((a, b) => a + b, 0) / sumatifLMScores.length)
          : 82;
      const valSAS = sumatifSAS.length > 0 ? sumatifSAS[0] : 84;
      const finalGrade = Math.round((avgFormatif + avgSumatifLM * 2 + valSAS * 2) / 5);
      const achievementStatus: 'Sangat Baik' | 'Baik' | 'Perlu Bimbingan' =
        finalGrade >= 85 ? 'Sangat Baik' : finalGrade >= 75 ? 'Baik' : 'Perlu Bimbingan';

      map.set(std.id, { finalGrade, achievementStatus, scores });
    }
    return map;
  }, [students, assessments, assessmentResults]);

  const selectedStudent = useMemo(() => {
    return students.find((s) => s.id === selectedStudentId) || students[0];
  }, [students, selectedStudentId]);

  const selectedReport = useMemo(() => {
    if (!selectedStudent) return undefined;
    return studentReports.find((r) => r.studentId === selectedStudent.id);
  }, [studentReports, selectedStudent]);

  // Sync edit form with selected report
  React.useEffect(() => {
    if (selectedReport) {
      setEditDevelopmentSummary(selectedReport.developmentSummary || '');
      setEditStrengths(selectedReport.strengths?.join('\n') || '');
      setEditGrowthAreas(selectedReport.growthAreas?.join('\n') || '');
      setEditFollowUpNarrative(selectedReport.followUpNarrative || '');
      setEditHomeActivities(selectedReport.homeActivities?.join('\n') || '');
      setIsEditing(false);
    }
  }, [selectedReport]);

  const completedCount = useMemo(() => {
    return students.filter((s) => studentReports.some((r) => r.studentId === s.id)).length;
  }, [students, studentReports]);

  // Helper to generate report for one student
  const generateReportForStudent = async (student: Student): Promise<StudentLearningReport> => {
    const studentData = studentGradeMap.get(student.id) || {
      finalGrade: 80,
      achievementStatus: 'Baik',
      scores: [],
    };

    const tpStatements = (tp?.items || []).map((t) => t.statement).filter(Boolean);

    const input = {
      student,
      academicSetting,
      semesterPlanId,
      scores: studentData.scores,
      tpStatements,
      finalGrade: studentData.finalGrade,
      achievementStatus: studentData.achievementStatus,
    };

    try {
      const rawAi = await generateStudentReportWithAI({
        student,
        academicSetting,
        scores: studentData.scores,
        tps: tpStatements,
        finalGrade: studentData.finalGrade,
        achievementStatus: studentData.achievementStatus,
      });

      return normalizeStudentReport(rawAi, input);
    } catch (err: any) {
      // Deterministic pedagogic fallback ensures report generation never crashes
      return createDeterministicStudentReport(input);
    }
  };

  // Handler: Generate Single Report
  const handleGenerateSingle = async (student: Student) => {
    if (batchProgress.isActive || isSingleGenerating) return;
    setIsSingleGenerating(true);
    try {
      const newReport = await generateReportForStudent(student);
      const existingReports = studentReports || [];
      const updated = existingReports.some((r) => r.studentId === student.id)
        ? existingReports.map((r) => (r.studentId === student.id ? newReport : r))
        : [...existingReports, newReport];

      onSaveStudentReports(updated);
      setNotification({
        type: 'success',
        message: `Laporan belajar untuk ${student.name} berhasil disusun dan disimpan!`,
      });
      setTimeout(() => setNotification(null), 3500);
    } catch (err: any) {
      setNotification({
        type: 'error',
        message: `Gagal menyusun laporan: ${err.message || String(err)}`,
      });
    } finally {
      setIsSingleGenerating(false);
    }
  };

  // Handler: Batch Generation for All Students
  const handleBatchGenerate = async () => {
    if (students.length === 0 || batchProgress.isActive || isSingleGenerating) return;

    let currentList = [...(studentReports || [])];
    let failed = 0;

    setBatchProgress({
      isActive: true,
      total: students.length,
      completed: 0,
      currentStudentName: students[0].name,
      failedCount: 0,
    });

    for (let i = 0; i < students.length; i++) {
      const student = students[i];
      setBatchProgress({
        isActive: true,
        total: students.length,
        completed: i,
        currentStudentName: student.name,
        failedCount: failed,
      });

      try {
        const report = await generateReportForStudent(student);
        const idx = currentList.findIndex((r) => r.studentId === student.id);
        if (idx >= 0) {
          currentList[idx] = report;
        } else {
          currentList.push(report);
        }
        // Save progressively to persistence after each student completes
        onSaveStudentReports([...currentList]);
      } catch (err) {
        failed++;
      }
    }

    setBatchProgress({
      isActive: false,
      total: students.length,
      completed: students.length,
      currentStudentName: '',
      failedCount: failed,
    });

    setNotification({
      type: 'success',
      message: `Penyusunan laporan selesai! ${students.length - failed} dari ${students.length} laporan berhasil disimpan.`,
    });
    setTimeout(() => setNotification(null), 4000);
  };

  // Handler: Save Manual Edits
  const handleSaveEdits = () => {
    if (!selectedReport || !selectedStudent) return;

    const updatedReport: StudentLearningReport = {
      ...selectedReport,
      developmentSummary: editDevelopmentSummary.trim() || selectedReport.developmentSummary,
      strengths: editStrengths.split('\n').map((s) => s.trim()).filter(Boolean),
      growthAreas: editGrowthAreas.split('\n').map((s) => s.trim()).filter(Boolean),
      followUpNarrative: editFollowUpNarrative.trim() || selectedReport.followUpNarrative,
      homeActivities: editHomeActivities.split('\n').map((s) => s.trim()).filter(Boolean),
      updatedAt: new Date().toISOString(),
    };

    const updatedList = (studentReports || []).map((r) =>
      r.studentId === selectedStudent.id ? updatedReport : r
    );

    onSaveStudentReports(updatedList);
    setIsEditing(false);
    setNotification({
      type: 'success',
      message: `Perubahan laporan untuk ${selectedStudent.name} berhasil disimpan!`,
    });
    setTimeout(() => setNotification(null), 3000);
  };

  // Clean Identity Formatter: avoids "Kelas Kelas 1 A" bug
  const cleanClassName = formatClassIdentity(academicSetting.grade, academicSetting.classSection);

  return (
    <div className="space-y-6" id="student-report-manager-container">
      {/* Toast Notification */}
      {notification && (
        <div
          className={`p-4 rounded-xl flex items-center gap-3 border shadow-xs ${
            notification.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
              : 'bg-rose-50 border-rose-200 text-rose-800'
          }`}
        >
          {notification.type === 'success' ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
          )}
          <p className="text-xs font-semibold">{notification.message}</p>
        </div>
      )}

      {/* Header Banner */}
      <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-5">
          <div>
            <div className="flex items-center gap-2 text-indigo-700 font-bold text-xs tracking-wider uppercase">
              <FileText className="w-4 h-4" />
              <span>Modul Rapor & Laporan Belajar Murid</span>
            </div>
            <h2 className="text-xl font-bold text-slate-900 mt-1">
              Laporan Perkembangan Belajar Siswa (Rapor Merdeka)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Menyusun narasi perkembangan komprehensif 5 dimensi: perkembangan, kekuatan, area bimbingan, tindak lanjut, dan aktivitas bersama keluarga di rumah ({academicSetting.subject} • {cleanClassName})
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleBatchGenerate}
              disabled={batchProgress.isActive || isSingleGenerating || students.length === 0}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-xl shadow-xs transition-colors"
            >
              <Sparkles className="w-4 h-4" />
              <span>Susun Semua Laporan (Batch AI)</span>
            </button>
          </div>
        </div>

        {/* Progress summary badges */}
        <div className="flex flex-wrap items-center gap-3 mt-4 text-xs">
          <span className="bg-slate-100 text-slate-700 font-semibold px-3 py-1 rounded-full border border-slate-200">
            Total Siswa: {students.length}
          </span>
          <span className="bg-emerald-50 text-emerald-700 font-semibold px-3 py-1 rounded-full border border-emerald-200 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Laporan Tersimpan: {completedCount} dari {students.length}
          </span>
          {completedCount < students.length && (
            <span className="bg-amber-50 text-amber-700 font-medium px-3 py-1 rounded-full border border-amber-200">
              Belum Disusun: {students.length - completedCount} Siswa
            </span>
          )}
        </div>
      </div>

      {/* BATCH PROGRESS UI */}
      {batchProgress.isActive && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-5 shadow-xs animate-in fade-in">
          <div className="flex items-center justify-between text-xs font-bold text-indigo-900 mb-2.5">
            <div className="flex items-center gap-2.5">
              <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
              <span>
                Menyusun laporan {batchProgress.completed + 1} dari {batchProgress.total} — {batchProgress.currentStudentName}
              </span>
            </div>
            <span className="font-mono text-indigo-700">
              {Math.round(((batchProgress.completed + 1) / batchProgress.total) * 100)}%
            </span>
          </div>

          <div className="w-full bg-indigo-200 rounded-full h-2.5 overflow-hidden">
            <div
              className="bg-indigo-600 h-2.5 rounded-full transition-all duration-300"
              style={{
                width: `${Math.round(((batchProgress.completed + 1) / batchProgress.total) * 100)}%`,
              }}
            />
          </div>

          {batchProgress.failedCount > 0 && (
            <p className="text-[11px] text-rose-600 font-medium mt-2">
              {batchProgress.failedCount} siswa mengalami kendala pemrosesan.
            </p>
          )}
        </div>
      )}

      {/* Main Layout: Master-Detail */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Student Roster List */}
        <div className="lg:col-span-4 space-y-3">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
            <div className="p-4 bg-slate-50 border-b border-slate-200 flex justify-between items-center">
              <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                Daftar Siswa ({students.length})
              </h3>
              <span className="text-[11px] text-slate-500 font-medium">
                Pilih untuk melihat laporan
              </span>
            </div>

            <div className="divide-y divide-slate-100 max-h-[640px] overflow-y-auto">
              {students.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400">
                  Belum ada siswa di daftar kelas ini.
                </div>
              ) : (
                students.map((std, idx) => {
                  const isSelected = std.id === selectedStudent?.id;
                  const report = studentReports.find((r) => r.studentId === std.id);
                  const isReady = !!report;
                  const gradeData = studentGradeMap.get(std.id);

                  return (
                    <div
                      key={std.id}
                      onClick={() => setSelectedStudentId(std.id)}
                      className={`p-3.5 cursor-pointer transition-all flex items-center justify-between gap-3 ${
                        isSelected
                          ? 'bg-indigo-50/80 border-l-4 border-indigo-600 text-indigo-900'
                          : 'hover:bg-slate-50 text-slate-700'
                      }`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="w-5 text-[11px] font-mono text-slate-400 shrink-0 text-center">
                          {idx + 1}
                        </span>
                        <div className="min-w-0">
                          <p className="text-xs font-bold truncate">{std.name}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            {std.nisn && (
                              <span className="text-[10px] text-slate-400 font-mono">
                                NISN: {std.nisn}
                              </span>
                            )}
                            {gradeData && (
                              <span className="text-[10px] font-semibold text-slate-500">
                                Nilai: {gradeData.finalGrade}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {isReady ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                            <CheckCircle2 className="w-3 h-3" />
                            Selesai
                          </span>
                        ) : (
                          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">
                            Belum Ada
                          </span>
                        )}
                        <ChevronRight className="w-4 h-4 text-slate-400" />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Comprehensive Report Preview & Editor */}
        <div className="lg:col-span-8 space-y-4">
          {selectedStudent ? (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 space-y-6">
              {/* Report Header Card & Identity */}
              <div className="bg-slate-900 text-white rounded-xl p-5 border border-slate-800">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold uppercase tracking-wider bg-indigo-500/30 text-indigo-300 px-2.5 py-0.5 rounded-full border border-indigo-400/30">
                      Rapor Kurikulum Merdeka
                    </span>
                    <h3 className="text-lg font-bold text-white mt-1">
                      {selectedStudent.name}
                    </h3>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-300">
                      {/* Identity: cleanly renders "Kelas 1 A", never "Kelas Kelas 1 A" */}
                      <span>{cleanClassName}</span>
                      {selectedStudent.nisn && (
                        <span>NISN: {selectedStudent.nisn}</span>
                      )}
                      {/* Age: only rendered if available and not "-", never renders "Usia -" */}
                      {selectedStudent.age !== undefined &&
                        selectedStudent.age !== null &&
                        String(selectedStudent.age).trim() !== '' &&
                        String(selectedStudent.age).trim() !== '-' && (
                          <span>Usia: {selectedStudent.age} Tahun</span>
                        )}
                      <span>
                        Semester {academicSetting.semester} • {academicSetting.academicYear}
                      </span>
                    </div>
                  </div>

                  <div className="text-right sm:border-l sm:border-slate-800 sm:pl-4">
                    <p className="text-[11px] text-slate-400">Nilai Akhir Rapor</p>
                    <p className="text-2xl font-black text-indigo-400">
                      {studentGradeMap.get(selectedStudent.id)?.finalGrade || 80}
                    </p>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        (studentGradeMap.get(selectedStudent.id)?.finalGrade || 80) >= 85
                          ? 'bg-emerald-500/20 text-emerald-300'
                          : 'bg-sky-500/20 text-sky-300'
                      }`}
                    >
                      {studentGradeMap.get(selectedStudent.id)?.achievementStatus || 'Baik'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 pb-4">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleGenerateSingle(selectedStudent)}
                    disabled={isSingleGenerating || batchProgress.isActive}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg border border-indigo-200 transition-colors disabled:opacity-50"
                  >
                    {isSingleGenerating ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    <span>{selectedReport ? 'Susun Ulang dengan AI' : 'Susun Laporan dengan AI'}</span>
                  </button>

                  {selectedReport && (
                    <button
                      type="button"
                      onClick={() => setIsEditing(!isEditing)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg border border-slate-300 transition-colors"
                    >
                      {isEditing ? <RotateCcw className="w-3.5 h-3.5" /> : <FileText className="w-3.5 h-3.5" />}
                      <span>{isEditing ? 'Batal Edit' : 'Edit Narasi'}</span>
                    </button>
                  )}
                </div>

                {isEditing && selectedReport && (
                  <button
                    type="button"
                    onClick={handleSaveEdits}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg shadow-2xs transition-colors"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>Simpan Perubahan Laporan</span>
                  </button>
                )}
              </div>

              {/* 5-DIMENSION REPORT CONTENT CONTRACT */}
              {selectedReport ? (
                <div className="space-y-6">
                  {/* 1. Ringkasan Perkembangan */}
                  <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/50 space-y-2">
                    <div className="flex items-center gap-2 text-indigo-800 font-bold text-xs uppercase tracking-wide">
                      <TrendingUp className="w-4 h-4 text-indigo-600" />
                      <h4>1. Ringkasan Perkembangan Belajar</h4>
                    </div>
                    {isEditing ? (
                      <textarea
                        rows={4}
                        value={editDevelopmentSummary}
                        onChange={(e) => setEditDevelopmentSummary(e.target.value)}
                        className="w-full text-xs p-3 border border-slate-300 rounded-lg bg-white leading-relaxed focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
                      />
                    ) : (
                      <p className="text-xs text-slate-700 leading-relaxed font-normal">
                        {selectedReport.developmentSummary}
                      </p>
                    )}
                  </div>

                  {/* 2. Kekuatan / Capaian Utama */}
                  <div className="p-4 rounded-xl border border-emerald-200 bg-emerald-50/40 space-y-2">
                    <div className="flex items-center gap-2 text-emerald-800 font-bold text-xs uppercase tracking-wide">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <h4>2. Kekuatan & Capaian Utama</h4>
                    </div>
                    {isEditing ? (
                      <textarea
                        rows={3}
                        value={editStrengths}
                        onChange={(e) => setEditStrengths(e.target.value)}
                        placeholder="Pisahkan tiap poin dengan baris baru"
                        className="w-full text-xs p-3 border border-emerald-300 rounded-lg bg-white leading-relaxed focus:ring-2 focus:ring-emerald-500 focus:outline-hidden"
                      />
                    ) : (
                      <ul className="list-disc list-inside space-y-1.5 text-xs text-slate-700">
                        {selectedReport.strengths?.map((item, idx) => (
                          <li key={idx} className="leading-relaxed">
                            {item}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {/* 3. Hal yang Perlu Dikembangkan */}
                  <div className="p-4 rounded-xl border border-amber-200 bg-amber-50/40 space-y-2">
                    <div className="flex items-center gap-2 text-amber-800 font-bold text-xs uppercase tracking-wide">
                      <Target className="w-4 h-4 text-amber-600" />
                      <h4>3. Hal yang Perlu Dikembangkan</h4>
                    </div>
                    {isEditing ? (
                      <textarea
                        rows={3}
                        value={editGrowthAreas}
                        onChange={(e) => setEditGrowthAreas(e.target.value)}
                        placeholder="Pisahkan tiap poin dengan baris baru"
                        className="w-full text-xs p-3 border border-amber-300 rounded-lg bg-white leading-relaxed focus:ring-2 focus:ring-amber-500 focus:outline-hidden"
                      />
                    ) : (
                      <ul className="list-disc list-inside space-y-1.5 text-xs text-slate-700">
                        {selectedReport.growthAreas?.map((item, idx) => (
                          <li key={idx} className="leading-relaxed">
                            {item}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {/* 4. Narasi / Tindak Lanjut Guru */}
                  <div className="p-4 rounded-xl border border-sky-200 bg-sky-50/40 space-y-2">
                    <div className="flex items-center gap-2 text-sky-800 font-bold text-xs uppercase tracking-wide">
                      <HeartHandshake className="w-4 h-4 text-sky-600" />
                      <h4>4. Narasi & Rekomendasi Tindak Lanjut Guru</h4>
                    </div>
                    {isEditing ? (
                      <textarea
                        rows={3}
                        value={editFollowUpNarrative}
                        onChange={(e) => setEditFollowUpNarrative(e.target.value)}
                        className="w-full text-xs p-3 border border-sky-300 rounded-lg bg-white leading-relaxed focus:ring-2 focus:ring-sky-500 focus:outline-hidden"
                      />
                    ) : (
                      <p className="text-xs text-slate-700 leading-relaxed font-normal">
                        {selectedReport.followUpNarrative}
                      </p>
                    )}
                  </div>

                  {/* 5. Aktivitas Bersama Keluarga di Rumah */}
                  <div className="p-4 rounded-xl border border-purple-200 bg-purple-50/40 space-y-2">
                    <div className="flex items-center gap-2 text-purple-800 font-bold text-xs uppercase tracking-wide">
                      <Home className="w-4 h-4 text-purple-600" />
                      <h4>5. Aktivitas Bersama Keluarga di Rumah (Ayo Bermain Bersama)</h4>
                    </div>
                    {isEditing ? (
                      <textarea
                        rows={3}
                        value={editHomeActivities}
                        onChange={(e) => setEditHomeActivities(e.target.value)}
                        placeholder="Pisahkan tiap ide aktivitas dengan baris baru"
                        className="w-full text-xs p-3 border border-purple-300 rounded-lg bg-white leading-relaxed focus:ring-2 focus:ring-purple-500 focus:outline-hidden"
                      />
                    ) : (
                      <ul className="list-disc list-inside space-y-1.5 text-xs text-slate-700">
                        {selectedReport.homeActivities?.map((item, idx) => (
                          <li key={idx} className="leading-relaxed">
                            {item}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ) : (
                /* Empty state when report is not yet generated */
                <div className="p-12 text-center rounded-2xl border-2 border-dashed border-slate-200 space-y-4">
                  <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto">
                    <FileText className="w-6 h-6" />
                  </div>
                  <div>
                    <h4 className="text-sm font-bold text-slate-800">
                      Laporan Belajar Belum Disusun
                    </h4>
                    <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
                      Klik tombol di bawah untuk menyusun draf narasi laporan perkembangan otomatis untuk {selectedStudent.name}.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleGenerateSingle(selectedStudent)}
                    disabled={isSingleGenerating}
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-xl shadow-xs transition-colors"
                  >
                    {isSingleGenerating ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Sparkles className="w-4 h-4" />
                    )}
                    <span>Susun Laporan Belajar Siswa Ini</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="p-12 text-center text-slate-400 bg-white rounded-2xl border border-slate-200">
              Pilih siswa di sebelah kiri untuk melihat laporan.
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
