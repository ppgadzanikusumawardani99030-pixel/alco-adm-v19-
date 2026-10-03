import React, { useState, useEffect, useMemo } from 'react';
import {
  FolderTree,
  ArrowRight,
  ArrowLeft,
  Save,
  AlertCircle,
  Sparkles,
  Layers,
  Check,
  Plus,
  Trash2,
  ListPlus,
  Info,
  ArrowUp,
  ArrowDown,
  BookOpen,
} from 'lucide-react';
import {
  ATPData,
  ATPItem,
  TPData,
  AcademicSetting,
  ATPUnitMappingData,
  ATPUnitMapping,
  ATPUnitMaterial,
} from '../types';

export interface ATPUnitMappingManagerProps {
  atp: ATPData;
  tp: TPData;
  mapping?: ATPUnitMappingData;
  academicSetting?: AcademicSetting;
  onSaveMapping: (updatedMapping: ATPUnitMappingData) => void;
  onNextStep: () => void;
  onBackToATP: () => void;
}

/**
 * Derives union of linked TP IDs from the list of linked ATP items.
 */
function deriveUnitLinkedTpIds(linkedAtpItemIds: string[], atpItems: ATPItem[]): string[] {
  const atpMap = new Map<string, ATPItem>(atpItems.map((it) => [it.id, it]));
  const tpIdSet = new Set<string>();
  for (const atpId of linkedAtpItemIds) {
    const item = atpMap.get(atpId);
    if (!item) continue;
    if (Array.isArray(item.linkedTpIds) && item.linkedTpIds.length > 0) {
      item.linkedTpIds.forEach((id) => {
        if (id && id.trim()) tpIdSet.add(id.trim());
      });
    } else if (item.tpId && item.tpId.trim()) {
      tpIdSet.add(item.tpId.trim());
    }
  }
  return Array.from(tpIdSet);
}

/**
 * Builds initial canonical units state.
 */
function createInitialUnits(
  mapping: ATPUnitMappingData | undefined,
  atpItems: ATPItem[]
): ATPUnitMapping[] {
  if (mapping && Array.isArray(mapping.units) && mapping.units.length > 0) {
    return mapping.units.map((u, idx) => ({
      id: u.id || `unit-${Date.now()}-${idx + 1}`,
      title: u.title || `Bab ${idx + 1}`,
      order: u.order || idx + 1,
      linkedAtpItemIds: u.linkedAtpItemIds || [],
      linkedTpIds:
        Array.isArray(u.linkedTpIds) && u.linkedTpIds.length > 0
          ? u.linkedTpIds
          : deriveUnitLinkedTpIds(u.linkedAtpItemIds || [], atpItems),
      materials: (u.materials || []).map((m, mIdx) => ({
        id: m.id || `mat-${Date.now()}-${mIdx + 1}`,
        title: m.title || '',
        order: m.order || mIdx + 1,
        linkedTpIds: m.linkedTpIds || [],
        linkedAtpItemIds: m.linkedAtpItemIds || [],
      })),
    }));
  }

  // Fallback initial draft: default 6 Bab
  // If legacy ATP items already have unitTitle, group them initially
  const legacyUnitMap = new Map<string, string[]>();
  atpItems.forEach((it) => {
    const t = it.unitTitle?.trim();
    if (t) {
      if (!legacyUnitMap.has(t)) {
        legacyUnitMap.set(t, []);
      }
      legacyUnitMap.get(t)!.push(it.id);
    }
  });

  if (legacyUnitMap.size > 0) {
    const initial: ATPUnitMapping[] = [];
    let order = 1;
    legacyUnitMap.forEach((atpIds, title) => {
      initial.push({
        id: `unit-${Date.now()}-${order}-${Math.random().toString(36).substring(2, 6)}`,
        title,
        order,
        linkedAtpItemIds: atpIds,
        linkedTpIds: deriveUnitLinkedTpIds(atpIds, atpItems),
        materials: [],
      });
      order++;
    });
    return initial;
  }

  // Default 6 Bab with empty materials
  const defaults: ATPUnitMapping[] = [];
  for (let i = 1; i <= 6; i++) {
    defaults.push({
      id: `unit-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 6)}`,
      title: `Bab ${i}`,
      order: i,
      linkedAtpItemIds: [],
      linkedTpIds: [],
      materials: [],
    });
  }
  return defaults;
}

export const ATPUnitMappingManager: React.FC<ATPUnitMappingManagerProps> = ({
  atp,
  tp,
  mapping,
  academicSetting,
  onSaveMapping,
  onNextStep,
  onBackToATP,
}) => {
  const [units, setUnits] = useState<ATPUnitMapping[]>(() =>
    createInitialUnits(mapping, atp.items || [])
  );
  const [hasChanges, setHasChanges] = useState(false);
  const [saveSuccessNotice, setSaveSuccessNotice] = useState(false);

  // Sync state if canonical mapping prop updates
  useEffect(() => {
    if (mapping && Array.isArray(mapping.units) && mapping.units.length > 0) {
      setUnits(createInitialUnits(mapping, atp.items || []));
      setHasChanges(false);
    }
  }, [mapping]);

  // Sorted canonical ATP items by stepNumber
  const sortedAtpItems = useMemo(() => {
    return [...(atp.items || [])].sort(
      (a, b) => (a.stepNumber || 0) - (b.stepNumber || 0)
    );
  }, [atp.items]);

  const atpItemMap = useMemo(() => {
    return new Map<string, ATPItem>(sortedAtpItems.map((it) => [it.id, it]));
  }, [sortedAtpItems]);

  // TP Map for statement & code
  const tpMap = useMemo(() => {
    const map = new Map<string, { code?: string; statement?: string; contentScope?: string }>();
    (tp.items || []).forEach((t) => {
      map.set(t.id, t);
    });
    return map;
  }, [tp.items]);

  // Assigned ATP Item IDs Set
  const assignedAtpIdSet = useMemo(() => {
    const set = new Set<string>();
    units.forEach((u) => {
      (u.linkedAtpItemIds || []).forEach((id) => set.add(id));
    });
    return set;
  }, [units]);

  // Unassigned ATP items
  const unassignedItems = useMemo(() => {
    return sortedAtpItems.filter((it) => !assignedAtpIdSet.has(it.id));
  }, [sortedAtpItems, assignedAtpIdSet]);

  // Total mapped items count
  const mappedCount = useMemo(() => {
    return sortedAtpItems.length - unassignedItems.length;
  }, [sortedAtpItems, unassignedItems]);

  // Handlers for Bab (Unit)
  const handleRenameBab = (unitId: string, newTitle: string) => {
    setUnits((prev) =>
      prev.map((u) => (u.id === unitId ? { ...u, title: newTitle } : u))
    );
    setHasChanges(true);
    setSaveSuccessNotice(false);
  };

  const handleAddEmptyBab = () => {
    const nextOrder = units.length + 1;
    const newUnit: ATPUnitMapping = {
      id: `unit-${Date.now()}-${nextOrder}-${Math.random().toString(36).substring(2, 6)}`,
      title: `Bab ${nextOrder}: (Judul Bab Baru)`,
      order: nextOrder,
      linkedAtpItemIds: [],
      linkedTpIds: [],
      materials: [],
    };
    setUnits((prev) => [...prev, newUnit]);
    setHasChanges(true);
    setSaveSuccessNotice(false);
  };

  const handleRemoveBab = (unitId: string) => {
    setUnits((prev) => {
      const filtered = prev.filter((u) => u.id !== unitId);
      return filtered.map((u, idx) => ({ ...u, order: idx + 1 }));
    });
    setHasChanges(true);
    setSaveSuccessNotice(false);
  };

  const handleTargetCountChange = (newCount: number) => {
    const clamped = Math.max(1, Math.min(15, newCount));
    if (clamped > units.length) {
      const toAdd = clamped - units.length;
      const additions: ATPUnitMapping[] = [];
      for (let i = 1; i <= toAdd; i++) {
        const ord = units.length + i;
        additions.push({
          id: `unit-${Date.now()}-${ord}-${Math.random().toString(36).substring(2, 6)}`,
          title: `Bab ${ord}`,
          order: ord,
          linkedTpIds: [],
          linkedAtpItemIds: [],
          materials: [],
        });
      }
      setUnits((prev) => [...prev, ...additions]);
      setHasChanges(true);
    } else if (clamped < units.length) {
      const removableCount = units.length - clamped;
      let removed = 0;
      const nextUnits = [...units];
      for (let i = nextUnits.length - 1; i >= 0 && removed < removableCount; i--) {
        if ((nextUnits[i].linkedAtpItemIds || []).length === 0 && (nextUnits[i].materials || []).length === 0) {
          nextUnits.splice(i, 1);
          removed++;
        }
      }
      if (removed > 0) {
        setUnits(nextUnits.map((u, idx) => ({ ...u, order: idx + 1 })));
        setHasChanges(true);
      }
    }
  };

  const handleMoveItemToBab = (atpItemId: string, targetUnitId: string) => {
    setUnits((prev) => {
      return prev.map((u) => {
        let nextAtpIds = [...(u.linkedAtpItemIds || [])];
        if (u.id === targetUnitId) {
          if (!nextAtpIds.includes(atpItemId)) {
            nextAtpIds.push(atpItemId);
          }
        } else {
          nextAtpIds = nextAtpIds.filter((id) => id !== atpItemId);
        }
        const nextTpIds = deriveUnitLinkedTpIds(nextAtpIds, atp.items || []);
        return {
          ...u,
          linkedAtpItemIds: nextAtpIds,
          linkedTpIds: nextTpIds,
        };
      });
    });
    setHasChanges(true);
    setSaveSuccessNotice(false);
  };

  // Handlers for Lingkup Materi (Materials)
  const handleAddMaterial = (unitId: string) => {
    setUnits((prev) =>
      prev.map((u) => {
        if (u.id !== unitId) return u;
        const currentMaterials = u.materials || [];
        const newMaterial: ATPUnitMaterial = {
          id: `mat-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          title: '',
          order: currentMaterials.length + 1,
          linkedTpIds: [],
          linkedAtpItemIds: [],
        };
        return {
          ...u,
          materials: [...currentMaterials, newMaterial],
        };
      })
    );
    setHasChanges(true);
    setSaveSuccessNotice(false);
  };

  const handleMaterialTitleChange = (unitId: string, materialId: string, title: string) => {
    setUnits((prev) =>
      prev.map((u) => {
        if (u.id !== unitId) return u;
        const nextMaterials = (u.materials || []).map((m) =>
          m.id === materialId ? { ...m, title } : m
        );
        return {
          ...u,
          materials: nextMaterials,
        };
      })
    );
    setHasChanges(true);
    setSaveSuccessNotice(false);
  };

  const handleRemoveMaterial = (unitId: string, materialId: string) => {
    setUnits((prev) =>
      prev.map((u) => {
        if (u.id !== unitId) return u;
        const filtered = (u.materials || []).filter((m) => m.id !== materialId);
        const renumbered = filtered.map((m, idx) => ({
          ...m,
          order: idx + 1,
        }));
        return {
          ...u,
          materials: renumbered,
        };
      })
    );
    setHasChanges(true);
    setSaveSuccessNotice(false);
  };

  const handleMoveMaterial = (unitId: string, materialIndex: number, direction: 'up' | 'down') => {
    setUnits((prev) =>
      prev.map((u) => {
        if (u.id !== unitId) return u;
        const mats = [...(u.materials || [])];
        const targetIdx = direction === 'up' ? materialIndex - 1 : materialIndex + 1;
        if (targetIdx < 0 || targetIdx >= mats.length) return u;

        const temp = mats[materialIndex];
        mats[materialIndex] = mats[targetIdx];
        mats[targetIdx] = temp;

        return {
          ...u,
          materials: mats.map((m, idx) => ({ ...m, order: idx + 1 })),
        };
      })
    );
    setHasChanges(true);
    setSaveSuccessNotice(false);
  };

  // Save Mapping Canonical
  const handleSave = () => {
    const result: ATPUnitMappingData = {
      id: mapping?.id && mapping.id.trim() ? mapping.id : `atp-mapping-${Date.now()}`,
      academicSettingId: academicSetting?.id || atp.academicSettingId || '',
      atpId: atp.id,
      tpDataId: tp.id || atp.tpDataId,
      units: units.map((u, idx) => ({
        ...u,
        order: idx + 1,
        linkedAtpItemIds: u.linkedAtpItemIds || [],
        linkedTpIds: deriveUnitLinkedTpIds(u.linkedAtpItemIds || [], atp.items || []),
        materials: (u.materials || []).map((m, mIdx) => ({
          ...m,
          order: mIdx + 1,
          linkedTpIds: m.linkedTpIds || [],
          linkedAtpItemIds: m.linkedAtpItemIds || [],
        })),
      })),
      basedOnTpUpdatedAt: tp.updatedAt || atp.basedOnTpUpdatedAt,
      basedOnAtpUpdatedAt: atp.updatedAt,
      updatedAt: new Date().toISOString(),
    };

    onSaveMapping(result);
    setHasChanges(false);
    setSaveSuccessNotice(true);
    setTimeout(() => setSaveSuccessNotice(false), 3500);
  };

  const handleProceedNext = () => {
    if (hasChanges) {
      handleSave();
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
              Kelompokkan langkah-langkah Alur Tujuan Pembelajaran (ATP) ke dalam <strong>Unit / Bab</strong> dan rumuskan fokus <strong>Lingkup Materi Inti</strong>. Setiap Bab menjadi wadah tematis yang memayungi langkah ATP dan memuat banyak Lingkup Materi.
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
            <span>Perubahan pemetaan Unit/Bab dan Lingkup Materi berhasil disimpan ke Pemetaan Bab dan Lingkup Materi.</span>
          </div>
        )}

        {hasChanges && !saveSuccessNotice && (
          <div className="mt-3 p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs font-medium flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>Terdapat perubahan Unit/Bab atau Lingkup Materi yang belum disimpan. Klik "Simpan Pemetaan" atau lanjutkan untuk menyimpan.</span>
          </div>
        )}
      </div>

      {/* Top Controls: Target Count, AI Status & Add Bab */}
      <div className="bg-white rounded-2xl border border-indigo-100 shadow-xs p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {/* Target Count Input */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-slate-50 px-3.5 py-2 rounded-xl border border-slate-200">
              <label htmlFor="target-unit-count" className="text-xs font-bold text-slate-800 whitespace-nowrap">
                Jumlah Bab:
              </label>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => handleTargetCountChange(units.length - 1)}
                  disabled={units.length <= 1}
                  className="w-7 h-7 rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 flex items-center justify-center text-xs font-bold disabled:opacity-40 cursor-pointer"
                >
                  -
                </button>
                <input
                  id="target-unit-count"
                  type="number"
                  min={1}
                  max={15}
                  value={units.length}
                  onChange={(e) => handleTargetCountChange(parseInt(e.target.value, 10) || 1)}
                  className="w-12 text-center text-xs font-bold py-1 rounded-md border border-slate-300 bg-white"
                />
                <button
                  type="button"
                  onClick={() => handleTargetCountChange(units.length + 1)}
                  disabled={units.length >= 15}
                  className="w-7 h-7 rounded-lg bg-white border border-slate-300 text-slate-700 hover:bg-slate-100 flex items-center justify-center text-xs font-bold disabled:opacity-40 cursor-pointer"
                >
                  +
                </button>
              </div>
            </div>

            <button
              type="button"
              onClick={handleAddEmptyBab}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-dashed border-indigo-300 text-indigo-700 hover:bg-indigo-50 text-xs font-bold transition cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Tambah Bab Baru</span>
            </button>
          </div>

          {/* AI Status Buttons (Disabled during F3.1 manual editor milestone) */}
          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              id="btn-generate-ai-mapping"
              type="button"
              disabled={true}
              title="AI Generator Pemetaan Bab & Lingkup Materi akan diaktifkan pada milestone berikutnya"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-slate-400 bg-slate-100 border border-slate-200 cursor-not-allowed shadow-2xs"
            >
              <Sparkles className="w-4 h-4 text-slate-400" />
              <span>Generate Pemetaan AI (Segera Hadir)</span>
            </button>

            <button
              id="btn-complete-missing-mapping"
              type="button"
              disabled={true}
              title="AI Lengkapi Kosong akan diaktifkan pada milestone berikutnya"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-slate-400 bg-slate-100 border border-slate-200 cursor-not-allowed shadow-2xs"
            >
              <ListPlus className="w-4 h-4 text-slate-400" />
              <span>Lengkapi yang Kosong (Segera Hadir)</span>
            </button>
          </div>
        </div>

        {/* Informational Guidance Notice */}
        <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/80 flex items-start gap-2.5 text-xs text-slate-600">
          <Info className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
          <p>
            <strong>Struktur Canonical:</strong> Guru menyusun judul Bab dan mendefinisikan Lingkup Materi secara terstruktur. Setiap Bab dapat memuat banyak Lingkup Materi dan menaungi beberapa langkah ATP.
          </p>
        </div>
      </div>

      {/* Overview Stat Bar */}
      <div className="flex items-center justify-between text-xs text-slate-500 px-1">
        <div className="flex items-center gap-2 font-semibold">
          <Layers className="w-4 h-4 text-blue-700" />
          <span>Struktur Unit: {units.length} Bab Terdaftar</span>
        </div>
        <div>
          <span>Terpetakan: <strong className="text-slate-800">{mappedCount}</strong> dari {sortedAtpItems.length} Langkah ATP</span>
        </div>
      </div>

      {/* Bab-Centered Editor: List of Bab Containers */}
      <div className="space-y-6">
        {units.map((unit, bIdx) => {
          const assignedItemIds = unit.linkedAtpItemIds || [];

          return (
            <div
              key={unit.id || `unit-${bIdx}`}
              className="bg-white rounded-2xl border border-slate-200/90 shadow-xs overflow-hidden transition"
            >
              {/* Bab Container Header */}
              <div className="bg-slate-50/90 p-4 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex items-center gap-3 flex-1">
                  <span className="px-3 py-1 rounded-xl bg-blue-900 text-white font-bold text-xs shrink-0 shadow-2xs">
                    BAB {bIdx + 1}
                  </span>
                  <div className="flex-1 flex items-center gap-2">
                    <label htmlFor={`bab-title-input-${unit.id}`} className="sr-only">Judul Bab</label>
                    <input
                      id={`bab-title-input-${unit.id}`}
                      type="text"
                      value={unit.title}
                      placeholder={`Judul Bab ${bIdx + 1}...`}
                      onChange={(e) => handleRenameBab(unit.id, e.target.value)}
                      className="w-full text-sm font-bold text-slate-900 px-3 py-1.5 rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-600 bg-white"
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[11px] font-bold text-slate-500 bg-white px-2.5 py-1 rounded-lg border border-slate-200">
                    {assignedItemIds.length} Langkah ATP
                  </span>
                  <span className="text-[11px] font-bold text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-lg border border-indigo-200">
                    {(unit.materials || []).length} Lingkup Materi
                  </span>

                  {assignedItemIds.length === 0 && (
                    <button
                      type="button"
                      title="Hapus Bab Kosong Ini"
                      onClick={() => handleRemoveBab(unit.id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-rose-600 hover:bg-rose-50 border border-rose-200 text-xs font-bold transition cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Hapus Bab</span>
                    </button>
                  )}
                </div>
              </div>

              {/* SECTION: Lingkup Materi (0..n per Bab) */}
              <div className="p-4 sm:p-5 border-b border-slate-200/80 bg-slate-50/40 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-indigo-700" />
                    <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                      Lingkup Materi ({(unit.materials || []).length})
                    </span>
                    <span className="text-[11px] text-slate-500 hidden sm:inline">
                      • Materi pokok / topik yang dipelajari pada Bab ini
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleAddMaterial(unit.id)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 text-indigo-700 text-xs font-bold transition cursor-pointer border border-indigo-200 shadow-2xs"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Tambah Lingkup Materi</span>
                  </button>
                </div>

                {(!unit.materials || unit.materials.length === 0) ? (
                  <div className="p-4 rounded-xl border border-dashed border-slate-200 bg-white text-center text-xs text-slate-400">
                    Belum ada lingkup materi pada Bab ini. Klik <strong>"+ Tambah Lingkup Materi"</strong> untuk menambahkan topik materi.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {unit.materials.map((mat, mIdx) => (
                      <div
                        key={mat.id}
                        className="flex items-center gap-2 p-2.5 rounded-xl bg-white border border-slate-200 shadow-2xs"
                      >
                        <span className="w-6 h-6 rounded-md bg-indigo-50 text-indigo-700 text-xs font-bold flex items-center justify-center shrink-0">
                          {mIdx + 1}
                        </span>
                        <input
                          type="text"
                          value={mat.title}
                          placeholder={`Topik / Lingkup Materi ${mIdx + 1}...`}
                          onChange={(e) => handleMaterialTitleChange(unit.id, mat.id, e.target.value)}
                          className="flex-1 text-xs font-medium px-3 py-1.5 rounded-lg border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-indigo-600 bg-white"
                        />
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleMoveMaterial(unit.id, mIdx, 'up')}
                            disabled={mIdx === 0}
                            className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-20 cursor-pointer"
                            title="Geser naik"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleMoveMaterial(unit.id, mIdx, 'down')}
                            disabled={mIdx === unit.materials.length - 1}
                            className="p-1 text-slate-400 hover:text-slate-700 disabled:opacity-20 cursor-pointer"
                            title="Geser turun"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRemoveMaterial(unit.id, mat.id)}
                            className="p-1 text-slate-400 hover:text-rose-600 transition cursor-pointer"
                            title="Hapus lingkup materi"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* List of ATP Steps Assigned to This Bab */}
              <div className="bg-white">
                <div className="px-4 py-2 bg-slate-50/70 border-b border-slate-100 flex items-center justify-between text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                  <span>Langkah Alur Tujuan Pembelajaran (ATP) dalam Bab Ini</span>
                  <span>{assignedItemIds.length} Langkah</span>
                </div>

                {assignedItemIds.length === 0 ? (
                  <div className="p-6 text-center text-xs text-slate-400 italic bg-white">
                    Belum ada langkah ATP yang ditugaskan ke Bab ini. Pindahkan langkah ATP dari bab lain atau dari kelompok belum terpetakan di bawah.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {assignedItemIds.map((atpItemId, itemIdx) => {
                      const item = atpItemMap.get(atpItemId);
                      if (!item) return null;

                      const itemTpIds = Array.isArray(item.linkedTpIds) && item.linkedTpIds.length > 0
                        ? item.linkedTpIds
                        : item.tpId ? [item.tpId] : [];

                      return (
                        <div
                          key={item.id || `atp-${itemIdx}`}
                          className="p-4 sm:p-5 hover:bg-slate-50/40 transition flex flex-col lg:flex-row lg:items-start gap-4"
                        >
                          {/* Column 1: Step Number & Focus / Badges */}
                          <div className="w-full lg:w-44 shrink-0 space-y-1.5">
                            <div className="flex items-center gap-2">
                              <span className="inline-flex items-center justify-center px-2.5 py-1 rounded-lg bg-blue-900 text-white font-bold text-xs shadow-2xs">
                                Langkah {item.stepNumber || itemIdx + 1}
                              </span>
                              {itemTpIds.length > 0 && (
                                <span className="px-2 py-0.5 rounded-md bg-blue-50 border border-blue-200 text-blue-800 font-bold text-xs">
                                  {itemTpIds.length} TP
                                </span>
                              )}
                            </div>
                            {item.focus && (
                              <p className="text-[11px] font-semibold text-indigo-950">
                                {item.focus}
                              </p>
                            )}
                          </div>

                          {/* Column 2: Canonical TPs */}
                          <div className="flex-1 space-y-1.5">
                            <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                              Tujuan Pembelajaran Tertaut
                            </div>
                            {itemTpIds.length > 0 ? (
                              <div className="space-y-1">
                                {itemTpIds.map((tpId) => {
                                  const tpItem = tpMap.get(tpId);
                                  return (
                                    <div key={tpId} className="text-xs text-slate-800 flex items-start gap-1.5">
                                      <span className="font-mono font-bold text-blue-800 bg-blue-50 px-1 py-0.5 rounded border border-blue-200 shrink-0">
                                        [{tpItem?.code || 'TP'}]
                                      </span>
                                      <span className="leading-snug pt-0.5">
                                        {tpItem?.statement || '-'}
                                      </span>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <p className="text-xs text-slate-800 leading-relaxed font-normal">
                                {item.tpStatement || '-'}
                              </p>
                            )}
                          </div>

                          {/* Column 3: Reassign Dropdown */}
                          <div className="w-full lg:w-52 shrink-0 space-y-1">
                            <label className="block text-[11px] font-bold text-slate-500 uppercase">
                              Pindahkan ke:
                            </label>
                            <select
                              value={unit.id}
                              onChange={(e) => handleMoveItemToBab(item.id, e.target.value)}
                              className="w-full text-xs font-bold text-slate-800 bg-white px-3 py-2 rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-blue-600 cursor-pointer"
                            >
                              {units.map((targetUnit, tIdx) => (
                                <option key={targetUnit.id} value={targetUnit.id}>
                                  Bab {tIdx + 1}: {targetUnit.title}
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
            </div>
          );
        })}

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
                const itemTpIds = Array.isArray(item.linkedTpIds) && item.linkedTpIds.length > 0
                  ? item.linkedTpIds
                  : item.tpId ? [item.tpId] : [];

                return (
                  <div
                    key={item.id || `unassigned-${uIdx}`}
                    className="p-4 sm:p-5 flex flex-col lg:flex-row lg:items-start gap-4"
                  >
                    <div className="w-full lg:w-44 shrink-0 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center justify-center px-2.5 py-1 rounded-lg bg-amber-800 text-white font-bold text-xs">
                          Langkah {item.stepNumber || uIdx + 1}
                        </span>
                        {itemTpIds.length > 0 && (
                          <span className="px-2 py-0.5 rounded-md bg-amber-50 border border-amber-200 text-amber-900 font-bold text-xs">
                            {itemTpIds.length} TP
                          </span>
                        )}
                      </div>
                      {item.focus && (
                        <p className="text-[11px] font-semibold text-amber-950">
                          {item.focus}
                        </p>
                      )}
                    </div>

                    <div className="flex-1 space-y-1.5">
                      <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                        Tujuan Pembelajaran Tertaut
                      </div>
                      {itemTpIds.length > 0 ? (
                        <div className="space-y-1">
                          {itemTpIds.map((tpId) => {
                            const tpItem = tpMap.get(tpId);
                            return (
                              <div key={tpId} className="text-xs text-slate-800 flex items-start gap-1.5">
                                <span className="font-mono font-bold text-blue-800 bg-blue-50 px-1 py-0.5 rounded border border-blue-200 shrink-0">
                                  [{tpItem?.code || 'TP'}]
                                </span>
                                <span className="leading-snug pt-0.5">
                                  {tpItem?.statement || '-'}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-800 leading-relaxed">
                          {item.tpStatement || '-'}
                        </p>
                      )}
                    </div>

                    <div className="w-full lg:w-52 shrink-0 space-y-1">
                      <label className="block text-[11px] font-bold text-slate-700 uppercase">
                        Tugaskan ke Bab:
                      </label>
                      <select
                        value=""
                        onChange={(e) => handleMoveItemToBab(item.id, e.target.value)}
                        className="w-full text-xs font-bold text-indigo-900 bg-indigo-50/80 px-3 py-2 rounded-xl border border-indigo-200 focus:outline-hidden focus:ring-2 focus:ring-indigo-600 cursor-pointer"
                      >
                        <option value="">Pilih Bab Tujuan...</option>
                        {units.map((u, uIdx) => (
                          <option key={u.id} value={u.id}>
                            Bab {uIdx + 1}: {u.title}
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
