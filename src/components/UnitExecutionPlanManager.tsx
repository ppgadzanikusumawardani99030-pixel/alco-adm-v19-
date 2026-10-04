import React, { useState, useMemo, useEffect } from 'react';
import {
  ATPUnitMappingData,
  UnitExecutionPlanData,
  UnitExecutionPlan,
  LearningMeeting,
  ATPData,
  TPData,
  ATPUnitMaterial,
} from '../types';
import {
  createEmptyUnitExecutionPlanData,
  isUnitExecutionPlanStale,
  validateUnitExecutionPlan,
} from '../services/unitExecutionPlanService';
import {
  Layers,
  Plus,
  Trash2,
  ArrowUp,
  ArrowDown,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  Save,
  BookOpen,
  Info,
  Link2,
  RefreshCw,
  Check,
  ChevronDown,
  ChevronUp,
  Sparkles,
} from 'lucide-react';
import { generateUnitMeetingsWithAI } from '../services/aiService';
import { suggestSemesterBoundaryByMeetingSlots, resolveUnitSemesterPlacement } from '../services/unitSemesterPlanningService';

export interface UnitExecutionPlanManagerProps {
  mapping: ATPUnitMappingData;
  unitExecutionPlan?: UnitExecutionPlanData;
  atp: ATPData;
  tp: TPData;
  onSave: (plan: UnitExecutionPlanData) => boolean;
  meetingCapacity?: {
    semester1: {
      isReady: boolean;
      targetMeetingCount: number;
      totalJP: number;
    };
    semester2: {
      isReady: boolean;
      targetMeetingCount: number;
      totalJP: number;
    };
  };
}

function generateStableId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `m-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

function normalizeForComparison(plan: UnitExecutionPlanData): string {
  const clone = JSON.parse(JSON.stringify(plan));
  delete clone.updatedAt;
  if (Array.isArray(clone.units)) {
    clone.units.forEach((u: any) => {
      delete u.updatedAt;
      if (Array.isArray(u.meetings)) {
        u.meetings.forEach((m: any) => {
          delete m.updatedAt;
        });
      }
    });
  }
  return JSON.stringify(clone);
}

export const UnitExecutionPlanManager: React.FC<UnitExecutionPlanManagerProps> = ({
  mapping,
  unitExecutionPlan,
  atp,
  tp,
  onSave,
  meetingCapacity,
}) => {
  // 1. Initialize local draft
  const initialDraft = useMemo<UnitExecutionPlanData>(() => {
    if (!unitExecutionPlan) {
      return createEmptyUnitExecutionPlanData(mapping);
    }
    // Deep copy existing plan
    return JSON.parse(JSON.stringify(unitExecutionPlan));
  }, [unitExecutionPlan, mapping]);

  const [draft, setDraft] = useState<UnitExecutionPlanData>(initialDraft);
  const [saveNotice, setSaveNotice] = useState<{
    type: 'success' | 'error' | 'warning';
    message: string;
  } | null>(null);
  const [isGeneratingMeetings, setIsGeneratingMeetings] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [generationNotice, setGenerationNotice] = useState<string | null>(null);

  const totalMeetingsCount = useMemo(() => {
    return draft.units.reduce((sum, u) => sum + (u.meetings || []).length, 0);
  }, [draft]);

  const handleGenerateWithAI = async () => {
    if (validation.isStale || !validation.isValid || isGeneratingMeetings) {
      return;
    }

    if (!meetingCapacity || !meetingCapacity.semester1.isReady || !meetingCapacity.semester2.isReady) {
      setGenerationError('Lengkapi Kalender Pendidikan dan Pola Jadwal Mapel Semester 1 & 2 agar AI dapat menyusun jumlah Pertemuan sesuai kapasitas waktu.');
      return;
    }

    setIsGeneratingMeetings(true);
    setGenerationError(null);
    setGenerationNotice(null);

    try {
      // 1. Resolve semesterPlacement candidate
      let candidatePlacement = draft.semesterPlacement;
      const targetS1 = meetingCapacity.semester1.targetMeetingCount;
      const targetS2 = meetingCapacity.semester2.targetMeetingCount;

      if (!candidatePlacement || candidatePlacement.mode !== 'CONTIGUOUS_BOUNDARY') {
        const boundary = suggestSemesterBoundaryByMeetingSlots(draft, mapping, targetS1, targetS2);
        if (boundary !== undefined) {
          candidatePlacement = {
            mode: 'CONTIGUOUS_BOUNDARY',
            semester1LastUnitId: boundary,
            updatedAt: new Date().toISOString()
          };
        }
      }

      if (!candidatePlacement) {
        throw new Error('Pembagian unit semester sementara tidak dapat dihitung.');
      }

      const placementResult = resolveUnitSemesterPlacement({ ...draft, semesterPlacement: candidatePlacement }, mapping);
      if (!placementResult.isValid) {
        throw new Error('Pembagian unit semester sementara tidak valid.');
      }

      const s1UnitIds = new Set(placementResult.semester1UnitIds);
      const s2UnitIds = new Set(placementResult.semester2UnitIds);

      // 2. Count existing meetings in S1 and S2
      let s1Existing = 0;
      let s2Existing = 0;
      draft.units.forEach((u) => {
        const count = u.meetings?.length || 0;
        if (s1UnitIds.has(u.unitId)) s1Existing += count;
        else if (s2UnitIds.has(u.unitId)) s2Existing += count;
      });

      const additionalS1 = targetS1 - s1Existing;
      const additionalS2 = targetS2 - s2Existing;

      if (additionalS1 < 0) {
        throw new Error('Jumlah Pertemuan manual melebihi kapasitas Pertemuan efektif Semester 1. Kurangi Pertemuan manual atau sesuaikan pola jadwal/kalender.');
      }
      if (additionalS2 < 0) {
        throw new Error('Jumlah Pertemuan manual melebihi kapasitas Pertemuan efektif Semester 2. Kurangi Pertemuan manual atau sesuaikan pola jadwal/kalender.');
      }

      // 3. Minimum coverage feasibility
      let missingCoverageUnitsS1Count = 0;
      let missingCoverageUnitsS2Count = 0;

      mapping.units.forEach((unit) => {
        const unitPlan = draft.units.find((u) => u.unitId === unit.id);
        const existingMeetings = unitPlan?.meetings || [];

        const coveredMaterials = new Set(existingMeetings.flatMap((m) => m.materialIds || []));
        const coveredAtp = new Set(existingMeetings.flatMap((m) => m.linkedAtpItemIds || []));
        const coveredTp = new Set(existingMeetings.flatMap((m) => m.linkedTpIds || []));

        const hasMissing = (unit.materials || []).some((m) => !coveredMaterials.has(m.id)) ||
                           (unit.linkedAtpItemIds || []).some((id) => !coveredAtp.has(id)) ||
                           (unit.linkedTpIds || []).some((id) => !coveredTp.has(id));

        if (hasMissing) {
          if (s1UnitIds.has(unit.id)) {
            missingCoverageUnitsS1Count++;
          } else if (s2UnitIds.has(unit.id)) {
            missingCoverageUnitsS2Count++;
          }
        }
      });

      if (additionalS1 < missingCoverageUnitsS1Count || additionalS2 < missingCoverageUnitsS2Count) {
        throw new Error('Kapasitas Pertemuan tersisa tidak cukup untuk melengkapi coverage tanpa mengubah Pertemuan manual. Tinjau Pertemuan yang sudah ada.');
      }

      // 4. No-work condition
      const isCoverageComplete = validation.isComplete && !isStale;
      if (additionalS1 === 0 && additionalS2 === 0 && isCoverageComplete) {
        setGenerationNotice('Struktur Pertemuan sudah sesuai kapasitas kalender dan seluruh coverage telah tercakup.');
        setIsGeneratingMeetings(false);
        return;
      }

      const result = await generateUnitMeetingsWithAI({
        mapping,
        tpData: tp,
        atpData: atp,
        currentPlan: draft,
        capacityContext: {
          semester1LastUnitId: candidatePlacement.semester1LastUnitId,
          semester1: {
            targetMeetingCount: targetS1,
            totalJP: meetingCapacity.semester1.totalJP,
          },
          semester2: {
            targetMeetingCount: targetS2,
            totalJP: meetingCapacity.semester2.totalJP,
          },
        },
      });

      if (!result || !Array.isArray(result.units)) {
        throw new Error('Hasil AI tidak valid.');
      }

      const mergedDraft: UnitExecutionPlanData = JSON.parse(JSON.stringify(draft));
      
      // Update mergedDraft.semesterPlacement if not already present
      if (!mergedDraft.semesterPlacement) {
        mergedDraft.semesterPlacement = {
          mode: 'CONTIGUOUS_BOUNDARY',
          semester1LastUnitId: candidatePlacement.semester1LastUnitId,
          updatedAt: new Date().toISOString(),
        };
      }

      const unitPlanMap = new Map(mergedDraft.units.map((u) => [u.unitId, u]));

      for (const su of result.units) {
        let uPlan = unitPlanMap.get(su.unitId);
        if (!uPlan) {
          uPlan = { unitId: su.unitId, meetings: [] };
          mergedDraft.units.push(uPlan);
        }

        const existingCount = uPlan.meetings.length;
        const newMeetings: LearningMeeting[] = (su.meetings || []).map((m, idx) => ({
          id: generateStableId(),
          unitId: su.unitId,
          order: existingCount + idx + 1,
          title: (m.title || `Pertemuan ${existingCount + idx + 1}`).trim(),
          materialIds: Array.isArray(m.materialIds) ? m.materialIds : [],
          linkedAtpItemIds: Array.isArray(m.linkedAtpItemIds) ? m.linkedAtpItemIds : [],
          linkedTpIds: Array.isArray(m.linkedTpIds) ? m.linkedTpIds : [],
        }));

        uPlan.meetings.push(...newMeetings);
      }

      // Sequential normalize order
      mergedDraft.units.forEach((u) => {
        if (Array.isArray(u.meetings)) {
          u.meetings.forEach((m, idx) => {
            m.order = idx + 1;
          });
        }
      });

      // Post-merge validation
      const resVal = validateUnitExecutionPlan(mergedDraft, mapping, atp, tp);
      const resPlac = resolveUnitSemesterPlacement(mergedDraft, mapping);

      let finalS1Count = 0;
      let finalS2Count = 0;
      const resS1Set = new Set(resPlac.semester1UnitIds);
      const resS2Set = new Set(resPlac.semester2UnitIds);

      mergedDraft.units.forEach((u) => {
        const count = u.meetings?.length || 0;
        if (resS1Set.has(u.unitId)) finalS1Count += count;
        else if (resS2Set.has(u.unitId)) finalS2Count += count;
      });

      const isCountMatch = finalS1Count === targetS1 && finalS2Count === targetS2;

      if (!resVal.isValid || !resPlac.isValid || !isCountMatch) {
        throw new Error('Draf hasil AI tidak sesuai dengan kapasitas slot kalender atau pembagian semester tidak valid.');
      }

      setDraft(mergedDraft);
      setGenerationNotice(`AI menyusun draf sesuai kapasitas kalender: Semester 1 = ${targetS1} Pertemuan, Semester 2 = ${targetS2} Pertemuan. Tinjau struktur dan pembagian Unit/Bab sebelum menyimpan.`);
    } catch (err: any) {
      setGenerationError(err?.message || 'Gagal menyusun draf Pertemuan dengan AI.');
    } finally {
      setIsGeneratingMeetings(false);
    }
  };

  // Sync draft if persisted source changes genuinely (using stable dependencies)
  useEffect(() => {
    if (unitExecutionPlan) {
      setDraft(JSON.parse(JSON.stringify(unitExecutionPlan)));
    } else {
      setDraft(createEmptyUnitExecutionPlanData(mapping));
    }
  }, [unitExecutionPlan?.id, unitExecutionPlan?.updatedAt, mapping.id, mapping.updatedAt]);

  // Collapsed state for unit cards
  const [expandedUnits, setExpandedUnits] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    (mapping.units || []).forEach((u) => {
      init[u.id] = true;
    });
    return init;
  });

  const toggleUnitExpanded = (unitId: string) => {
    setExpandedUnits((prev) => ({
      ...prev,
      [unitId]: !prev[unitId],
    }));
  };

  // 2. Live Validation
  const validation = useMemo(() => {
    return validateUnitExecutionPlan(draft, mapping, atp, tp);
  }, [draft, mapping, atp, tp]);

  // 3. Stale State Check (Authority from draft validation)
  const isStale = validation.isStale;

  // 4. Dirty State Calculation (Ignoring updatedAt)
  const isDirty = useMemo(() => {
    if (!unitExecutionPlan) {
      // If new, dirty if any meeting has been added or edited
      const hasAnyMeeting = draft.units.some((u) => u.meetings.length > 0);
      return hasAnyMeeting;
    }
    return normalizeForComparison(draft) !== normalizeForComparison(unitExecutionPlan);
  }, [draft, unitExecutionPlan]);

  const isCapacityReady = Boolean(
    meetingCapacity &&
    meetingCapacity.semester1.isReady &&
    meetingCapacity.semester2.isReady
  );

  const buttonAILabel = useMemo(() => {
    if (totalMeetingsCount === 0) {
      return "Susun Pertemuan sesuai Kalender dengan AI";
    }
    return "Lengkapi Pertemuan sesuai Kalender dengan AI";
  }, [totalMeetingsCount]);

  const isAINoWork = useMemo(() => {
    if (!isCapacityReady || !meetingCapacity) return false;
    const targetS1 = meetingCapacity.semester1.targetMeetingCount;
    const targetS2 = meetingCapacity.semester2.targetMeetingCount;

    let candidatePlacement = draft.semesterPlacement;
    if (!candidatePlacement || candidatePlacement.mode !== 'CONTIGUOUS_BOUNDARY') {
      const boundary = suggestSemesterBoundaryByMeetingSlots(draft, mapping, targetS1, targetS2);
      if (boundary !== undefined) {
        candidatePlacement = {
          mode: 'CONTIGUOUS_BOUNDARY',
          semester1LastUnitId: boundary,
          updatedAt: new Date().toISOString()
        };
      }
    }
    if (!candidatePlacement) return false;
    const plac = resolveUnitSemesterPlacement({ ...draft, semesterPlacement: candidatePlacement }, mapping);
    if (!plac.isValid) return false;

    let s1Existing = 0;
    let s2Existing = 0;
    const s1UnitIds = new Set(plac.semester1UnitIds);
    draft.units.forEach((u) => {
      const count = u.meetings?.length || 0;
      if (s1UnitIds.has(u.unitId)) s1Existing += count;
      else s2Existing += count;
    });

    const isCoverageComplete = validation.isComplete && !isStale;
    return s1Existing === targetS1 && s2Existing === targetS2 && isCoverageComplete;
  }, [isCapacityReady, meetingCapacity, draft, mapping, validation.isComplete, isStale]);

  // Fast lookup maps for ATP & TP items for display (Canonical ATPItem fields: stepNumber, focus)
  const atpItemsMap = useMemo(() => {
    const map = new Map<string, { stepNumber?: number; focus?: string }>();
    (atp.items || []).forEach((item) => {
      map.set(item.id, {
        stepNumber: item.stepNumber,
        focus: item.focus,
      });
    });
    return map;
  }, [atp]);

  const tpItemsMap = useMemo(() => {
    const map = new Map<string, { code: string; statement: string }>();
    (tp.items || []).forEach((item) => {
      map.set(item.id, {
        code: item.code,
        statement: item.statement,
      });
    });
    return map;
  }, [tp]);

  // Format ATP display text safely
  const formatAtpDisplay = (atpId: string): string => {
    const info = atpItemsMap.get(atpId);
    if (!info) return atpId;
    const stepNum = info.stepNumber ?? 1;
    const focusText = info.focus && info.focus.trim() ? info.focus.trim() : '';
    return focusText ? `Langkah ${stepNum}: ${focusText}` : `Langkah ${stepNum}`;
  };

  // 5. Stale Recovery Handler
  const handleRebuildFromMapping = () => {
    if (
      window.confirm(
        'Apakah Anda yakin ingin membuat ulang Struktur Pertemuan dari Pemetaan Unit/Bab terbaru? Seluruh susunan Pertemuan saat ini akan diganti dengan draf baru.'
      )
    ) {
      const freshDraft = createEmptyUnitExecutionPlanData(mapping);
      setDraft(freshDraft);
      setSaveNotice({
        type: 'warning',
        message: 'Struktur Pertemuan telah diperbarui dari Pemetaan terbaru. Tinjau dan klik "Simpan Struktur Pertemuan" untuk menyimpan.',
      });
    }
  };

  // 6. Add Meeting
  const handleAddMeeting = (unitId: string) => {
    setDraft((prev) => {
      const newUnits = prev.units.map((unitPlan) => {
        if (unitPlan.unitId !== unitId) return unitPlan;

        const nextOrder = (unitPlan.meetings || []).length + 1;
        const newMeeting: LearningMeeting = {
          id: generateStableId(),
          unitId,
          order: nextOrder,
          title: '',
          materialIds: [],
          linkedAtpItemIds: [],
          linkedTpIds: [],
        };

        return {
          ...unitPlan,
          meetings: [...(unitPlan.meetings || []), newMeeting],
        };
      });

      // Ensure unit plan exists if missing
      const exists = newUnits.some((u) => u.unitId === unitId);
      if (!exists) {
        const newMeeting: LearningMeeting = {
          id: generateStableId(),
          unitId,
          order: 1,
          title: '',
          materialIds: [],
          linkedAtpItemIds: [],
          linkedTpIds: [],
        };
        newUnits.push({
          unitId,
          meetings: [newMeeting],
        });
      }

      return {
        ...prev,
        units: newUnits,
      };
    });
  };

  // 7. Update Meeting Field
  const handleUpdateMeeting = (
    unitId: string,
    meetingId: string,
    updates: Partial<LearningMeeting>
  ) => {
    setDraft((prev) => {
      const newUnits = prev.units.map((unitPlan) => {
        if (unitPlan.unitId !== unitId) return unitPlan;

        const newMeetings = (unitPlan.meetings || []).map((m) => {
          if (m.id !== meetingId) return m;
          return {
            ...m,
            ...updates,
          };
        });

        return {
          ...unitPlan,
          meetings: newMeetings,
        };
      });

      return {
        ...prev,
        units: newUnits,
      };
    });
  };

  // 8. Auto-link from selected materials (Explicit Teacher Action)
  const handleAutoLinkFromMaterials = (unitId: string, meetingId: string) => {
    const mappingUnit = (mapping.units || []).find((u) => u.id === unitId);
    if (!mappingUnit) return;

    const unitPlan = draft.units.find((u) => u.unitId === unitId);
    if (!unitPlan) return;

    const meeting = unitPlan.meetings.find((m) => m.id === meetingId);
    if (!meeting) return;

    const selectedMaterials = (mappingUnit.materials || []).filter((mat) =>
      meeting.materialIds.includes(mat.id)
    );

    if (selectedMaterials.length === 0) {
      alert('Pilih minimal satu Lingkup Materi terlebih dahulu sebelum menggunakan relasi otomatis.');
      return;
    }

    const autoAtpIds = new Set<string>(meeting.linkedAtpItemIds);
    const autoTpIds = new Set<string>(meeting.linkedTpIds);

    selectedMaterials.forEach((mat) => {
      (mat.linkedAtpItemIds || []).forEach((id) => {
        if ((mappingUnit.linkedAtpItemIds || []).includes(id)) {
          autoAtpIds.add(id);
        }
      });
      (mat.linkedTpIds || []).forEach((id) => {
        if ((mappingUnit.linkedTpIds || []).includes(id)) {
          autoTpIds.add(id);
        }
      });
    });

    handleUpdateMeeting(unitId, meetingId, {
      linkedAtpItemIds: Array.from(autoAtpIds),
      linkedTpIds: Array.from(autoTpIds),
    });
  };

  // 9. Reorder Meeting
  const handleReorderMeeting = (unitId: string, meetingIndex: number, direction: 'up' | 'down') => {
    setDraft((prev) => {
      const newUnits = prev.units.map((unitPlan) => {
        if (unitPlan.unitId !== unitId) return unitPlan;

        const meetings = [...(unitPlan.meetings || [])];
        const targetIndex = direction === 'up' ? meetingIndex - 1 : meetingIndex + 1;

        if (targetIndex < 0 || targetIndex >= meetings.length) return unitPlan;

        // Swap
        const temp = meetings[meetingIndex];
        meetings[meetingIndex] = meetings[targetIndex];
        meetings[targetIndex] = temp;

        // Normalize orders (1-indexed) while preserving exact IDs
        const normalizedMeetings = meetings.map((m, idx) => ({
          ...m,
          order: idx + 1,
        }));

        return {
          ...unitPlan,
          meetings: normalizedMeetings,
        };
      });

      return {
        ...prev,
        units: newUnits,
      };
    });
  };

  // 10. Delete Meeting
  const handleDeleteMeeting = (unitId: string, meetingId: string) => {
    if (!window.confirm('Apakah Anda yakin ingin menghapus Pertemuan ini?')) return;

    setDraft((prev) => {
      const newUnits = prev.units.map((unitPlan) => {
        if (unitPlan.unitId !== unitId) return unitPlan;

        const filtered = (unitPlan.meetings || []).filter((m) => m.id !== meetingId);
        // Normalize orders
        const reordered = filtered.map((m, idx) => ({
          ...m,
          order: idx + 1,
        }));

        return {
          ...unitPlan,
          meetings: reordered,
        };
      });

      return {
        ...prev,
        units: newUnits,
      };
    });
  };

  // 11. Save Handler
  const handleSave = () => {
    if (!validation.isValid) {
      setSaveNotice({
        type: 'error',
        message: 'Struktur Pertemuan tidak valid. Perbaiki error sebelum menyimpan.',
      });
      return;
    }

    if (validation.isStale) {
      setSaveNotice({
        type: 'error',
        message: 'Struktur Pertemuan stale relatif terhadap Pemetaan Bab & Lingkup Materi. Buat ulang draf sebelum menyimpan.',
      });
      return;
    }

    const toSave: UnitExecutionPlanData = {
      ...draft,
      updatedAt: new Date().toISOString(),
    };

    const success = onSave(toSave);
    if (success) {
      if (validation.isComplete) {
        setSaveNotice({
          type: 'success',
          message: 'Struktur Pertemuan lengkap dan tersimpan.',
        });
      } else {
        setSaveNotice({
          type: 'warning',
          message: 'Draft tersimpan — coverage lingkup materi / ATP / TP belum lengkap.',
        });
      }
      setTimeout(() => setSaveNotice(null), 4000);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden mb-8">
      {/* Header Banner */}
      <div className="p-5 sm:p-6 bg-slate-900 text-white flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Layers className="w-5 h-5 text-blue-400" />
            <h2 className="text-lg font-bold">Struktur Pertemuan (Unit Execution Plan)</h2>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 font-semibold border border-blue-400/30">
              Tahunan / Annual
            </span>
          </div>
          <p className="text-xs text-slate-300">
            Kembangkan pemetaan Bab & Lingkup Materi menjadi alur Pertemuan pembelajaran.
          </p>
        </div>

        {/* Live Validation Status Badge */}
        <div className="flex items-center gap-3">
          <div className="text-right">
            <span className="block text-[10px] uppercase tracking-wider text-slate-400 font-bold">
              Status Struktur
            </span>
            <div className="flex items-center gap-1.5 mt-0.5">
              {validation.isStale ? (
                <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  <AlertTriangle className="w-3.5 h-3.5" /> STALE / PERLU PEMBARUAN
                </span>
              ) : !validation.isValid ? (
                <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30">
                  <AlertCircle className="w-3.5 h-3.5" /> ERROR STRUKTUR
                </span>
              ) : validation.isComplete ? (
                <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  <CheckCircle2 className="w-3.5 h-3.5" /> STRUKTUR LENGKAP
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  <Info className="w-3.5 h-3.5" /> DRAFT / BELUM LENGKAP
                </span>
              )}
            </div>
          </div>

          {!validation.isComplete && (
            <button
              type="button"
              onClick={handleGenerateWithAI}
              disabled={isGeneratingMeetings || validation.isStale || !validation.isValid || validation.isComplete}
              className={`px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 transition-all cursor-pointer ${
                isGeneratingMeetings || validation.isStale || !validation.isValid || validation.isComplete
                  ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                  : 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-md shadow-indigo-600/20'
              }`}
            >
              <Sparkles className={`w-4 h-4 ${isGeneratingMeetings ? 'animate-spin' : ''}`} />
              <span>
                {isGeneratingMeetings
                  ? 'Menyusun AI...'
                  : totalMeetingsCount === 0
                  ? 'Susun Pertemuan dengan AI'
                  : 'Lengkapi Pertemuan dengan AI'}
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={handleSave}
            disabled={!isDirty || !validation.isValid || validation.isStale}
            className={`px-4 py-2.5 rounded-xl font-bold text-xs flex items-center gap-2 transition-all cursor-pointer ${
              !isDirty || !validation.isValid || validation.isStale
                ? 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700'
                : 'bg-blue-600 text-white hover:bg-blue-500 shadow-md shadow-blue-600/20'
            }`}
          >
            <Save className="w-4 h-4" />
            <span>Simpan Struktur Pertemuan</span>
          </button>
        </div>
      </div>

      {generationError && (
        <div className="px-5 py-3 text-xs font-medium bg-rose-50 text-rose-800 border-b border-rose-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            <span>{generationError}</span>
          </div>
          <button type="button" onClick={() => setGenerationError(null)} className="text-[11px] font-bold underline cursor-pointer">Tutup</button>
        </div>
      )}

      {generationNotice && (
        <div className="px-5 py-3 text-xs font-medium bg-indigo-50 text-indigo-900 border-b border-indigo-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-indigo-600 shrink-0" />
            <span>{generationNotice}</span>
          </div>
          <button type="button" onClick={() => setGenerationNotice(null)} className="text-[11px] font-bold underline cursor-pointer">Tutup</button>
        </div>
      )}

      {/* Info Notice regarding next step allocation */}
      <div className="bg-slate-50 border-b border-slate-200 px-5 py-2.5 text-xs text-slate-600 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 text-blue-600 shrink-0" />
          <span>
            <strong>Panduan:</strong> Pertemuan pada tahap ini menyusun materi, ATP, & TP yang dipelajari.{' '}
            <em>JP dan minggu Pertemuan akan diatur pada tahap alokasi waktu berikutnya.</em>
          </span>
        </div>
        {isDirty && (
          <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200 shrink-0">
            Ada perubahan belum disimpan
          </span>
        )}
      </div>

      {/* Notification Banner */}
      {saveNotice && (
        <div
          className={`px-5 py-3 text-xs font-medium border-b flex items-center justify-between ${
            saveNotice.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
              : saveNotice.type === 'warning'
              ? 'bg-amber-50 text-amber-800 border-amber-200'
              : 'bg-rose-50 text-rose-800 border-rose-200'
          }`}
        >
          <div className="flex items-center gap-2">
            {saveNotice.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : saveNotice.type === 'warning' ? (
              <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{saveNotice.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setSaveNotice(null)}
            className="text-[11px] font-bold underline hover:opacity-80 cursor-pointer"
          >
            Tutup
          </button>
        </div>
      )}

      {/* Stale Warning & Recovery Box (Driven by validation.isStale) */}
      {isStale && (
        <div className="p-4 m-5 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-amber-950">
                Pemetaan Unit/Bab Telah Berubah
              </p>
              <p className="text-amber-800 text-[11px] mt-0.5">
                Struktur Pertemuan tersimpan dibuat dari versi Pemetaan terdahulu. Susun ulang struktur berdasarkan pemetaan Bab & Lingkup Materi terbaru.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleRebuildFromMapping}
            className="px-3.5 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shrink-0 flex items-center gap-1.5 shadow-xs cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Buat Ulang dari Pemetaan Terbaru</span>
          </button>
        </div>
      )}

      {/* Structural Errors Listing */}
      {!validation.isValid && validation.errors.length > 0 && (
        <div className="mx-5 mt-4 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs">
          <p className="font-bold text-rose-950 flex items-center gap-1.5 mb-1">
            <AlertCircle className="w-4 h-4 text-rose-600" />
            Catatan Perbaikan Struktur ({validation.errors.length}):
          </p>
          <ul className="list-disc pl-5 space-y-0.5 text-[11px] text-rose-800">
            {validation.errors.map((err, idx) => (
              <li key={idx}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Unit Cards List */}
      <div className="p-5 sm:p-6 space-y-6">
        {(mapping.units || []).map((unit) => {
          const unitPlan = draft.units.find((u) => u.unitId === unit.id);
          const meetings = unitPlan?.meetings || [];
          const isExpanded = expandedUnits[unit.id] !== false;

          const coverageResult = validation.coverage.find((c) => c.unitId === unit.id);
          const isUnitComplete =
            meetings.length > 0 &&
            coverageResult?.missingMaterialIds.length === 0 &&
            coverageResult?.missingAtpItemIds.length === 0 &&
            coverageResult?.missingTpIds.length === 0;

          return (
            <div
              key={unit.id}
              className={`rounded-2xl border transition-all ${
                !isUnitComplete
                  ? 'border-amber-200 bg-amber-50/20'
                  : 'border-slate-200 bg-white'
              }`}
            >
              {/* Unit Card Header */}
              <div
                onClick={() => toggleUnitExpanded(unit.id)}
                className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50/80 rounded-t-2xl border-b border-slate-200 cursor-pointer hover:bg-slate-100/80 transition-colors"
              >
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <BookOpen className="w-4 h-4 text-blue-600 shrink-0" />
                    <h3 className="font-bold text-slate-900 text-sm">
                      {unit.title || `Bab / Unit ${unit.order}`}
                    </h3>
                  </div>

                  {/* Summary badges */}
                  <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-slate-600">
                    <span className="px-2 py-0.5 rounded-md bg-white border border-slate-200">
                      Materi: <strong>{(unit.materials || []).length}</strong>
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-white border border-slate-200">
                      ATP: <strong>{(unit.linkedAtpItemIds || []).length}</strong>
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-white border border-slate-200">
                      TP: <strong>{(unit.linkedTpIds || []).length}</strong>
                    </span>
                    <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-800 border border-blue-200 font-bold">
                      Pertemuan: <strong>{meetings.length}</strong>
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between sm:justify-end gap-3" onClick={(e) => e.stopPropagation()}>
                  {/* Unit Coverage Badge */}
                  {meetings.length === 0 ? (
                    <span className="text-[11px] font-semibold text-rose-700 bg-rose-50 px-2.5 py-1 rounded-full border border-rose-200 flex items-center gap-1">
                      <AlertCircle className="w-3 h-3" /> Belum Ada Pertemuan
                    </span>
                  ) : isUnitComplete ? (
                    <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200 flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Coverage Lengkap
                    </span>
                  ) : (
                    <span className="text-[11px] font-semibold text-amber-800 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> Coverage Belum Lengkap
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={() => handleAddMeeting(unit.id)}
                    className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Tambah Pertemuan</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => toggleUnitExpanded(unit.id)}
                    className="p-1 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-200 cursor-pointer"
                  >
                    {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Unit Card Body */}
              {isExpanded && (
                <div className="p-4 sm:p-5 space-y-4">
                  {/* Coverage Warnings for this Unit */}
                  {coverageResult && (
                    <div className="text-[11px] space-y-1">
                      {coverageResult.missingMaterialIds.length > 0 && (
                        <div className="text-amber-800 bg-amber-50 p-2 rounded-lg border border-amber-200 flex items-start gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                          <div>
                            <strong>{coverageResult.missingMaterialIds.length} Lingkup Materi belum tercakup: </strong>
                            {(unit.materials || [])
                              .filter((m) => coverageResult.missingMaterialIds.includes(m.id))
                              .map((m) => m.title)
                              .join(', ')}
                          </div>
                        </div>
                      )}

                      {coverageResult.missingAtpItemIds.length > 0 && (
                        <div className="text-amber-800 bg-amber-50 p-2 rounded-lg border border-amber-200 flex items-start gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                          <div>
                            <strong>{coverageResult.missingAtpItemIds.length} Alur TP (ATP) belum tercakup: </strong>
                            {coverageResult.missingAtpItemIds
                              .map((id) => formatAtpDisplay(id))
                              .join('; ')}
                          </div>
                        </div>
                      )}

                      {coverageResult.missingTpIds.length > 0 && (
                        <div className="text-amber-800 bg-amber-50 p-2 rounded-lg border border-amber-200 flex items-start gap-1.5">
                          <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0 mt-0.5" />
                          <div>
                            <strong>{coverageResult.missingTpIds.length} Tujuan Pembelajaran (TP) belum tercakup: </strong>
                            {coverageResult.missingTpIds
                              .map((id) => {
                                const info = tpItemsMap.get(id);
                                return info ? `${info.code}` : id;
                              })
                              .join(', ')}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Meetings List */}
                  {meetings.length === 0 ? (
                    <div className="p-6 text-center rounded-xl border border-dashed border-slate-300 bg-slate-50/50">
                      <p className="text-xs text-slate-500 font-medium">
                        Belum ada Pertemuan pada unit ini. Klik &quot;+ Tambah Pertemuan&quot; untuk menyusun alur.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {meetings.map((meeting, mIdx) => (
                        <div
                          key={meeting.id}
                          className="p-4 rounded-xl border border-slate-200 bg-white shadow-2xs space-y-3"
                        >
                          {/* Meeting Header */}
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-slate-100">
                            <div className="flex items-center gap-2 flex-1">
                              <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center shrink-0">
                                {mIdx + 1}
                              </span>
                              <input
                                type="text"
                                value={meeting.title}
                                placeholder={`Judul Pertemuan ${mIdx + 1}`}
                                onChange={(e) =>
                                  handleUpdateMeeting(unit.id, meeting.id, {
                                    title: e.target.value,
                                  })
                                }
                                className="w-full text-xs font-bold text-slate-900 border border-slate-300 rounded-lg px-2.5 py-1.5 focus:outline-hidden focus:ring-2 focus:ring-blue-600 bg-slate-50 focus:bg-white"
                              />
                            </div>

                            {/* Reorder & Delete actions */}
                            <div className="flex items-center gap-1 shrink-0 self-end sm:self-auto">
                              <button
                                type="button"
                                onClick={() => handleReorderMeeting(unit.id, mIdx, 'up')}
                                disabled={mIdx === 0}
                                title="Naikkan urutan"
                                className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                              >
                                <ArrowUp className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleReorderMeeting(unit.id, mIdx, 'down')}
                                disabled={mIdx === meetings.length - 1}
                                title="Turunkan urutan"
                                className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                              >
                                <ArrowDown className="w-3.5 h-3.5" />
                              </button>

                              <button
                                type="button"
                                onClick={() => handleAutoLinkFromMaterials(unit.id, meeting.id)}
                                title="Gunakan relasi dari Lingkup Materi terpilih ke ATP & TP"
                                className="px-2 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 font-semibold text-[11px] border border-blue-200 flex items-center gap-1 cursor-pointer"
                              >
                                <Link2 className="w-3 h-3" />
                                <span>Gunakan Relasi Materi</span>
                              </button>

                              <button
                                type="button"
                                onClick={() => handleDeleteMeeting(unit.id, meeting.id)}
                                title="Hapus Pertemuan"
                                className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-50 transition-colors cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          {/* Meeting References Selection Grid */}
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                            {/* A. Lingkup Materi Checklist */}
                            <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/50 space-y-2">
                              <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider flex items-center justify-between">
                                <span>Lingkup Materi ({meeting.materialIds.length})</span>
                              </label>
                              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                                {(unit.materials || []).map((mat) => {
                                  const checked = meeting.materialIds.includes(mat.id);
                                  return (
                                    <label
                                      key={mat.id}
                                      className="flex items-start gap-2 p-1.5 rounded-md hover:bg-white cursor-pointer transition-colors text-[11px]"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={(e) => {
                                          const next = e.target.checked
                                            ? [...meeting.materialIds, mat.id]
                                            : meeting.materialIds.filter((id) => id !== mat.id);
                                          handleUpdateMeeting(unit.id, meeting.id, {
                                            materialIds: next,
                                          });
                                        }}
                                        className="mt-0.5 rounded-sm border-slate-300 text-blue-600 focus:ring-blue-500"
                                      />
                                      <span className="text-slate-800 leading-snug">{mat.title}</span>
                                    </label>
                                  );
                                })}
                              </div>
                            </div>

                            {/* B. ATP Checklist */}
                            <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/50 space-y-2">
                              <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                                <span>Alur TP / ATP ({meeting.linkedAtpItemIds.length})</span>
                              </label>
                              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                                {(unit.linkedAtpItemIds || []).map((atpId) => {
                                  const checked = meeting.linkedAtpItemIds.includes(atpId);
                                  return (
                                    <label
                                      key={atpId}
                                      className="flex items-start gap-2 p-1.5 rounded-md hover:bg-white cursor-pointer transition-colors text-[11px]"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={(e) => {
                                          const next = e.target.checked
                                            ? [...meeting.linkedAtpItemIds, atpId]
                                            : meeting.linkedAtpItemIds.filter((id) => id !== atpId);
                                          handleUpdateMeeting(unit.id, meeting.id, {
                                            linkedAtpItemIds: next,
                                          });
                                        }}
                                        className="mt-0.5 rounded-sm border-slate-300 text-blue-600 focus:ring-blue-500"
                                      />
                                      <span className="text-slate-800 leading-snug">
                                        {formatAtpDisplay(atpId)}
                                      </span>
                                    </label>
                                  );
                                })}
                              </div>
                            </div>

                            {/* C. TP Checklist */}
                            <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/50 space-y-2">
                              <label className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider">
                                <span>Tujuan Pembelajaran / TP ({meeting.linkedTpIds.length})</span>
                              </label>
                              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                                {(unit.linkedTpIds || []).map((tpId) => {
                                  const info = tpItemsMap.get(tpId);
                                  const checked = meeting.linkedTpIds.includes(tpId);
                                  return (
                                    <label
                                      key={tpId}
                                      className="flex items-start gap-2 p-1.5 rounded-md hover:bg-white cursor-pointer transition-colors text-[11px]"
                                    >
                                      <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={(e) => {
                                          const next = e.target.checked
                                            ? [...meeting.linkedTpIds, tpId]
                                            : meeting.linkedTpIds.filter((id) => id !== tpId);
                                          handleUpdateMeeting(unit.id, meeting.id, {
                                            linkedTpIds: next,
                                          });
                                        }}
                                        className="mt-0.5 rounded-sm border-slate-300 text-blue-600 focus:ring-blue-500"
                                      />
                                      <span className="text-slate-800 leading-snug">
                                        {info ? (
                                          <>
                                            <strong>{info.code}</strong> — {info.statement}
                                          </>
                                        ) : (
                                          tpId
                                        )}
                                      </span>
                                    </label>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
