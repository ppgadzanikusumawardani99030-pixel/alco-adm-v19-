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
import {
  analyzeATPUnitMappingWithAI,
  MappingAnalysisResult,
} from '../services/aiService';

export interface ATPUnitMappingManagerProps {
  atp: ATPData;
  tp: TPData;
  mapping?: ATPUnitMappingData;
  academicSetting?: AcademicSetting;
  onSaveMapping: (updatedMapping: ATPUnitMappingData) => boolean;
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

  // Fallback initial draft: bootstrap from legacy unitTitle & materialScope if available
  const legacyUnitMap = new Map<
    string,
    { atpIds: string[]; materialsMap: Map<string, { atpIds: string[]; tpIds: string[] }> }
  >();

  atpItems.forEach((it) => {
    const t = it.unitTitle?.trim();
    if (t) {
      if (!legacyUnitMap.has(t)) {
        legacyUnitMap.set(t, { atpIds: [], materialsMap: new Map() });
      }
      const unitEntry = legacyUnitMap.get(t)!;
      unitEntry.atpIds.push(it.id);

      const mScope = it.materialScope?.trim();
      if (mScope) {
        if (!unitEntry.materialsMap.has(mScope)) {
          unitEntry.materialsMap.set(mScope, { atpIds: [], tpIds: [] });
        }
        const matEntry = unitEntry.materialsMap.get(mScope)!;
        matEntry.atpIds.push(it.id);
        const itemTpIds =
          Array.isArray(it.linkedTpIds) && it.linkedTpIds.length > 0
            ? it.linkedTpIds
            : it.tpId
            ? [it.tpId]
            : [];
        itemTpIds.forEach((id) => {
          if (id && !matEntry.tpIds.includes(id)) matEntry.tpIds.push(id);
        });
      }
    }
  });

  if (legacyUnitMap.size > 0) {
    const initial: ATPUnitMapping[] = [];
    let order = 1;
    legacyUnitMap.forEach((entry, title) => {
      const mats: ATPUnitMaterial[] = [];
      let mOrder = 1;
      entry.materialsMap.forEach((mEntry, mTitle) => {
        mats.push({
          id: `mat-${Date.now()}-${order}-${mOrder}-${Math.random().toString(36).substring(2, 6)}`,
          title: mTitle,
          order: mOrder,
          linkedAtpItemIds: mEntry.atpIds,
          linkedTpIds: mEntry.tpIds,
        });
        mOrder++;
      });

      initial.push({
        id: `unit-${Date.now()}-${order}-${Math.random().toString(36).substring(2, 6)}`,
        title,
        order,
        linkedAtpItemIds: entry.atpIds,
        linkedTpIds: deriveUnitLinkedTpIds(entry.atpIds, atpItems),
        materials: mats,
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
  const [saveErrorNotice, setSaveErrorNotice] = useState<string | null>(null);
  const [localValidationNotice, setLocalValidationNotice] = useState<string | null>(null);

  // Sync state if canonical mapping prop updates
  useEffect(() => {
    if (mapping && Array.isArray(mapping.units) && mapping.units.length > 0) {
      if (!hasChanges) {
        setUnits(createInitialUnits(mapping, atp.items || []));
      }
    }
  }, [mapping, hasChanges, atp.items]);

  // Canonical mapping existence and unsaved draft checks
  const hasCanonicalMapping = Boolean(
    mapping && Array.isArray(mapping.units) && mapping.units.length > 0
  );

  const hasMeaningfulUnsavedDraft =
    !hasCanonicalMapping &&
    units.some(
      (unit) =>
        (unit.linkedAtpItemIds && unit.linkedAtpItemIds.length > 0) ||
        (unit.materials && unit.materials.some((mat) => mat.title && mat.title.trim().length > 0))
    );

  const canSave = hasChanges || hasMeaningfulUnsavedDraft;

  // Local structural validator (deterministic check)
  const localValidation = useMemo(() => {
    const validAtpIds = new Set<string>(
      (atp.items || [])
        .map((i) => i.id)
        .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    );
    const issues: string[] = [];

    let emptyTitleCount = 0;
    let missingMaterialsCount = 0;
    let invalidAtpRefCount = 0;
    let duplicateAtpCount = 0;
    const seenAtpInUnits = new Set<string>();

    if (units.length === 0) {
      issues.push('Belum ada Bab yang dibuat.');
    } else {
      units.forEach((u) => {
        if (!u.title || !u.title.trim()) {
          emptyTitleCount++;
        }

        if (!Array.isArray(u.materials) || u.materials.length === 0) {
          missingMaterialsCount++;
        } else {
          const hasInvalidMat = u.materials.some((m) => !m.title || !m.title.trim());
          if (hasInvalidMat) {
            missingMaterialsCount++;
          }
          u.materials.forEach((mat) => {
            if (Array.isArray(mat.linkedAtpItemIds)) {
              mat.linkedAtpItemIds.forEach((matAtpId) => {
                if (matAtpId && !validAtpIds.has(matAtpId)) {
                  invalidAtpRefCount++;
                }
              });
            }
          });
        }

        if (Array.isArray(u.linkedAtpItemIds)) {
          u.linkedAtpItemIds.forEach((id) => {
            if (!id || !validAtpIds.has(id)) {
              invalidAtpRefCount++;
            } else {
              if (seenAtpInUnits.has(id)) {
                duplicateAtpCount++;
              }
              seenAtpInUnits.add(id);
            }
          });
        }
      });

      let unmappedCount = 0;
      validAtpIds.forEach((id) => {
        if (!seenAtpInUnits.has(id)) {
          unmappedCount++;
        }
      });

      if (emptyTitleCount > 0) {
        issues.push(`${emptyTitleCount} Bab belum memiliki judul.`);
      }
      if (missingMaterialsCount > 0) {
        issues.push(`${missingMaterialsCount} Bab belum memiliki Lingkup Materi yang valid.`);
      }
      if (invalidAtpRefCount > 0) {
        issues.push(`${invalidAtpRefCount} referensi ID ATP tidak valid.`);
      }
      if (duplicateAtpCount > 0) {
        issues.push(`${duplicateAtpCount} langkah ATP terduplikasi di lebih dari satu Bab.`);
      }
      if (unmappedCount > 0) {
        issues.push(`${unmappedCount} langkah ATP belum dipetakan ke Bab.`);
      }
    }

    const isComplete = issues.length === 0 && (atp.items || []).length > 0;
    return {
      isComplete,
      issues,
      summaryMessage: isComplete
        ? 'Pemetaan Bab dan Lingkup Materi lengkap.'
        : `Belum lengkap: ${issues.join(' ')}`,
    };
  }, [units, atp.items]);

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
    setSaveErrorNotice(null);
    setAnalysisResult(null);
    setSelectedAnalysisActionIds(new Set());
    setAppliedNotice(null);
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
    setSaveErrorNotice(null);
    setAnalysisResult(null);
    setSelectedAnalysisActionIds(new Set());
    setAppliedNotice(null);
  };

  const handleRemoveBab = (unitId: string) => {
    setUnits((prev) => {
      const filtered = prev.filter((u) => u.id !== unitId);
      return filtered.map((u, idx) => ({ ...u, order: idx + 1 }));
    });
    setHasChanges(true);
    setSaveSuccessNotice(false);
    setSaveErrorNotice(null);
    setAnalysisResult(null);
    setSelectedAnalysisActionIds(new Set());
    setAppliedNotice(null);
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
      setSaveSuccessNotice(false);
      setSaveErrorNotice(null);
      setAnalysisResult(null);
      setSelectedAnalysisActionIds(new Set());
      setAppliedNotice(null);
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
        setSaveSuccessNotice(false);
        setSaveErrorNotice(null);
        setAnalysisResult(null);
        setSelectedAnalysisActionIds(new Set());
        setAppliedNotice(null);
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
    setSaveErrorNotice(null);
    setAnalysisResult(null);
    setSelectedAnalysisActionIds(new Set());
    setAppliedNotice(null);
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
    setSaveErrorNotice(null);
    setAnalysisResult(null);
    setSelectedAnalysisActionIds(new Set());
    setAppliedNotice(null);
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
    setSaveErrorNotice(null);
    setAnalysisResult(null);
    setSelectedAnalysisActionIds(new Set());
    setAppliedNotice(null);
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
    setSaveErrorNotice(null);
    setAnalysisResult(null);
    setSelectedAnalysisActionIds(new Set());
    setAppliedNotice(null);
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
    setSaveErrorNotice(null);
    setAnalysisResult(null);
    setSelectedAnalysisActionIds(new Set());
    setAppliedNotice(null);
  };

  // Helper to build canonical ATPUnitMappingData from current live draft
  const buildCurrentMappingDraft = (): ATPUnitMappingData => {
    const finalUnits: ATPUnitMapping[] = units.map((u, idx) => {
      const uId = u.id && u.id.trim() ? u.id.trim() : `unit-${Date.now()}-${idx + 1}`;
      const uTitle = u.title !== undefined ? u.title : `Bab ${idx + 1}`;
      const linkedAtpItemIds = Array.isArray(u.linkedAtpItemIds) ? [...u.linkedAtpItemIds] : [];
      const linkedTpIds = deriveUnitLinkedTpIds(linkedAtpItemIds, atp.items || []);
      const materials: ATPUnitMaterial[] = (u.materials || []).map((m, mIdx) => ({
        id: m.id && m.id.trim() ? m.id.trim() : `mat-${Date.now()}-${mIdx + 1}`,
        title: m.title !== undefined ? m.title : '',
        order: mIdx + 1,
        linkedTpIds: Array.isArray(m.linkedTpIds) ? [...m.linkedTpIds] : [],
        linkedAtpItemIds: Array.isArray(m.linkedAtpItemIds) ? [...m.linkedAtpItemIds] : [],
      }));

      return {
        id: uId,
        title: uTitle,
        order: idx + 1,
        linkedAtpItemIds,
        linkedTpIds,
        materials,
      };
    });

    return {
      id: mapping?.id && mapping.id.trim() ? mapping.id.trim() : (atp.id ? `mapping-${atp.id}` : `atp-mapping-${Date.now()}`),
      academicSettingId: academicSetting?.id || atp.academicSettingId || '',
      atpId: atp.id,
      tpDataId: tp.id || atp.tpDataId || '',
      units: finalUnits,
      basedOnTpUpdatedAt: tp.updatedAt || atp.basedOnTpUpdatedAt,
      basedOnAtpUpdatedAt: atp.updatedAt,
      updatedAt: new Date().toISOString(),
    };
  };

  // AI Analysis State
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<MappingAnalysisResult | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [selectedAnalysisActionIds, setSelectedAnalysisActionIds] = useState<Set<string>>(new Set());
  const [appliedNotice, setAppliedNotice] = useState<string | null>(null);

  const handleAnalyzeMapping = async () => {
    setIsAnalyzing(true);
    setAnalysisError(null);
    setAppliedNotice(null);

    try {
      const currentDraft = buildCurrentMappingDraft();
      const result = await analyzeATPUnitMappingWithAI({
        subject: academicSetting?.subject,
        grade: academicSetting?.grade,
        phase: academicSetting?.phase,
        tpData: tp,
        atpData: atp,
        currentMapping: currentDraft,
      });

      setAnalysisResult(result);
      setSelectedAnalysisActionIds(new Set());
    } catch (err: any) {
      setAnalysisError(err?.message || 'Gagal menganalisis pemetaan Bab & Lingkup Materi.');
      setAnalysisResult(null);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleToggleAction = (findingId: string) => {
    setSelectedAnalysisActionIds((prev) => {
      const next = new Set(prev);
      if (next.has(findingId)) {
        next.delete(findingId);
      } else {
        next.add(findingId);
      }
      return next;
    });
  };

  const handleSelectAllActionable = () => {
    if (!analysisResult) return;
    const allActionIds = new Set<string>();
    analysisResult.atpFindings.forEach((f) => {
      if (f.action) allActionIds.add(f.id);
    });
    analysisResult.materialFindings.forEach((m) => {
      if (m.action) allActionIds.add(m.id);
    });
    setSelectedAnalysisActionIds(allActionIds);
  };

  const handleDeselectAllActionable = () => {
    setSelectedAnalysisActionIds(new Set());
  };

  const handleApplySelectedActions = () => {
    if (!analysisResult || selectedAnalysisActionIds.size === 0) return;

    let nextUnits = [...units];

    const selectedAtpFindings = analysisResult.atpFindings.filter(
      (f) => f.action && selectedAnalysisActionIds.has(f.id)
    );
    const selectedMaterialFindings = analysisResult.materialFindings.filter(
      (m) => m.action && selectedAnalysisActionIds.has(m.id)
    );

    // 1. Apply ASSIGN_ATP_TO_UNIT actions
    selectedAtpFindings.forEach((f) => {
      const action = f.action!;
      const atpItemId = action.atpItemId;
      const targetUnitId = action.targetUnitId;
      const targetMaterialId = action.targetMaterialId;

      // Remove atpItemId from other units to prevent duplication
      nextUnits = nextUnits.map((u) => {
        const nextLinkedAtp = (u.linkedAtpItemIds || []).filter((id) => id !== atpItemId);
        const nextMaterials = (u.materials || []).map((m) => {
          const mNextLinkedAtp = (m.linkedAtpItemIds || []).filter((id) => id !== atpItemId);
          return {
            ...m,
            linkedAtpItemIds: mNextLinkedAtp,
          };
        });
        return {
          ...u,
          linkedAtpItemIds: nextLinkedAtp,
          linkedTpIds: deriveUnitLinkedTpIds(nextLinkedAtp, atp.items || []),
          materials: nextMaterials,
        };
      });

      // Add atpItemId to targetUnit
      nextUnits = nextUnits.map((u) => {
        if (u.id !== targetUnitId) return u;
        const nextLinkedAtp = [...(u.linkedAtpItemIds || [])];
        if (!nextLinkedAtp.includes(atpItemId)) {
          nextLinkedAtp.push(atpItemId);
        }
        const nextTpIds = deriveUnitLinkedTpIds(nextLinkedAtp, atp.items || []);

        const nextMaterials = (u.materials || []).map((m) => {
          if (targetMaterialId && m.id === targetMaterialId) {
            const mNextAtp = [...(m.linkedAtpItemIds || [])];
            if (!mNextAtp.includes(atpItemId)) {
              mNextAtp.push(atpItemId);
            }
            const item = (atp.items || []).find((it) => it.id === atpItemId);
            const itemTps = Array.isArray(item?.linkedTpIds) && item.linkedTpIds.length > 0
              ? item.linkedTpIds
              : item?.tpId
              ? [item.tpId]
              : [];
            const mNextTp = Array.from(new Set([...(m.linkedTpIds || []), ...itemTps]));
            return {
              ...m,
              linkedAtpItemIds: mNextAtp,
              linkedTpIds: mNextTp,
            };
          }
          return m;
        });

        return {
          ...u,
          linkedAtpItemIds: nextLinkedAtp,
          linkedTpIds: nextTpIds,
          materials: nextMaterials,
        };
      });
    });

    // 2. Apply ADD_MATERIAL_TO_UNIT actions
    selectedMaterialFindings.forEach((m) => {
      const action = m.action!;
      const targetUnitId = action.targetUnitId;

      nextUnits = nextUnits.map((u) => {
        if (u.id !== targetUnitId) return u;
        const currentMats = u.materials || [];
        const newMat: ATPUnitMaterial = {
          id: `mat-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
          title: action.title,
          order: currentMats.length + 1,
          linkedTpIds: action.linkedTpIds || [],
          linkedAtpItemIds: action.linkedAtpItemIds || [],
        };
        return {
          ...u,
          materials: [...currentMats, newMat],
        };
      });
    });

    setUnits(nextUnits);
    setHasChanges(true);
    setSelectedAnalysisActionIds(new Set());
    setAnalysisResult(null);
    setSaveSuccessNotice(false);
    setAppliedNotice(
      'Saran terpilih telah diterapkan ke draft Pemetaan. Simpan perubahan, lalu jalankan Analisis Pemetaan kembali untuk verifikasi.'
    );
  };

  // Save Mapping Canonical
  const handleSave = (): boolean => {
    const result = buildCurrentMappingDraft();

    const saved = onSaveMapping(result);
    if (saved) {
      setHasChanges(false);
      setSaveSuccessNotice(true);
      setSaveErrorNotice(null);
      setLocalValidationNotice(null);
      setTimeout(() => setSaveSuccessNotice(false), 3500);
      return true;
    } else {
      setSaveSuccessNotice(false);
      setSaveErrorNotice(
        'Pemetaan belum tersimpan. Periksa pesan kesalahan di atas lalu coba Simpan kembali.'
      );
      return false;
    }
  };

  const handleProceedNext = () => {
    setLocalValidationNotice(null);

    // If there are changes or an unsaved meaningful draft, save first
    if (canSave) {
      const saved = handleSave();
      if (!saved) return;
    }

    // Strict check: proceed only if structurally complete
    if (!localValidation.isComplete) {
      setLocalValidationNotice(
        `Tidak dapat melanjutkan ke Rencana Tahunan: ${localValidation.summaryMessage}`
      );
      return;
    }

    onNextStep();
  };

  // Button state logic for 4 conditions
  let saveButtonText = 'Simpan Pemetaan';
  let isSaveButtonDisabled = true;
  let saveButtonClass = 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed';

  if (hasCanonicalMapping) {
    if (hasChanges) {
      // Condition B: mapping ADA + hasChanges
      saveButtonText = 'Simpan Perubahan';
      isSaveButtonDisabled = false;
      saveButtonClass = 'text-white bg-blue-800 hover:bg-blue-900 ring-2 ring-blue-500/20 cursor-pointer shadow-xs';
    } else {
      // Condition A: mapping ADA + !hasChanges
      saveButtonText = '✓ Tersimpan';
      isSaveButtonDisabled = true;
      saveButtonClass = 'text-emerald-700 bg-emerald-50 border border-emerald-200 cursor-default opacity-90';
    }
  } else {
    if (hasMeaningfulUnsavedDraft || hasChanges) {
      // Condition C: mapping BELUM ADA + hasMeaningfulUnsavedDraft
      saveButtonText = 'Simpan Pemetaan';
      isSaveButtonDisabled = false;
      saveButtonClass = 'text-white bg-blue-800 hover:bg-blue-900 ring-2 ring-blue-500/20 cursor-pointer shadow-xs';
    } else {
      // Condition D: mapping BELUM ADA + !hasChanges + !hasMeaningfulUnsavedDraft
      saveButtonText = 'Simpan Pemetaan';
      isSaveButtonDisabled = true;
      saveButtonClass = 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed';
    }
  }

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
              disabled={isSaveButtonDisabled}
              className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition shadow-xs ${saveButtonClass}`}
            >
              {hasCanonicalMapping && !hasChanges ? (
                <Check className="w-3.5 h-3.5 text-emerald-600" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              <span>{saveButtonText}</span>
            </button>
          </div>
        </div>

        {/* Status Alerts */}
        {localValidationNotice && (
          <div className="mt-3 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-center justify-between gap-2 animate-fadeIn">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{localValidationNotice}</span>
            </div>
            <button
              type="button"
              onClick={() => setLocalValidationNotice(null)}
              className="text-xs font-bold text-rose-600 hover:underline cursor-pointer"
            >
              Tutup
            </button>
          </div>
        )}

        {saveErrorNotice && (
          <div className="mt-3 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-center justify-between gap-2 animate-fadeIn">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{saveErrorNotice}</span>
            </div>
            <button
              type="button"
              onClick={() => setSaveErrorNotice(null)}
              className="text-xs font-bold text-rose-600 hover:underline cursor-pointer"
            >
              Tutup
            </button>
          </div>
        )}

        {saveSuccessNotice && (
          <div className="mt-3 p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center gap-2 animate-fadeIn">
            <Check className="w-4 h-4 text-emerald-600" />
            <span>Perubahan pemetaan Unit/Bab dan Lingkup Materi berhasil disimpan ke Pemetaan Bab dan Lingkup Materi.</span>
          </div>
        )}

        {/* Applied Analysis Notice */}
        {appliedNotice && (
          <div className="mt-3 p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-semibold flex items-center justify-between gap-2 animate-fadeIn">
            <div className="flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{appliedNotice}</span>
            </div>
            <button
              type="button"
              onClick={() => setAppliedNotice(null)}
              className="text-xs font-bold text-emerald-700 hover:underline cursor-pointer"
            >
              Tutup
            </button>
          </div>
        )}

        {/* AI Analysis Error Notice */}
        {analysisError && (
          <div className="mt-3 p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-xs font-semibold flex items-center justify-between gap-2 animate-fadeIn">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>Analisis Pemetaan gagal: {analysisError}</span>
            </div>
            <button
              type="button"
              onClick={() => setAnalysisError(null)}
              className="text-xs font-bold text-rose-600 hover:underline cursor-pointer"
            >
              Tutup
            </button>
          </div>
        )}

        {/* Structural Status Summary Banner */}
        <div className="mt-3">
          {localValidation.isComplete ? (
            <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-semibold flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Pemetaan Bab dan Lingkup Materi lengkap.</span>
            </div>
          ) : (
            <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-medium flex items-center gap-2">
              <Info className="w-4 h-4 text-amber-600 shrink-0" />
              <span>{localValidation.summaryMessage}</span>
            </div>
          )}
        </div>

        {hasChanges && !saveSuccessNotice && !saveErrorNotice && !localValidationNotice && (
          <div className="mt-3 p-2.5 rounded-xl bg-blue-50 border border-blue-200 text-blue-800 text-xs font-medium flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-blue-600 shrink-0" />
            <span>Terdapat perubahan Unit/Bab atau Lingkup Materi yang belum disimpan. Klik "{saveButtonText}" atau lanjutkan untuk menyimpan.</span>
          </div>
        )}
      </div>

      {/* Top Controls: Target Count & AI Analysis */}
      <div className="bg-white rounded-2xl border border-indigo-100 shadow-xs p-5 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {/* Target Count Input & Add Bab */}
          <div className="flex items-center gap-3 flex-wrap">
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

          {/* AI Analysis Trigger Button */}
          <div className="flex items-center gap-2.5">
            <button
              id="btn-analyze-mapping"
              type="button"
              onClick={handleAnalyzeMapping}
              disabled={isAnalyzing || units.length === 0}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-indigo-700 to-blue-700 hover:from-indigo-800 hover:to-blue-800 text-white text-xs font-bold shadow-xs transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Sparkles className={`w-4 h-4 ${isAnalyzing ? 'animate-spin' : ''}`} />
              <span>{isAnalyzing ? 'Menganalisis...' : 'Analisis Pemetaan'}</span>
            </button>
          </div>
        </div>

        {/* Informational Guidance Notice */}
        <div className="bg-slate-50 p-3 rounded-xl border border-slate-200/80 flex items-start gap-2.5 text-xs text-slate-600">
          <Info className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
          <p>
            <strong>Authority Struktur Guru:</strong> Struktur Bab & Lingkup Materi manual adalah acuan utama. Fitur <em>Analisis Pemetaan</em> memberikan telaah keselarasan TP ↔ ATP dan saran opsional tanpa mengubah struktur Bab secara otomatis.
          </p>
        </div>
      </div>

      {/* AI Analysis Findings Panel */}
      {analysisResult && (
        <div className="bg-white rounded-2xl border-2 border-indigo-300 shadow-md p-5 space-y-5 animate-fadeIn">
          {/* Analysis Header & Summary Metrics */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 pb-3 border-b border-indigo-100">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-700" />
                <h4 className="text-sm font-bold text-slate-900">
                  Hasil Analisis Pemetaan Manual ↔ TP ↔ ATP
                </h4>
                <span className="px-2 py-0.5 rounded-md bg-indigo-50 text-indigo-800 text-[11px] font-bold border border-indigo-200">
                  Read-Only Analysis
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                Tinjau temuan keselarasan di bawah. Pilih saran yang ingin diterapkan ke draft, lalu klik <strong>Terapkan Pilihan</strong>.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSelectAllActionable}
                className="text-xs font-bold text-indigo-700 hover:underline cursor-pointer"
              >
                Pilih Semua Saran
              </button>
              <span className="text-slate-300">•</span>
              <button
                type="button"
                onClick={handleDeselectAllActionable}
                className="text-xs font-bold text-slate-600 hover:underline cursor-pointer"
              >
                Kosongkan Pilihan
              </button>
              <span className="text-slate-300">•</span>
              <button
                type="button"
                onClick={() => setAnalysisResult(null)}
                className="text-xs font-bold text-slate-500 hover:underline cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>

          {/* Metrics Overview Pills */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="bg-emerald-50/80 border border-emerald-200 rounded-xl p-3">
              <div className="text-[11px] font-bold text-emerald-800 uppercase">ATP Selaras</div>
              <div className="text-lg font-extrabold text-emerald-900 mt-0.5">
                {analysisResult.summary.alignedAtp} <span className="text-xs font-normal text-emerald-700">Langkah</span>
              </div>
            </div>

            <div className="bg-amber-50/80 border border-amber-200 rounded-xl p-3">
              <div className="text-[11px] font-bold text-amber-800 uppercase">ATP Belum Dipetakan</div>
              <div className="text-lg font-extrabold text-amber-900 mt-0.5">
                {analysisResult.summary.unmappedAtp} <span className="text-xs font-normal text-amber-700">Langkah</span>
              </div>
            </div>

            <div className="bg-rose-50/80 border border-rose-200 rounded-xl p-3">
              <div className="text-[11px] font-bold text-rose-800 uppercase">ATP Perlu Ditinjau</div>
              <div className="text-lg font-extrabold text-rose-900 mt-0.5">
                {analysisResult.summary.reviewAtp} <span className="text-xs font-normal text-rose-700">Langkah</span>
              </div>
            </div>

            <div className="bg-blue-50/80 border border-blue-200 rounded-xl p-3">
              <div className="text-[11px] font-bold text-blue-800 uppercase">Saran Materi</div>
              <div className="text-lg font-extrabold text-blue-900 mt-0.5">
                {analysisResult.summary.missingMaterialSuggestions} <span className="text-xs font-normal text-blue-700">Saran</span>
              </div>
            </div>

            <div className="bg-slate-50 border border-slate-300 rounded-xl p-3">
              <div className="text-[11px] font-bold text-slate-700 uppercase">Materi Perlu Ditinjau</div>
              <div className="text-lg font-extrabold text-slate-900 mt-0.5">
                {analysisResult.summary.manualMaterialReview} <span className="text-xs font-normal text-slate-600">Materi</span>
              </div>
            </div>
          </div>

          {/* Findings Detail List */}
          <div className="space-y-4 pt-1">
            {/* 1. Unmapped ATP Findings with Suggestions */}
            {analysisResult.atpFindings.filter((f) => f.status === 'UNMAPPED').length > 0 && (
              <div className="space-y-2.5">
                <h5 className="text-xs font-bold text-amber-950 uppercase tracking-wider flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 text-amber-700" />
                  <span>Saran Pemetaan Langkah ATP yang Belum Terpetakan</span>
                </h5>

                <div className="space-y-2">
                  {analysisResult.atpFindings
                    .filter((f) => f.status === 'UNMAPPED')
                    .map((finding) => {
                      const atpItem = atpItemMap.get(finding.atpItemId);
                      const targetUnit = units.find((u) => u.id === finding.suggestedUnitId);
                      const isSelected = selectedAnalysisActionIds.has(finding.id);

                      return (
                        <div
                          key={finding.id}
                          className={`p-3.5 rounded-xl border transition flex flex-col md:flex-row md:items-center justify-between gap-3 ${
                            isSelected
                              ? 'bg-amber-50/90 border-amber-400 ring-1 ring-amber-300'
                              : 'bg-white border-slate-200 hover:border-amber-200'
                          }`}
                        >
                          <div className="flex items-start gap-3 flex-1">
                            {finding.action && (
                              <input
                                id={`check-${finding.id}`}
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => handleToggleAction(finding.id)}
                                className="w-4 h-4 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500 mt-1 cursor-pointer"
                              />
                            )}
                            <div className="space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="px-2 py-0.5 rounded-md bg-amber-800 text-white font-bold text-xs">
                                  Langkah {atpItem?.stepNumber || '?'}
                                </span>
                                {atpItem?.focus && (
                                  <span className="font-semibold text-xs text-slate-800">
                                    {atpItem.focus}
                                  </span>
                                )}
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                                  Kekuatan: {finding.strength === 'STRONG' ? 'Kuat' : finding.strength === 'LOW' ? 'Rendah' : 'Sedang'}
                                </span>
                              </div>

                              <p className="text-xs text-slate-600 leading-relaxed">
                                {finding.reason}
                              </p>

                              {targetUnit && (
                                <div className="text-xs font-bold text-indigo-900 bg-indigo-50/80 px-2.5 py-1 rounded-lg inline-block border border-indigo-200">
                                  Saran Bab: Bab {targetUnit.order}: {targetUnit.title}
                                </div>
                              )}
                            </div>
                          </div>

                          {finding.action && (
                            <label
                              htmlFor={`check-${finding.id}`}
                              className="text-xs font-bold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 px-3 py-1.5 rounded-xl border border-indigo-200 shrink-0 cursor-pointer text-center"
                            >
                              {isSelected ? '✓ Terpilih' : 'Terapkan saran ini'}
                            </label>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {/* 2. Review ATP Findings */}
            {analysisResult.atpFindings.filter((f) => f.status === 'REVIEW').length > 0 && (
              <div className="space-y-2.5">
                <h5 className="text-xs font-bold text-rose-950 uppercase tracking-wider flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 text-rose-700" />
                  <span>Langkah ATP yang Perlu Ditinjau Guru</span>
                </h5>

                <div className="space-y-2">
                  {analysisResult.atpFindings
                    .filter((f) => f.status === 'REVIEW')
                    .map((finding) => {
                      const atpItem = atpItemMap.get(finding.atpItemId);
                      const currentUnit = units.find((u) => u.id === finding.currentUnitId);

                      return (
                        <div
                          key={finding.id}
                          className="p-3.5 rounded-xl bg-rose-50/50 border border-rose-200 flex flex-col md:flex-row md:items-center justify-between gap-3"
                        >
                          <div className="space-y-1 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="px-2 py-0.5 rounded-md bg-rose-800 text-white font-bold text-xs">
                                Langkah {atpItem?.stepNumber || '?'}
                              </span>
                              {currentUnit && (
                                <span className="text-xs text-slate-600 font-semibold">
                                  (Saat ini di Bab {currentUnit.order}: {currentUnit.title})
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-rose-900 leading-relaxed">
                              {finding.reason}
                            </p>
                          </div>
                          <span className="text-[11px] font-bold text-rose-700 bg-rose-100 px-2.5 py-1 rounded-lg border border-rose-300 shrink-0">
                            Perlu ditinjau guru
                          </span>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {/* 3. Missing Material Findings */}
            {analysisResult.materialFindings.filter((m) => m.status === 'MISSING_MATERIAL').length > 0 && (
              <div className="space-y-2.5">
                <h5 className="text-xs font-bold text-blue-950 uppercase tracking-wider flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-blue-700" />
                  <span>Saran Penambahan Lingkup Materi</span>
                </h5>

                <div className="space-y-2">
                  {analysisResult.materialFindings
                    .filter((m) => m.status === 'MISSING_MATERIAL')
                    .map((finding) => {
                      const targetUnit = units.find((u) => u.id === finding.unitId);
                      const isSelected = selectedAnalysisActionIds.has(finding.id);

                      return (
                        <div
                          key={finding.id}
                          className={`p-3.5 rounded-xl border transition flex flex-col md:flex-row md:items-center justify-between gap-3 ${
                            isSelected
                              ? 'bg-blue-50/90 border-blue-400 ring-1 ring-blue-300'
                              : 'bg-white border-slate-200 hover:border-blue-200'
                          }`}
                        >
                          <div className="flex items-start gap-3 flex-1">
                            {finding.action && (
                              <input
                                id={`check-${finding.id}`}
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => handleToggleAction(finding.id)}
                                className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 mt-1 cursor-pointer"
                              />
                            )}
                            <div className="space-y-1">
                              <div className="flex items-center gap-2">
                                <span className="px-2 py-0.5 rounded-md bg-blue-800 text-white font-bold text-xs">
                                  + {finding.suggestedTitle || finding.action?.title}
                                </span>
                                {targetUnit && (
                                  <span className="text-xs text-slate-700 font-semibold">
                                    untuk Bab {targetUnit.order}: {targetUnit.title}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-slate-600 leading-relaxed">
                                {finding.reason}
                              </p>
                            </div>
                          </div>

                          {finding.action && (
                            <label
                              htmlFor={`check-${finding.id}`}
                              className="text-xs font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-xl border border-blue-200 shrink-0 cursor-pointer text-center"
                            >
                              {isSelected ? '✓ Terpilih' : 'Tambahkan materi ini'}
                            </label>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {/* 4. Manual Material Review Findings */}
            {analysisResult.materialFindings.filter((m) => m.status === 'MANUAL_REVIEW').length > 0 && (
              <div className="space-y-2.5">
                <h5 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4 text-slate-600" />
                  <span>Lingkup Materi Manual yang Perlu Ditinjau</span>
                </h5>

                <div className="space-y-2">
                  {analysisResult.materialFindings
                    .filter((m) => m.status === 'MANUAL_REVIEW')
                    .map((finding) => {
                      const unit = units.find((u) => u.id === finding.unitId);
                      const mat = (unit?.materials || []).find((m) => m.id === finding.materialId);

                      return (
                        <div
                          key={finding.id}
                          className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3"
                        >
                          <div className="space-y-1 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              {unit && (
                                <span className="px-2 py-0.5 rounded-md bg-slate-800 text-white font-bold text-xs">
                                  Bab {unit.order}: {unit.title}
                                </span>
                              )}
                              <span className="font-bold text-xs text-slate-900">
                                Materi: {mat?.title || finding.suggestedTitle || '(Tanpa Judul)'}
                              </span>
                            </div>
                            <p className="text-xs text-slate-600 leading-relaxed">
                              {finding.reason}
                            </p>
                          </div>

                          <span className="text-[11px] font-bold text-slate-700 bg-slate-200/80 px-2.5 py-1 rounded-lg border border-slate-300 shrink-0">
                            Perlu ditinjau guru
                          </span>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {/* 5. Aligned ATP List (Collapsed overview) */}
            {analysisResult.atpFindings.filter((f) => f.status === 'ALIGNED').length > 0 && (
              <details className="bg-slate-50/70 p-3 rounded-xl border border-slate-200 text-xs text-slate-700 space-y-2">
                <summary className="font-bold text-emerald-800 cursor-pointer hover:underline">
                  Lihat {analysisResult.summary.alignedAtp} Langkah ATP yang Sudah Selaras
                </summary>
                <div className="space-y-1.5 pt-2">
                  {analysisResult.atpFindings
                    .filter((f) => f.status === 'ALIGNED')
                    .map((finding) => {
                      const atpItem = atpItemMap.get(finding.atpItemId);
                      const unit = units.find((u) => u.id === finding.currentUnitId);
                      return (
                        <div key={finding.id} className="flex items-center justify-between text-xs py-1 border-b border-slate-200/60 last:border-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900">Langkah {atpItem?.stepNumber || '?'}:</span>
                            <span>{atpItem?.focus || 'Fokus ATP'}</span>
                          </div>
                          {unit && (
                            <span className="text-[11px] font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                              Bab {unit.order}: {unit.title}
                            </span>
                          )}
                        </div>
                      );
                    })}
                </div>
              </details>
            )}

            {/* 6. Supported Materials List (Collapsed overview) */}
            {analysisResult.materialFindings.filter((m) => m.status === 'SUPPORTED').length > 0 && (
              <details className="bg-slate-50/70 p-3 rounded-xl border border-slate-200 text-xs text-slate-700 space-y-2">
                <summary className="font-bold text-emerald-800 cursor-pointer hover:underline">
                  Lihat {analysisResult.materialFindings.filter((m) => m.status === 'SUPPORTED').length} Lingkup Materi yang Didukung TP/ATP
                </summary>
                <div className="space-y-1.5 pt-2">
                  {analysisResult.materialFindings
                    .filter((m) => m.status === 'SUPPORTED')
                    .map((finding) => {
                      const unit = units.find((u) => u.id === finding.unitId);
                      const mat = (unit?.materials || []).find((m) => m.id === finding.materialId);
                      return (
                        <div key={finding.id} className="flex items-center justify-between text-xs py-1 border-b border-slate-200/60 last:border-0">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900">Bab {unit?.order || '?'}:</span>
                            <span>{mat?.title || 'Materi'}</span>
                          </div>
                          <span className="text-[11px] font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                            Didukung TP/ATP
                          </span>
                        </div>
                      );
                    })}
                </div>
              </details>
            )}
          </div>

          {/* Action Footer inside Panel */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-3 border-t border-indigo-100">
            <div className="text-xs text-slate-500">
              Terpilih: <strong className="text-slate-800">{selectedAnalysisActionIds.size}</strong> saran untuk diterapkan.
            </div>

            <div className="flex items-center gap-2 w-full sm:w-auto">
              <button
                type="button"
                onClick={() => setAnalysisResult(null)}
                className="w-full sm:w-auto px-4 py-2 rounded-xl text-xs font-semibold text-slate-600 hover:bg-slate-100 border border-slate-200 transition cursor-pointer"
              >
                Tutup Hasil
              </button>

              <button
                id="btn-apply-analysis-actions"
                type="button"
                onClick={handleApplySelectedActions}
                disabled={selectedAnalysisActionIds.size === 0}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-5 py-2 rounded-xl text-xs font-bold text-white bg-indigo-800 hover:bg-indigo-900 disabled:bg-slate-200 disabled:text-slate-400 transition cursor-pointer shadow-xs disabled:cursor-not-allowed"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Terapkan Pilihan ({selectedAnalysisActionIds.size})</span>
              </button>
            </div>
          </div>
        </div>
      )}

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
