import {
  AcademicSetting,
  ActiveContext,
  ATPData,
  TPData,
  LearningPlan,
  AssessmentCriterion,
  AssessmentPlan,
  AssessmentPackage,
  ATPUnitMappingData,
  UnitExecutionPlanData,
  LearningMeetingScheduleData,
} from '../types';
import { APP_BUILD_ID } from '../config/buildInfo';
import { normalizePhaseCode, TPValidationDetails } from './cpWorkflowService';
import {
  UnitExecutionPlanValidationResult,
  resolveUnitSemesterPlacement,
} from './unitSemesterPlanningService';
import { AIMeetingDiagnostic } from './aiService';
import { UnitSemesterPlacementValidation } from './unitSemesterPlanningService';

export type DiagnosticScope =
  | 'TP'
  | 'ATP'
  | 'UNIT_EXECUTION_PLAN'
  | 'LEARNING_PLAN'
  | 'KKTP'
  | 'ASSESSMENT_PLAN'
  | 'ASSESSMENT_PACKAGE';

export interface DiagnosticEvent {
  timestamp: string;
  scope: DiagnosticScope;
  action: string;
  status?: string;
  metadata?: Record<string, string | number | boolean | null | undefined>;
}

const STORAGE_KEY = 'alco_diagnostic_events_v1';
const MAX_EVENTS = 30;

function readEvents(): DiagnosticEvent[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.slice(-MAX_EVENTS) : [];
  } catch {
    return [];
  }
}

export function getRecentDiagnosticEvents(scope?: DiagnosticScope): DiagnosticEvent[] {
  const events = readEvents();
  return scope ? events.filter((event) => event.scope === scope) : events;
}

export function recordDiagnosticEvent(event: Omit<DiagnosticEvent, 'timestamp'>): void {
  if (typeof localStorage === 'undefined') return;
  const nextEvent: DiagnosticEvent = {
    timestamp: new Date().toISOString(),
    ...event,
  };
  const events = [...readEvents(), nextEvent].slice(-MAX_EVENTS);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  } catch {
    // Diagnostics must never interrupt the user workflow.
  }
}

function line(key: string, value: unknown): string {
  return `${key}: ${value === undefined || value === null || value === '' ? '-' : String(value)}`;
}

function formatEvents(scope: DiagnosticScope): string[] {
  const events = getRecentDiagnosticEvents(scope).slice(-10);
  if (events.length === 0) return ['- none'];
  return events.map((event) => {
    const metadata = event.metadata
      ? Object.entries(event.metadata)
          .filter(([, value]) => value !== undefined)
          .map(([key, value]) => `${key}=${value}`)
          .join(', ')
      : '';
    return `- ${event.timestamp} ${event.action}${event.status ? ` status=${event.status}` : ''}${metadata ? ` (${metadata})` : ''}`;
  });
}

export function buildTPDiagnosticReport(data: {
  module?: 'TP' | 'LEARNING_PLAN';
  workspaceId?: string;
  academicSetting?: AcademicSetting | null;
  context?: Partial<ActiveContext> | null;
  tp?: TPData | null;
  uiItemsCount?: number;
  validation?: TPValidationDetails | null;
  atp?: ATPData | null;
  learningPlanGate?: 'ALLOWED' | 'BLOCKED';
  learningPlanGateReason?: string;
}): string {
  const phaseRaw = data.context?.phase || data.academicSetting?.phase || '';
  const tpPhaseRaw = data.tp?.phase || '';
  const validation = data.validation;
  const issues = validation?.issues?.length ? validation.issues.map((issue) => `- ${issue}`) : ['- none'];
  return [
    'ADMINISTRASI GURU AI - DIAGNOSTIC REPORT',
    '',
    'Build:',
    APP_BUILD_ID,
    '',
    'Module:',
    data.module || 'TP',
    '',
    'GeneratedAt:',
    new Date().toISOString(),
    '',
    'Context:',
    line('workspaceId', data.workspaceId),
    line('academicSettingId', data.academicSetting?.id),
    line('curriculumType', data.academicSetting?.curriculumType || data.context?.curriculumType),
    line('academicYear', data.academicSetting?.academicYear || data.context?.academicYear),
    line('semester', data.academicSetting?.semester || data.context?.semester),
    line('level', data.academicSetting?.level || data.context?.level),
    line('grade', data.academicSetting?.grade || data.context?.grade),
    line('phaseRaw', phaseRaw),
    line('phaseNormalized', normalizePhaseCode(phaseRaw)),
    line('subject', data.academicSetting?.subject || data.context?.subject),
    '',
    'TP:',
    line('id', data.tp?.id),
    line('uiItemsCount', data.uiItemsCount ?? data.tp?.items?.length ?? 0),
    line('storedItemsCount', data.tp?.items?.length ?? 0),
    line('workflowStatus', data.tp?.workflowStatus),
    line('runtimeValidationStatus', validation?.status),
    line('runtimeIsSiap', validation?.isSiap),
    line('needsReview', data.tp?.needsReview || false),
    line('generatedBy', data.tp?.generatedBy),
    line('updatedAt', data.tp?.updatedAt),
    line('storedPhaseRaw', tpPhaseRaw),
    line('storedPhaseNormalized', normalizePhaseCode(tpPhaseRaw)),
    '',
    'TP Validation Issues:',
    ...issues,
    '',
    'Downstream:',
    line('atpItemsCount', data.atp?.items?.length ?? 0),
    line('atpWorkflowStatus', data.atp?.workflowStatus),
    line('atpNeedsReview', data.atp?.needsReview || false),
    line('learningPlanGate', data.learningPlanGate || '-'),
    line('learningPlanGateReason', data.learningPlanGateReason || '-'),
    '',
    'Recent Diagnostic Events:',
    ...formatEvents(data.module || 'TP'),
  ].join('\n');
}

function listValue(values?: unknown[]): string {
  return values && values.length > 0 ? `[${values.join(', ')}]` : '[]';
}

function formatTPItems(tp?: TPData | null): string[] {
  const items = tp?.items || [];
  if (items.length === 0) return ['- none'];
  return items.flatMap((item) => [
    `- code: ${item.code || '-'}`,
    `  id: ${item.id || '-'}`,
    `  statement: ${item.statement || '-'}`,
    `  competence: ${item.competence || '-'}`,
    `  contentScope: ${item.contentScope || '-'}`,
    `  cpAnalysisItemIds: ${listValue(item.cpAnalysisItemIds || (item.cpAnalysisId ? [item.cpAnalysisId] : []))}`,
  ]);
}

function formatATPItems(atp?: ATPData | null): string[] {
  const items = atp?.items || [];
  if (items.length === 0) return ['- none'];
  return items.flatMap((item) => [
    `- step: ${item.stepNumber ?? item.sequence ?? '-'}`,
    `  id: ${item.id || '-'}`,
    `  focus: ${item.focus || '-'}`,
    `  linkedTpIds: ${listValue(item.linkedTpIds || (item.tpId ? [item.tpId] : []))}`,
  ]);
}

function countLearningPlanAssessments(plan: LearningPlan, type: 'initial' | 'formative' | 'summative'): number {
  return plan.assessmentPlan?.[type]?.length || 0;
}

export function buildLearningPlanDiagnosticReport(data: {
  workspaceId?: string;
  academicSetting?: AcademicSetting | null;
  tp?: TPData | null;
  atp?: ATPData | null;
  atpUnitMapping?: ATPUnitMappingData | null;
  unitExecutionPlan?: UnitExecutionPlanData | null;
  learningMeetingSchedules?: {
    semesterPlanId: string;
    semester: 1 | 2;
    schedule: LearningMeetingScheduleData;
  }[];
  learningPlans?: LearningPlan[];
  assessmentCriteria?: AssessmentCriterion[];
  assessmentPlans?: AssessmentPlan[];
  activeSemesterScopes?: {
    unitId?: string;
    unitTitle?: string;
    title?: string;
    linkedTpIds?: string[];
    linkedAtpItemIds?: string[];
    learningMeetingIds?: string[];
    meetingCount?: number;
    allocatedJP?: number;
    jp?: number;
  }[];
  learningPlanGate?: 'ALLOWED' | 'BLOCKED';
  learningPlanGateReason?: string;
}): string {
  const setting = data.academicSetting;
  const activeScopes = data.activeSemesterScopes || [];
  const activeMeetingIds = new Set(activeScopes.flatMap((scope) => scope.learningMeetingIds || []));
  const activeUnitIds = new Set(activeScopes.map((scope) => scope.unitId).filter(Boolean));
  const activePlans = (data.learningPlans || []).filter((plan) => {
    if (plan.unitId && activeUnitIds.has(plan.unitId)) return true;
    return (plan.learningMeetingIds || []).some((id) => activeMeetingIds.has(id));
  });
  const scheduleEntries = (data.learningMeetingSchedules || []).flatMap((item) =>
    (item.schedule.entries || []).map((entry) => ({
      entry,
      scheduleStatus: item.schedule.status,
    }))
  );
  const latestAIRequest = getRecentDiagnosticEvents('LEARNING_PLAN')
    .filter((event) => event.action === 'LEARNING_PLAN_AI_REQUEST')
    .slice(-1)[0];

  const canonicalScopes = activeScopes.length > 0
    ? activeScopes.flatMap((scope) => [
        `- unitId: ${scope.unitId || '-'}`,
        `  unitTitle: ${scope.unitTitle || scope.title || '-'}`,
        `  linkedTpIds: ${listValue(scope.linkedTpIds)}`,
        `  linkedAtpItemIds: ${listValue(scope.linkedAtpItemIds)}`,
        `  learningMeetingIds: ${listValue(scope.learningMeetingIds)}`,
        `  meetingCount: ${scope.meetingCount ?? scope.learningMeetingIds?.length ?? 0}`,
        `  allocatedJP: ${scope.allocatedJP ?? scope.jp ?? 0}`,
      ])
    : ['- none'];

  const meetings = (data.unitExecutionPlan?.units || [])
    .filter((unit) => activeUnitIds.has(unit.unitId))
    .flatMap((unit) => unit.meetings || [])
    .filter((meeting) => activeMeetingIds.has(meeting.id))
    .flatMap((meeting) => {
      const scheduleMatch = scheduleEntries.find((candidate) => candidate.entry.meetingId === meeting.id);
      return [
        `- unitId: ${meeting.unitId || '-'}`,
        `  meetingId: ${meeting.id || '-'}`,
        `  order: ${meeting.order ?? '-'}`,
        `  title: ${meeting.title || '-'}`,
        `  materialIds: ${listValue(meeting.materialIds)}`,
        `  linkedAtpItemIds: ${listValue(meeting.linkedAtpItemIds)}`,
        `  linkedTpIds: ${listValue(meeting.linkedTpIds)}`,
        `  date: ${scheduleMatch?.entry.date || '-'}`,
        `  jp: ${scheduleMatch?.entry.jp ?? '-'}`,
        `  scheduleStatus: ${scheduleMatch?.scheduleStatus || '-'}`,
      ];
    });

  const learningPlanLines = activePlans.length > 0
    ? activePlans.flatMap((plan) => [
        `- planId: ${plan.id || '-'}`,
        `  title: ${plan.title || '-'}`,
        `  unitId: ${plan.unitId || '-'}`,
        `  status: ${plan.status || '-'}`,
        `  sourceType: ${plan.sourceType || '-'}`,
        `  learningMeetingIds: ${listValue(plan.learningMeetingIds)}`,
        `  tpIds: ${listValue(plan.tpIds)}`,
        `  atpItemIds: ${listValue(plan.atpItemIds)}`,
        `  allocatedJP: ${plan.allocatedJP ?? '-'}`,
        `  learningExperiencesCount: ${plan.learningExperiences?.length || 0}`,
        `  assessmentInitialCount: ${countLearningPlanAssessments(plan, 'initial')}`,
        `  assessmentFormativeCount: ${countLearningPlanAssessments(plan, 'formative')}`,
        `  assessmentSummativeCount: ${countLearningPlanAssessments(plan, 'summative')}`,
      ])
    : ['- none'];

  const embeddedAssessmentLines = activePlans.length > 0
    ? activePlans.flatMap((plan) => [
        `- planId: ${plan.id || '-'}`,
        `  title: ${plan.title || '-'}`,
        `  initial: ${countLearningPlanAssessments(plan, 'initial')}`,
        `  formative: ${countLearningPlanAssessments(plan, 'formative')}`,
        `  summative: ${countLearningPlanAssessments(plan, 'summative')}`,
      ])
    : ['- none'];

  const aiInputLines = latestAIRequest
    ? [
        line('unitId', latestAIRequest.metadata?.unitId),
        line('TP sent', latestAIRequest.metadata?.tpCount),
        line('ATP sent', latestAIRequest.metadata?.atpCount),
        line('LearningMeeting IDs in scope', latestAIRequest.metadata?.learningMeetingCount),
        line('Allocated JP sent', latestAIRequest.metadata?.allocatedJP),
        line('Meeting structure sent to AI', latestAIRequest.metadata?.meetingStructureSent),
        line('KKTP sent to AI', latestAIRequest.metadata?.kktpSent),
      ]
    : ['- no request recorded'];

  const canonicalAssessmentPlans = (data.assessmentPlans || []).length > 0
    ? (data.assessmentPlans || []).flatMap((plan) => [
        `- id: ${plan.id || '-'}`,
        `  title: ${plan.title || '-'}`,
        `  purpose: ${plan.purpose || '-'}`,
        `  timing: ${plan.timing || '-'}`,
        `  scopeType: ${plan.scopeType || '-'}`,
        `  tpIds: ${listValue(plan.tpIds)}`,
        `  learningPlanIds: ${listValue(plan.learningPlanIds)}`,
        `  workflowStatus: ${plan.workflowStatus || '-'}`,
        `  linkedToLearningPlan: ${activePlans.some((learningPlan) => plan.learningPlanIds?.includes(learningPlan.id))}`,
      ])
    : ['- none'];

  return [
    'ADMINISTRASI GURU AI - LEARNING PLAN DIAGNOSTIC REPORT',
    '',
    'Build:',
    APP_BUILD_ID,
    '',
    'GeneratedAt:',
    new Date().toISOString(),
    '',
    'Context:',
    line('workspaceId', data.workspaceId),
    line('academicSettingId', setting?.id),
    line('curriculumType', setting?.curriculumType),
    line('academicYear', setting?.academicYear),
    line('semester', setting?.semester),
    line('level', setting?.level),
    line('grade', setting?.grade),
    line('phase', setting?.phase),
    line('phaseNormalized', normalizePhaseCode(setting?.phase)),
    line('subject', setting?.subject),
    '',
    'GATE:',
    line('learningPlanGate', data.learningPlanGate || '-'),
    line('learningPlanGateReason', data.learningPlanGateReason || '-'),
    '',
    'TP SOURCE:',
    line('id', data.tp?.id),
    line('workflowStatus', data.tp?.workflowStatus),
    line('generatedBy', data.tp?.generatedBy),
    line('generationEngine', data.tp?.generationEngine),
    line('itemsCount', data.tp?.items?.length || 0),
    '',
    'TP ITEMS:',
    ...formatTPItems(data.tp),
    '',
    'ATP:',
    line('workflowStatus', data.atp?.workflowStatus),
    line('itemsCount', data.atp?.items?.length || 0),
    '',
    'ATP ITEMS:',
    ...formatATPItems(data.atp),
    '',
    'CANONICAL LEARNING SCOPES:',
    ...canonicalScopes,
    '',
    'MEETINGS:',
    ...(meetings.length > 0 ? meetings : ['- none']),
    '',
    'LEARNING PLANS:',
    ...learningPlanLines,
    '',
    'AI INPUT:',
    ...aiInputLines,
    '',
    'EMBEDDED ASSESSMENT:',
    ...embeddedAssessmentLines,
    '',
    'CANONICAL ASSESSMENT PLANS:',
    ...canonicalAssessmentPlans,
    '',
    'Recent LEARNING_PLAN Events:',
    ...formatEvents('LEARNING_PLAN'),
  ].join('\n');
}

function countByStatus<T extends { status?: string; workflowStatus?: string; needsReview?: boolean }>(
  items: T[] = [],
  field: 'status' | 'workflowStatus' = 'workflowStatus'
): string[] {
  const siap = items.filter((item) => item[field] === 'SIAP').length;
  const draft = items.filter((item) => item[field] === 'DRAFT').length;
  const perlu = items.filter((item) => item[field] === 'PERLU_DILENGKAPI').length;
  const review = items.filter((item) => item.needsReview).length;
  return [
    line('count', items.length),
    line('SIAP count', siap),
    line('DRAFT count', draft),
    line('PERLU_DILENGKAPI count', perlu),
    line('needsReview count', review),
  ];
}

function gate(value: boolean | 'NOT_EVALUATED'): 'ALLOWED' | 'BLOCKED' | 'NOT_EVALUATED' {
  if (value === 'NOT_EVALUATED') return 'NOT_EVALUATED';
  return value ? 'ALLOWED' : 'BLOCKED';
}

export function buildAdministrationChainDiagnosticReport(data: {
  workspaceId?: string;
  academicSetting?: AcademicSetting | null;
  context?: Partial<ActiveContext> | null;
  tp?: TPData | null;
  tpRuntimeStatus?: string;
  atp?: ATPData | null;
  atpRuntimeStatus?: string;
  learningPlans?: LearningPlan[];
  assessmentCriteria?: AssessmentCriterion[];
  assessmentPlans?: AssessmentPlan[];
  assessmentPackages?: AssessmentPackage[];
}): string {
  const setting = data.academicSetting;
  const tpStoredReady = data.tp?.workflowStatus === 'SIAP' && data.tp.needsReview !== true;
  const atpStoredReady = data.atp?.workflowStatus === 'SIAP' && data.atp.needsReview !== true;
  const kktpReady = (data.assessmentCriteria || []).length > 0 &&
    (data.assessmentCriteria || []).every((c) => c.workflowStatus === 'SIAP' && c.needsReview !== true);
  const assessmentPlanReady = (data.assessmentPlans || []).some((p) => p.workflowStatus === 'SIAP' && p.needsReview !== true);
  return [
    'ADMINISTRASI GURU AI - CHAIN DIAGNOSTIC REPORT',
    '',
    'Build:',
    APP_BUILD_ID,
    '',
    'GeneratedAt:',
    new Date().toISOString(),
    '',
    'Context:',
    line('workspaceId', data.workspaceId),
    line('academicSettingId', setting?.id),
    line('curriculumType', setting?.curriculumType || data.context?.curriculumType),
    line('academicYear', setting?.academicYear || data.context?.academicYear),
    line('semester', setting?.semester || data.context?.semester),
    line('level', setting?.level || data.context?.level),
    line('grade', setting?.grade || data.context?.grade),
    line('phase', setting?.phase || data.context?.phase),
    line('phaseNormalized', normalizePhaseCode(setting?.phase || data.context?.phase)),
    line('subject', setting?.subject || data.context?.subject),
    '',
    'TP:',
    line('id', data.tp?.id),
    line('itemsCount', data.tp?.items?.length || 0),
    line('workflowStatus', data.tp?.workflowStatus),
    line('runtimeStatus', data.tpRuntimeStatus || 'NOT_EVALUATED'),
    line('needsReview', data.tp?.needsReview || false),
    line('updatedAt', data.tp?.updatedAt),
    line('basedOnCpUpdatedAt', data.tp?.basedOnCpUpdatedAt),
    line('basedOnAnalysisUpdatedAt', data.tp?.basedOnAnalysisUpdatedAt),
    '',
    'ATP:',
    line('id', data.atp?.id),
    line('itemsCount', data.atp?.items?.length || 0),
    line('workflowStatus', data.atp?.workflowStatus),
    line('runtimeStatus', data.atpRuntimeStatus || 'NOT_EVALUATED'),
    line('needsReview', data.atp?.needsReview || false),
    line('basedOnTpUpdatedAt', data.atp?.basedOnTpUpdatedAt),
    line('tpTimestampMatch', data.atp?.basedOnTpUpdatedAt && data.tp?.updatedAt ? data.atp.basedOnTpUpdatedAt === data.tp.updatedAt : 'NOT_EVALUATED'),
    '',
    'LearningPlan:',
    ...countByStatus(data.learningPlans || [], 'status'),
    '',
    'KKTP:',
    ...countByStatus(data.assessmentCriteria || [], 'workflowStatus'),
    '',
    'AssessmentPlan:',
    ...countByStatus(data.assessmentPlans || [], 'workflowStatus'),
    '',
    'AssessmentPackage:',
    ...countByStatus(data.assessmentPackages || [], 'workflowStatus'),
    '',
    'Gates:',
    line('TP_RUNTIME_READY', data.tpRuntimeStatus ? data.tpRuntimeStatus === 'SIAP' : 'NOT_EVALUATED'),
    line('TP_STORED_READY', gate(tpStoredReady)),
    line('ATP_RUNTIME_READY', data.atpRuntimeStatus ? data.atpRuntimeStatus === 'SIAP' : 'NOT_EVALUATED'),
    line('ATP_STORED_READY', data.atp ? gate(atpStoredReady) : 'NOT_EVALUATED'),
    line('TP_TO_ATP', gate(tpStoredReady)),
    line('TP_ATP_TO_LEARNING_PLAN', gate(tpStoredReady && ((data.atp?.items?.length || 0) === 0 || atpStoredReady))),
    line('TP_TO_KKTP', gate(tpStoredReady)),
    line('TP_KKTP_TO_ASSESSMENT_PLAN', gate(tpStoredReady && kktpReady)),
    line('ASSESSMENT_PLAN_TO_PACKAGE', gate(assessmentPlanReady)),
    '',
    'Recent Events:',
    ...getRecentDiagnosticEvents().slice(-10).map((event) => `- ${event.timestamp} ${event.scope}.${event.action}${event.status ? ` status=${event.status}` : ''}`),
  ].join('\n');
}

export function buildUnitExecutionPlanAIDiagnosticReport(data: {
  mapping?: ATPUnitMappingData | null;
  unitExecutionPlan?: UnitExecutionPlanData | null;
  capacityContext?: {
    semester1LastUnitId?: string | null;
    semester1?: { targetMeetingCount: number; totalJP?: number };
    semester2?: { targetMeetingCount: number; totalJP?: number };
  } | null;
  validation?: UnitExecutionPlanValidationResult | null;
  lastAIDiagnostic?: AIMeetingDiagnostic | null;
  lastAIGenerationError?: string | null;
}): string {
  const mapping = data.mapping;
  const plan = data.unitExecutionPlan;
  const diag = data.lastAIDiagnostic;
  const val = data.validation;

  // Semester boundary resolution
  const s1Last = diag?.semester1LastUnitId !== undefined
    ? diag.semester1LastUnitId
    : (data.capacityContext?.semester1LastUnitId !== undefined
        ? data.capacityContext.semester1LastUnitId
        : (plan?.semesterPlacement?.semester1LastUnitId ?? null));

  let s1UnitIds = diag?.semester1UnitIds || [];
  let s2UnitIds = diag?.semester2UnitIds || [];

  if (!diag && mapping && plan) {
     const placementValidation = resolveUnitSemesterPlacement(plan, mapping);
     s1UnitIds = placementValidation.semester1UnitIds || [];
     s2UnitIds = placementValidation.semester2UnitIds || [];
  }

  // Capacity calculations
  const capS1Target = data.capacityContext?.semester1?.targetMeetingCount ?? 0;
  const capS2Target = data.capacityContext?.semester2?.targetMeetingCount ?? 0;

  const capS1Existing = s1UnitIds.flatMap(id => (plan?.units?.find(u => u.unitId === id)?.meetings || [])).length;
  const capS2Existing = s2UnitIds.flatMap(id => (plan?.units?.find(u => u.unitId === id)?.meetings || [])).length;

  const capS1 = diag?.capacity?.semester1 || {
    target: capS1Target,
    existing: capS1Existing,
    requestedNew: Math.max(0, capS1Target - capS1Existing),
  };
  const capS2 = diag?.capacity?.semester2 || {
    target: capS2Target,
    existing: capS2Existing,
    requestedNew: Math.max(0, capS2Target - capS2Existing),
  };

  // Current plan meeting count per unit
  const currentUnitCounts = (mapping?.units || []).map((u) => {
    const uPlan = plan?.units?.find((p) => p.unitId === u.id);
    const count = (uPlan?.meetings || []).length;
    return `- ${u.id} ("${u.title}"): ${count} meetings`;
  });

  // Current Validation errors & missing coverage
  const valErrors = val?.errors?.length
    ? val.errors.map((e) => `- ${e}`)
    : ['- none'];

  const valMissingCov = (val?.coverage || [])
    .filter((c) => c.missingMaterialIds.length > 0 || c.missingAtpItemIds.length > 0 || c.missingTpIds.length > 0)
    .map((c) => `- Unit ${c.unitId}: Materials=[${c.missingMaterialIds.join(', ')}], ATP=[${c.missingAtpItemIds.join(', ')}], TP=[${c.missingTpIds.join(', ')}]`);

  // Suggestions listing from diag
  const suggestionsList: string[] = [];
  if (diag?.perUnit && diag.perUnit.length > 0) {
    for (const pu of diag.perUnit) {
      if (pu.suggestions && pu.suggestions.length > 0) {
        for (const s of pu.suggestions) {
          suggestionsList.push(
            `- Unit ${pu.unitId} | #${s.suggestionIndex} "${s.title}" | Materials=[${s.materialIds.join(', ')}] | ATP=[${s.linkedAtpItemIds.join(', ')}] | TP=[${s.linkedTpIds.join(', ')}]`
          );
        }
      }
    }
  }

  // Missing coverage from diag
  const diagMissingCov = (diag?.missingCoverage || []).map(
    (mc) => `- Unit ${mc.unitId}: Materials=[${mc.materialIds.join(', ')}], ATP=[${mc.atpItemIds.join(', ')}], TP=[${mc.tpIds.join(', ')}]`
  );

  return [
    'ADMINISTRASI GURU AI - MEETING AI DIAGNOSTIC',
    '',
    'Build:',
    APP_BUILD_ID,
    '',
    'GeneratedAt:',
    new Date().toISOString(),
    '',
    'Mapping:',
    line('mappingId', mapping?.id),
    line('mappingUpdatedAt', mapping?.updatedAt),
    line('unitExecutionPlanId', plan?.id),
    line('basedOnMappingUpdatedAt', plan?.basedOnMappingUpdatedAt),
    '',
    'Capacity:',
    `S1 target=${capS1.target} existing=${capS1.existing} requestedNew=${capS1.requestedNew}`,
    `S2 target=${capS2.target} existing=${capS2.existing} requestedNew=${capS2.requestedNew}`,
    '',
    'Semester Boundary:',
    line('semester1LastUnitId', s1Last === null ? 'null (all S2)' : s1Last),
    line('S1 Unit IDs', s1UnitIds.length > 0 ? s1UnitIds.join(', ') : '-'),
    line('S2 Unit IDs', s2UnitIds.length > 0 ? s2UnitIds.join(', ') : '-'),
    '',
    'Current Plan:',
    ...(currentUnitCounts.length > 0 ? currentUnitCounts : ['- none']),
    '',
    'Current Validation:',
    line('isValid', val ? val.isValid : '-'),
    line('isComplete', val ? val.isComplete : '-'),
    line('isStale', val ? val.isStale : '-'),
    'Errors:',
    ...valErrors,
    'Missing Coverage:',
    ...(valMissingCov.length > 0 ? valMissingCov : ['- none']),
    '',
    'Last AI Attempt:',
    line('code', diag?.code || (data.lastAIGenerationError ? 'AI_GENERATION_ERROR' : '-')),
    line('stage', diag?.stage || '-'),
    line('error', data.lastAIGenerationError || '-'),
    '',
    'Generated:',
    line('S1', diag?.generated?.semester1 ?? '-'),
    line('S2', diag?.generated?.semester2 ?? '-'),
    line('delta S1', diag?.generated?.deltaSemester1 !== undefined ? (diag.generated.deltaSemester1 >= 0 ? `+${diag.generated.deltaSemester1}` : String(diag.generated.deltaSemester1)) : '-'),
    line('delta S2', diag?.generated?.deltaSemester2 !== undefined ? (diag.generated.deltaSemester2 >= 0 ? `+${diag.generated.deltaSemester2}` : String(diag.generated.deltaSemester2)) : '-'),
    '',
    'AI Result Per Unit:',
    ...(diag?.perUnit && diag.perUnit.length > 0
      ? diag.perUnit.map((pu) => {
          const targetPart = pu.targetNewCount !== undefined ? ` | targetNew=${pu.targetNewCount}` : '';
          const deltaStr = pu.delta !== undefined ? (pu.delta >= 0 ? `+${pu.delta}` : String(pu.delta)) : '';
          const deltaPart = deltaStr ? ` | delta=${deltaStr}` : '';
          return `- Unit ${pu.unitId} | S${pu.semester} | existing=${pu.existingCount}${targetPart} | generated=${pu.generatedCount}${deltaPart}`;
        })
      : ['- none']),
    '',
    'Suggestions:',
    ...(suggestionsList.length > 0 ? suggestionsList : ['- none']),
    '',
    'Invalid Reference:',
    line('field', diag?.issue?.field || '-'),
    line('invalidId', diag?.issue?.invalidId || '-'),
    line('unitId', diag?.issue?.unitId || '-'),
    line('suggestionIndex', diag?.issue?.suggestionIndex ?? '-'),
    '',
    'Missing Coverage (AI Result):',
    ...(diagMissingCov.length > 0 ? diagMissingCov : ['- none']),
    '',
    'Recent UNIT_EXECUTION_PLAN events:',
    ...formatEvents('UNIT_EXECUTION_PLAN'),
  ].join('\n');
}

export function buildUnitSemesterPlanningDiagnosticReport(data: {
  mapping: ATPUnitMappingData;
  unitExecutionPlan: UnitExecutionPlanData;
  validation: UnitSemesterPlacementValidation;
  s1AvailableJP: number | null;
  s2AvailableJP: number | null;
}): string {
  const { mapping, unitExecutionPlan, validation, s1AvailableJP, s2AvailableJP } = data;

  const mappingUnits = mapping.units || [];
  const planUnits = unitExecutionPlan.units || [];

  const mappingUnitLines = mappingUnits.map(
    (u) => `  - Order: ${u.order} | id: ${u.id} | title: "${u.title}" | ATP count: ${u.linkedAtpItemIds?.length || 0} | TP count: ${u.linkedTpIds?.length || 0} | material count: ${u.materials?.length || 0}`
  );

  const planUnitLines = planUnits.map((pu) => `  - unitId: ${pu.unitId}`);

  const missingInPlan = mappingUnits
    .filter((u) => !planUnits.some((pu) => pu.unitId === u.id))
    .map((u) => u.id);

  const orphanInPlan = planUnits
    .filter((pu) => !mappingUnits.some((u) => u.id === pu.unitId))
    .map((pu) => pu.unitId);

  const isStale = validation.isStale;

  const placement = unitExecutionPlan.semesterPlacement;
  const mode = placement?.mode ?? 'UNSET';
  const semester1LastUnitId =
    placement === undefined
      ? 'UNSET'
      : placement.semester1LastUnitId === null
      ? 'null (all S2)'
      : placement.semester1LastUnitId;

  return [
    'ADMINISTRASI GURU AI - UNIT SEMESTER PLANNING DIAGNOSTIC',
    '',
    `Build ID: ${APP_BUILD_ID}`,
    `Generated At: ${new Date().toISOString()}`,
    '',
    'MAPPING',
    `- mappingId: ${mapping.id || '-'}`,
    `- mappingUpdatedAt: ${mapping.updatedAt || '-'}`,
    `- unitsCount: ${mappingUnits.length}`,
    ...mappingUnitLines,
    '',
    'UNIT EXECUTION PLAN',
    `- planId: ${unitExecutionPlan.id || '-'}`,
    `- planUpdatedAt: ${unitExecutionPlan.updatedAt || '-'}`,
    `- basedOnMappingUpdatedAt: ${unitExecutionPlan.basedOnMappingUpdatedAt || '-'}`,
    `- unitsCount: ${planUnits.length}`,
    ...planUnitLines,
    `- stale: ${isStale}`,
    '',
    'MAPPING ↔ PLAN CONSISTENCY',
    `- mappingUnitIds: ${mappingUnits.map((u) => u.id).join(', ') || '-'}`,
    `- planUnitIds: ${planUnits.map((pu) => pu.unitId).join(', ') || '-'}`,
    `- missingInPlan: ${missingInPlan.join(', ') || '- none'}`,
    `- orphanInPlan: ${orphanInPlan.join(', ') || '- none'}`,
    `- countMismatch: ${mappingUnits.length !== planUnits.length}`,
    '',
    'SEMESTER PLACEMENT',
    `- mode: ${mode}`,
    `- semester1LastUnitId: ${semester1LastUnitId === null ? 'null (all S2)' : (semester1LastUnitId || '-')}`,
    `- valid: ${validation.isValid}`,
    `- complete: ${validation.isComplete}`,
    `- stale: ${validation.isStale}`,
    `- errors: ${validation.errors.join(', ') || '- none'}`,
    `- warnings: ${validation.warnings.join(', ') || '- none'}`,
    '',
    'RESOLVED PLACEMENT',
    `- semester1UnitIds: ${validation.semester1UnitIds.join(', ') || '-'} (count: ${validation.semester1UnitIds.length})`,
    `- semester2UnitIds: ${validation.semester2UnitIds.join(', ') || '-'} (count: ${validation.semester2UnitIds.length})`,
    `- totalResolved: ${validation.resolvedUnits?.length || 0}`,
    `- mappingUnitsCount: ${mappingUnits.length}`,
    '',
    'CAPACITY',
    `- s1AvailableJP: ${s1AvailableJP === null ? '-' : s1AvailableJP}`,
    `- s2AvailableJP: ${s2AvailableJP === null ? '-' : s2AvailableJP}`,
  ].join('\n');
}
