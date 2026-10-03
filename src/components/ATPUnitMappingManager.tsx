import React, { useState, useEffect, useMemo } from 'react';
import {
  FolderTree,
  ArrowRight,
  ArrowLeft,
  Save,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Layers,
  Check,
  Plus,
  Trash2,
  Loader2,
  ListPlus,
  Info,
} from 'lucide-react';
import { ATPData, ATPItem, TPData, AcademicSetting } from '../types';
import { generateATPMappingWithAI, TeacherUnitConstraint } from '../services/aiService';

export interface ATPUnitMappingManagerProps {
  atp: ATPData;
  tp: TPData;
  academicSetting?: AcademicSetting;
  onSaveATP: (updatedAtp: ATPData) => void;
  onNextStep: () => void;
  onBackToATP: () => void;
}

export const ATPUnitMappingManager: React.FC<ATPUnitMappingManagerProps> = ({
  atp,
  tp,
  academicSetting,
  onSaveATP,
  onNextStep,
  onBackToATP,
}) => {
  // Sort items by canonical stepNumber
  const sortedInitialItems = useMemo(() => {
    return [...(atp.items || [])].sort(
      (a, b) => (a.stepNumber || 0) - (b.stepNumber || 0)
    );
  }, [atp.items]);

  const [items, setItems] = useState<ATPItem[]>(sortedInitialItems);
  const [hasChanges, setHasChanges] = useState(false);
  const [saveSuccessNotice, setSaveSuccessNotice] = useState(false);

  // Initial Bab titles extracted from existing items
  const initialUniqueUnits = useMemo(() => {
    const list: string[] = [];
    sortedInitialItems.forEach((it) => {
      const u = it.unitTitle?.trim();
      if (u && !list.includes(u)) {
        list.push(u);
      }
    });
    return list;
  }, [sortedInitialItems]);

  // Target count of Bab (default 6 or existing count)
  const [targetUnitCount, setTargetUnitCount] = useState<number>(() => {
    if (initialUniqueUnits.length > 0) {
      return Math.max(1, Math.min(15, initialUniqueUnits.length));
    }
    return 6;
  });

  // Explicit Bab title list managed in editor (allows empty Bab containers)
  const [customBabList, setCustomBabList] = useState<string[]>(() => {
    if (initialUniqueUnits.length > 0) {
      return initialUniqueUnits;
    }
    // Default placeholder containers up to targetUnitCount
    const initialPlaceholders: string[] = [];
    for (let i = 1; i <= 6; i++) {
      initialPlaceholders.push(`Bab ${i}`);
    }
    return initialPlaceholders;
  });

  // AI Operation States
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatingMode, setGeneratingMode] = useState<'ALL' | 'EMPTY_ONLY' | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSuccessMessage, setAiSuccessMessage] = useState<string | null>(null);

  // Sync state if atp.items updates from outside
  useEffect(() => {
    const sorted = [...(atp.items || [])].sort(
      (a, b) => (a.stepNumber || 0) - (b.stepNumber || 0)
    );
    setItems(sorted);
    setHasChanges(false);

    const uniqueUnits: string[] = [];
    sorted.forEach((it) => {
      const u = it.unitTitle?.trim();
      if (u && !uniqueUnits.includes(u)) {
        uniqueUnits.push(u);
      }
    });

    if (uniqueUnits.length > 0) {
      setCustomBabList((prev) => {
        // Merge existing customBabList with extracted units without duplicates
        const combined = [...prev];
        uniqueUnits.forEach((u) => {
          if (!combined.includes(u)) {
            combined.push(u);
          }
        });
        return combined;
      });
    }
  }, [atp.items]);

  // Resolve TP map for easy lookup
  const tpMap = useMemo(() => {
    const map = new Map<string, { code?: string; statement?: string; contentScope?: string }>();
    (tp.items || []).forEach((t) => {
      map.set(t.id, t);
    });
    return map;
  }, [tp.items]);

  // Combined ordered list of all active Bab titles
  const allBabTitles = useMemo(() => {
    const list: string[] = [];
    customBabList.forEach((b) => {
      const trimmed = b.trim();
      if (trimmed && !list.includes(trimmed)) {
        list.push(trimmed);
      }
    });
    items.forEach((it) => {
      const u = it.unitTitle?.trim();
      if (u && !list.includes(u)) {
        list.push(u);
      }
    });
    return list;
  }, [customBabList, items]);

  // Bab-centered grouped containers
  const babContainers = useMemo(() => {
    return allBabTitles.map((title, idx) => {
      const assignedItems = items.filter((it) => it.unitTitle?.trim() === title);
      return {
        index: idx + 1,
        title,
        items: assignedItems,
      };
    });
  }, [allBabTitles, items]);

  // Unassigned ATP items (items without unitTitle)
  const unassignedItems = useMemo(() => {
    return items.filter((it) => !it.unitTitle || it.unitTitle.trim().length === 0);
  }, [items]);

  // Total mapped items
  const mappedCount = useMemo(() => {
    return items.filter((it) => it.unitTitle && it.unitTitle.trim().length > 0).length;
  }, [items]);

  // Handlers for Manual Editing
  const handleRenameBab = (oldTitle: string, newTitle: string) => {
    const trimmedNew = newTitle;
    setCustomBabList((prev) =>
      prev.map((b) => (b.trim() === oldTitle.trim() ? trimmedNew : b))
    );

    // Update unitTitle of all ATP items currently assigned to this Bab
    setItems((prev) =>
      prev.map((it) => {
        if (it.unitTitle?.trim() === oldTitle.trim()) {
          return {
            ...it,
            unitTitle: trimmedNew,
          };
        }
        return it;
      })
    );

    setHasChanges(true);
    setSaveSuccessNotice(false);
  };

  const handleMaterialScopeChange = (atpItemId: string, newScope: string) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id === atpItemId) {
          return {
            ...it,
            materialScope: newScope,
          };
        }
        return it;
      })
    );
    setHasChanges(true);
    setSaveSuccessNotice(false);
  };

  const handleMoveItemToBab = (atpItemId: string, targetBabTitle: string) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.id === atpItemId) {
          return {
            ...it,
            unitTitle: targetBabTitle,
          };
        }
        return it;
      })
    );
    setHasChanges(true);
    setSaveSuccessNotice(false);
  };

  const handleAddEmptyBab = () => {
    const nextNum = allBabTitles.length + 1;
    const newTitle = `Bab ${nextNum}: (Judul Bab Baru)`;
    setCustomBabList((prev) => [...prev, newTitle]);
    setTargetUnitCount((prev) => Math.max(prev, allBabTitles.length + 1));
    setHasChanges(true);
    setSaveSuccessNotice(false);
  };

  const handleRemoveBab = (babTitle: string) => {
    // Remove from customBabList
    setCustomBabList((prev) => prev.filter((b) => b.trim() !== babTitle.trim()));

    // Unassign any items that were assigned to this Bab
    setItems((prev) =>
      prev.map((it) => {
        if (it.unitTitle?.trim() === babTitle.trim()) {
          return {
            ...it,
            unitTitle: '',
          };
        }
        return it;
      })
    );

    setTargetUnitCount((prev) => Math.max(1, prev - 1));
    setHasChanges(true);
    setSaveSuccessNotice(false);
  };

  const handleTargetCountChange = (newCount: number) => {
    const clamped = Math.max(1, Math.min(15, newCount));
    setTargetUnitCount(clamped);

    // If newCount is greater than current allBabTitles length, add placeholder Bab containers
    if (clamped > allBabTitles.length) {
      const toAdd = clamped - allBabTitles.length;
      const newSlots: string[] = [];
      for (let i = 1; i <= toAdd; i++) {
        newSlots.push(`Bab ${allBabTitles.length + i}`);
      }
      setCustomBabList((prev) => [...prev, ...newSlots]);
      setHasChanges(true);
    }
  };

  // AI Generation Implementation (Supports "Generate Pemetaan" and "Lengkapi yang Kosong")
  const handleExecuteAI = async (mode: 'ALL' | 'EMPTY_ONLY') => {
    if (items.length === 0) {
      setAiError('Daftar langkah ATP masih kosong. Susun ATP terlebih dahulu.');
      return;
    }

    setIsGenerating(true);
    setGeneratingMode(mode);
    setAiError(null);
    setAiSuccessMessage(null);

    try {
      // Build teacher unit constraints from currently defined Bab titles
      const teacherConstraints: TeacherUnitConstraint[] = [];
      allBabTitles.forEach((title, idx) => {
        if (title && title.trim().length > 0 && !title.includes('(Judul Bab Baru)')) {
          teacherConstraints.push({
            unitIndex: idx + 1,
            unitTitle: title.trim(),
          });
        }
      });

      const payload = {
        atpItems: items.map((it, idx) => {
          const tpItem = tpMap.get(it.tpId);
          return {
            id: it.id,
            stepNumber: it.stepNumber || idx + 1,
            tpCode: it.tpCode || tpItem?.code || `TP-${idx + 1}`,
            tpStatement: it.tpStatement || tpItem?.statement || '',
            tpContentScope: tpItem?.contentScope || '',
            unitTitle: it.unitTitle?.trim() || undefined,
            materialScope: it.materialScope?.trim() || undefined,
          };
        }),
        subject: academicSetting?.subject || 'Mata Pelajaran',
        grade: academicSetting?.grade || 'Kelas',
        phase: academicSetting?.phase || 'Fase',
        targetUnitCount,
        teacherUnits: teacherConstraints,
        completeEmptyOnly: mode === 'EMPTY_ONLY',
      };

      const result = await generateATPMappingWithAI(payload);

      // Collect new units from AI
      if (result.units && Array.isArray(result.units) && result.units.length > 0) {
        setCustomBabList((prevList) => {
          const updated = [...prevList];
          result.units.forEach((u) => {
            const idx = u.unitIndex - 1;
            if (idx >= 0 && idx < updated.length) {
              // Preserve non-empty teacher value! Only fill empty or default placeholders
              if (
                !updated[idx] ||
                updated[idx].trim().length === 0 ||
                updated[idx].includes('(Judul Bab Baru)') ||
                updated[idx] === `Bab ${u.unitIndex}`
              ) {
                updated[idx] = u.unitTitle;
              }
            } else {
              updated.push(u.unitTitle);
            }
          });
          return updated;
        });
      }

      // STRICT MERGE SAFETY RULE:
      // Teacher input has highest priority!
      // AI may COMPLETE missing mapping but must NEVER overwrite a non-empty teacher value!
      let filledCount = 0;
      setItems((prevItems) => {
        return prevItems.map((currentItem) => {
          const aiMapping = result.mappings.find((m) => m.atpItemId === currentItem.id);
          if (!aiMapping) return currentItem;

          const currentUnit = currentItem.unitTitle?.trim();
          const currentScope = currentItem.materialScope?.trim();

          const isUnitEmpty = !currentUnit || currentUnit.length === 0;
          const isScopeEmpty = !currentScope || currentScope.length === 0;

          if (isUnitEmpty || isScopeEmpty) {
            filledCount++;
          }

          // Strict preservation:
          const finalUnitTitle = !isUnitEmpty ? currentUnit! : (aiMapping.unitTitle || '');
          const finalMaterialScope = !isScopeEmpty ? currentScope! : (aiMapping.materialScope || '');

          return {
            ...currentItem,
            unitTitle: finalUnitTitle,
            materialScope: finalMaterialScope,
          };
        });
      });

      setHasChanges(true);
      const successText =
        mode === 'EMPTY_ONLY'
          ? `AI berhasil melengkapi bidang kosong pada pemetaan. Nilai yang sudah Anda isi tetap aman.`
          : `AI berhasil menyusun pemetaan untuk ${targetUnitCount} Bab. Seluruh nilai yang sudah Anda isi tetap dipertahankan.`;

      setAiSuccessMessage(successText);
      setTimeout(() => setAiSuccessMessage(null), 6000);
    } catch (err: any) {
      setAiError(err.message || 'Gagal menyusun pemetaan Unit/Bab dengan AI.');
    } finally {
      setIsGenerating(false);
      setGeneratingMode(null);
    }
  };

  const handleSave = () => {
    const updatedATP: ATPData = {
      ...atp,
      items: items.map((it, idx) => ({
        ...it,
        stepNumber: it.stepNumber || idx + 1,
      })),
      updatedAt: new Date().toISOString(),
    };

    onSaveATP(updatedATP);
    setHasChanges(false);
    setSaveSuccessNotice(true);
    setTimeout(() => setSaveSuccessNotice(false), 3500);
  };

  const handleProceedNext = () => {
    if (hasChanges) {
      const updatedATP: ATPData = {
        ...atp,
        items: items.map((it, idx) => ({
          ...it,
          stepNumber: it.stepNumber || idx + 1,
        })),
        updatedAt: new Date().toISOString(),
      };
      onSaveATP(updatedATP);
    }
    onNextStep();
  };

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-white rounded-2xl p-6 border border-slate-200/80 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-lg bg-blue-100 text-blue-900 text-xs font-bold flex items-center justify-center">
                07
              </span>
              <h3 className="text-lg font-bold text-slate-900 tracking-tight flex items-center gap-2">
                <FolderTree className="w-5 h-5 text-blue-700" />
                <span>Pemetaan ATP ke Unit / Bab & Lingkup Materi</span>
              </h3>
            </div>
            <p className="text-xs text-slate-500 mt-1 max-w-3xl leading-relaxed">
              Kelompokkan langkah-langkah Alur Tujuan Pembelajaran (ATP) ke dalam <strong>Unit / Bab</strong> dan rumuskan fokus <strong>Lingkup Materi Inti</strong>. Setiap Bab menjadi wadah tematis yang memayungi langkah ATP secara logis.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              id="btn-save-mapping"
              type="button"
              onClick={handleSave}
              disabled={!hasChanges}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold text-white bg-blue-800 hover:bg-blue-900 disabled:bg-slate-200 disabled:text-slate-400 transition cursor-pointer shadow-xs disabled:cursor-not-allowed"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Simpan Pemetaan</span>
            </button>
          </div>
        </div>

        {/* Status Alerts */}
        {saveSuccessNotice && (
          <div className="mt-3 p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center gap-2 animate-fadeIn">
            <Check className="w-4 h-4 text-emerald-600" />
            <span>Perubahan pemetaan Unit/Bab dan Lingkup Materi berhasil disimpan ke data ATP.</span>
          </div>
        )}

        {hasChanges && !saveSuccessNotice && (
          <div className="mt-3 p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-medium flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>Terdapat perubahan Unit/Bab atau Lingkup Materi yang belum disimpan. Klik "Simpan Pemetaan" atau lanjutkan untuk menyimpan otomatis.</span>
          </div>
        )}
      </div>

      {/* Top Controls: Target Count, AI Buttons & Add Bab */}
      <div className="bg-white rounded-2xl border border-indigo-100 shadow-xs p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {/* Target Count Input */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-slate-50 px-3.5 py-2 rounded-xl border border-slate-200">
              <label htmlFor="target-unit-count" className="text-xs font-bold text-slate-800 whitespace-nowrap">
                Target Jumlah Bab:
              </label>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => handleTargetCountChange(targetUnitCount - 1)}
                  disabled={targetUnitCount <= 1 || isGenerating}
                  className="w-7 h-7 rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 flex items-center justify-center text-xs font-bold disabled:opacity-40 cursor-pointer"
                >
                  -
                </button>
                <input
                  id="target-unit-count"
                  type="number"
                  min={1}
                  max={15}
                  value={targetUnitCount}
                  onChange={(e) => handleTargetCountChange(parseInt(e.target.value, 10) || 1)}
                  disabled={isGenerating}
                  className="w-12 text-center text-xs font-bold py-1 rounded-md border border-slate-300 bg-white"
                />
                <button
                  type="button"
                  onClick={() => handleTargetCountChange(targetUnitCount + 1)}
                  disabled={targetUnitCount >= 15 || isGenerating}
                  className="w-7 h-7 rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 flex items-center justify-center text-xs font-bold disabled:opacity-40 cursor-pointer"
                >
                  +
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={handleAddEmptyBab}
              disabled={isGenerating}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-dashed border-indigo-300 text-indigo-700 hover:bg-indigo-50 text-xs font-bold transition cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Tambah Bab Baru</span>
            </button>
          </div>

          {/* AI Action Buttons */}
          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              id="btn-generate-ai-mapping"
              type="button"
              onClick={() => handleExecuteAI('ALL')}
              disabled={isGenerating || items.length === 0}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-300 disabled:text-slate-500 shadow-xs transition cursor-pointer disabled:cursor-not-allowed"
            >
              {isGenerating && generatingMode === 'ALL' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  <span>Menyusun Pemetaan...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4 text-indigo-200" />
                  <span>Generate Pemetaan AI</span>
                </>
              )}
            </button>

            <button
              id="btn-complete-missing-mapping"
              type="button"
              onClick={() => handleExecuteAI('EMPTY_ONLY')}
              disabled={isGenerating || items.length === 0}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-indigo-900 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 disabled:bg-slate-100 disabled:text-slate-400 shadow-2xs transition cursor-pointer disabled:cursor-not-allowed"
            >
              {isGenerating && generatingMode === 'EMPTY_ONLY' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-indigo-700" />
                  <span>Melengkapi...</span>
                </>
              ) : (
                <>
                  <ListPlus className="w-4 h-4 text-indigo-700" />
                  <span>Lengkapi yang Kosong</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Informational Guidance Notice */}
        <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/80 flex items-start gap-2.5 text-xs text-slate-600">
          <Info className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
          <p>
            <strong>Prinsip Otoritas:</strong> Guru memegang otoritas penuh. Setiap nama Bab atau Lingkup Materi yang Anda isi tidak akan pernah ditimpa oleh AI. Anda dapat memindahkan butir ATP antar-Bab menggunakan pemilih tujuan pada tiap baris.
          </p>
        </div>

        {/* AI Error Alert */}
        {aiError && (
          <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium flex items-center justify-between gap-2 animate-fadeIn">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{aiError}</span>
            </div>
            <button
              type="button"
              onClick={() => setAiError(null)}
              className="text-xs font-bold text-rose-600 hover:underline cursor-pointer"
            >
              Tutup
            </button>
          </div>
        )}

        {/* AI Success Message */}
        {aiSuccessMessage && (
          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-medium flex items-center gap-2 animate-fadeIn">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>{aiSuccessMessage}</span>
          </div>
        )}
      </div>

      {/* Overview Stat Bar */}
      <div className="flex items-center justify-between text-xs text-slate-500 px-1">
        <div className="flex items-center gap-2 font-semibold">
          <Layers className="w-4 h-4 text-blue-700" />
          <span>Struktur Unit: {babContainers.length} Bab Terdaftar</span>
        </div>
        <div>
          <span>Terpetakan: <strong className="text-slate-800">{mappedCount}</strong> dari {items.length} Langkah ATP</span>
        </div>
      </div>

      {/* Bab-Centered Editor: List of Bab Containers */}
      <div className="space-y-5">
        {babContainers.map((bab, bIdx) => (
          <div
            key={`bab-container-${bab.title || bIdx}`}
            className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden transition"
          >
            {/* Bab Container Header */}
            <div className="bg-slate-50/90 p-4 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div className="flex items-center gap-3 flex-1">
                <span className="px-3 py-1 rounded-xl bg-blue-900 text-white font-bold text-xs shrink-0 shadow-2xs">
                  BAB {bIdx + 1}
                </span>
                <div className="flex-1 flex items-center gap-2">
                  <label htmlFor={`bab-title-input-${bIdx}`} className="sr-only">Judul Bab</label>
                  <input
                    id={`bab-title-input-${bIdx}`}
                    type="text"
                    value={bab.title}
                    placeholder={`Judul Bab ${bIdx + 1}...`}
                    onChange={(e) => handleRenameBab(bab.title, e.target.value)}
                    className="w-full text-sm font-bold text-slate-900 px-3 py-1.5 rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-600 bg-white"
                  />
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11px] font-bold text-slate-500 bg-white px-2.5 py-1 rounded-lg border border-slate-200">
                  {bab.items.length} Langkah ATP
                </span>

                {bab.items.length === 0 && (
                  <button
                    type="button"
                    title="Hapus Bab Kosong Ini"
                    onClick={() => handleRemoveBab(bab.title)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-rose-600 hover:bg-rose-50 border border-rose-200 text-xs font-bold transition cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Hapus Bab</span>
                  </button>
                )}
              </div>
            </div>

            {/* List of ATP Steps Assigned to This Bab */}
            {bab.items.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400 italic bg-white">
                Belum ada langkah ATP yang ditugaskan ke Bab ini. Pindahkan langkah ATP dari bab lain atau dari kelompok belum terpetakan.
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {bab.items.map((item, itemIdx) => {
                  const tpItem = item.tpId ? tpMap.get(item.tpId) : undefined;
                  const tpCode = item.tpCode || tpItem?.code || `TP-${itemIdx + 1}`;
                  const tpStatement = item.tpStatement || tpItem?.statement || '-';
                  const tpContentScope = tpItem?.contentScope;

                  return (
                    <div
                      key={item.id || `atp-${item.stepNumber || itemIdx}`}
                      className="p-4 sm:p-5 hover:bg-slate-50/40 transition flex flex-col lg:flex-row lg:items-start gap-4"
                    >
                      {/* Column 1: Step Number & TP Code */}
                      <div className="w-full lg:w-44 shrink-0 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center justify-center px-2.5 py-1 rounded-lg bg-blue-900 text-white font-bold text-xs shadow-2xs">
                            Langkah {item.stepNumber || itemIdx + 1}
                          </span>
                          <span className="px-2 py-0.5 rounded-md bg-blue-50 border border-blue-200 text-blue-800 font-bold text-xs">
                            {tpCode}
                          </span>
                        </div>
                      </div>

                      {/* Column 2: Canonical TP Statement */}
                      <div className="flex-1 space-y-1">
                        <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                          Tujuan Pembelajaran (Canonical TP)
                        </div>
                        <p className="text-xs text-slate-800 leading-relaxed font-normal">
                          {tpStatement}
                        </p>
                        {tpContentScope && (
                          <div className="text-[11px] text-slate-500 flex items-center gap-1 pt-0.5">
                            <span className="font-semibold text-slate-600">Materi TP Asal:</span>
                            <span>{tpContentScope}</span>
                          </div>
                        )}
                      </div>

                      {/* Column 3: Editable Lingkup Materi */}
                      <div className="w-full lg:w-80 shrink-0 space-y-1">
                        <label className="block text-[11px] font-bold text-slate-700 uppercase">
                          Lingkup Materi Inti <span className="text-blue-600">*</span>
                        </label>
                        <input
                          type="text"
                          value={item.materialScope || ''}
                          placeholder="e.g. Ide Pokok dan Struktur Teks"
                          onChange={(e) => handleMaterialScopeChange(item.id, e.target.value)}
                          className="w-full text-xs font-medium px-3 py-2 rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-600 bg-white"
                        />
                      </div>

                      {/* Column 4: Move / Reassign Dropdown */}
                      <div className="w-full lg:w-48 shrink-0 space-y-1">
                        <label className="block text-[11px] font-bold text-slate-500 uppercase">
                          Pindahkan ke:
                        </label>
                        <select
                          value={item.unitTitle || ''}
                          onChange={(e) => handleMoveItemToBab(item.id, e.target.value)}
                          className="w-full text-xs font-bold text-slate-800 bg-white px-3 py-2 rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-600 cursor-pointer"
                        >
                          {allBabTitles.map((targetTitle, tIdx) => (
                            <option key={`target-opt-${tIdx}`} value={targetTitle}>
                              Bab {tIdx + 1}: {targetTitle}
                            </option>
                          ))}
                          <option value="">-- Belum Dikelompokkan --</option>
                        </select>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}

        {/* Unassigned ATP Items Container (If Any) */}
        {unassignedItems.length > 0 && (
          <div className="bg-amber-50/50 rounded-2xl border border-amber-200 shadow-xs overflow-hidden">
            <div className="bg-amber-100/70 p-4 border-b border-amber-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-700" />
                <h4 className="text-xs font-bold text-amber-900 uppercase tracking-wider">
                  Langkah ATP Belum Dikelompokkan ke Bab ({unassignedItems.length} Langkah)
                </h4>
              </div>
              <span className="text-[11px] text-amber-800 font-medium">
                Pilih Bab tujuan untuk menugaskan langkah-langkah ini
              </span>
            </div>

            <div className="divide-y divide-amber-100/60 bg-white">
              {unassignedItems.map((item, uIdx) => {
                const tpItem = item.tpId ? tpMap.get(item.tpId) : undefined;
                const tpCode = item.tpCode || tpItem?.code || `TP-${uIdx + 1}`;
                const tpStatement = item.tpStatement || tpItem?.statement || '-';

                return (
                  <div
                    key={item.id || `unassigned-${item.stepNumber || uIdx}`}
                    className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-start gap-4"
                  >
                    <div className="w-full lg:w-44 shrink-0 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center justify-center px-2.5 py-1 rounded-lg bg-amber-800 text-white font-bold text-xs">
                          Langkah {item.stepNumber || uIdx + 1}
                        </span>
                        <span className="px-2 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-amber-900 font-bold text-xs">
                          {tpCode}
                        </span>
                      </div>
                    </div>

                    <div className="flex-1 space-y-1">
                      <p className="text-xs text-slate-800 leading-relaxed">
                        {tpStatement}
                      </p>
                    </div>

                    <div className="w-full lg:w-80 shrink-0 space-y-1">
                      <label className="block text-[11px] font-bold text-slate-700 uppercase">
                        Lingkup Materi Inti
                      </label>
                      <input
                        type="text"
                        value={item.materialScope || ''}
                        placeholder="e.g. Lingkup materi..."
                        onChange={(e) => handleMaterialScopeChange(item.id, e.target.value)}
                        className="w-full text-xs font-medium px-3 py-2 rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-amber-600 bg-white"
                      />
                    </div>

                    <div className="w-full lg:w-48 shrink-0 space-y-1">
                      <label className="block text-[11px] font-bold text-slate-700 uppercase">
                        Tugaskan ke Bab:
                      </label>
                      <select
                        value={item.unitTitle || ''}
                        onChange={(e) => handleMoveItemToBab(item.id, e.target.value)}
                        className="w-full text-xs font-bold text-indigo-900 bg-indigo-50/80 px-3 py-2 rounded-xl border border-indigo-200 focus:outline-hidden focus:ring-2 focus:ring-indigo-600 cursor-pointer"
                      >
                        <option value="">Pilih Bab Tujuan...</option>
                        {allBabTitles.map((targetTitle, tIdx) => (
                          <option key={`unassign-opt-${tIdx}`} value={targetTitle}>
                            Bab {tIdx + 1}: {targetTitle}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Navigation Buttons */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-4 border-t border-slate-200">
        <button
          id="btn-back-to-atp"
          type="button"
          onClick={onBackToATP}
          className="w-full sm:w-auto flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 shadow-xs transition cursor-pointer"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Kembali ke Alur Tujuan Pembelajaran (06)</span>
        </button>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            id="btn-next-to-annual-planning"
            type="button"
            onClick={handleProceedNext}
            className="w-full sm:w-auto flex items-center justify-center gap-2 bg-blue-900 hover:bg-blue-950 text-white py-2.5 px-6 rounded-xl text-sm font-semibold shadow-sm transition cursor-pointer"
          >
            <span>Lanjut ke Perencanaan Tahunan (08)</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
