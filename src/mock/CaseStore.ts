import { CaseTypeDefinition } from './CaseTypeDefinition.js';
import { Duration } from './Duration.js';
import type {
  AssignmentStep,
  AssignmentView,
  CaseContent,
  CaseInfo,
  DxResponse,
  FieldError,
  StageView,
} from './types.js';

/** One case held in memory by the mock. */
interface CaseRecord {
  id: string;
  businessId: string;
  content: CaseContent;
  /** Index into CaseTypeDefinition.primaryAssignments(); -1 once resolved. */
  assignmentIndex: number;
  assignmentStartedAt: Date;
  status: string;
  saveDateTime: Date;
}

export type StoreResult =
  | { ok: true; status: 200 | 201; eTag: string; body: DxResponse }
  | { ok: false; status: 404 | 409 | 422 | 428; message: string; classification: string; errors?: FieldError[] };

/**
 * In-memory case store with the mock's lifecycle rules.
 *
 * Optimistic locking: every save stamps the case with a new save time, which
 * is returned as the eTag. Updates must send it back as If-Match; a stale
 * value returns 409 Conflict and a missing value returns 428.
 */
export class CaseStore {
  private static readonly cases = new Map<string, CaseRecord>();
  private static nextNumber = CaseTypeDefinition.load().caseType.firstId;
  private static lastSave = 0;

  static createCase(caseTypeID: string, content: CaseContent = {}): StoreResult {
    const def = CaseTypeDefinition.load().caseType;
    if (caseTypeID !== def.id) {
      return CaseStore.fail(404, 'NotFound', `Unknown caseTypeID ${caseTypeID}`);
    }
    const businessId = `${def.idPrefix}${CaseStore.nextNumber++}`;
    const record: CaseRecord = {
      id: `${def.id.toUpperCase()} ${businessId}`,
      businessId,
      content: { ...content },
      assignmentIndex: 0,
      assignmentStartedAt: new Date(),
      status: 'New',
      saveDateTime: CaseStore.stamp(),
    };
    CaseStore.cases.set(record.id, record);
    return CaseStore.ok(201, record, true);
  }

  static getCase(caseID: string): StoreResult {
    const record = CaseStore.cases.get(caseID);
    return record ? CaseStore.ok(200, record, false) : CaseStore.fail(404, 'NotFound', `No case ${caseID}`);
  }

  static getAssignment(assignmentID: string): StoreResult {
    const found = CaseStore.findAssignment(assignmentID);
    return found ? CaseStore.ok(200, found.record, false) : CaseStore.fail(404, 'NotFound', `No open assignment ${assignmentID}`);
  }

  /** Save without advancing (PATCH .../actions/{actionID}/save). */
  static saveAssignment(assignmentID: string, actionID: string, ifMatch: string | undefined, content: CaseContent): StoreResult {
    const checked = CaseStore.checkUpdate(assignmentID, actionID, ifMatch);
    if (!checked.ok) return checked;
    const { record } = checked;
    Object.assign(record.content, content);
    record.saveDateTime = CaseStore.stamp();
    return CaseStore.ok(200, record, true);
  }

  /** Submit (PATCH .../actions/{actionID}): validate, run automated steps, advance. */
  static submitAssignment(assignmentID: string, actionID: string, ifMatch: string | undefined, content: CaseContent): StoreResult {
    const checked = CaseStore.checkUpdate(assignmentID, actionID, ifMatch);
    if (!checked.ok) return checked;
    const { record, step } = checked;
    const merged = { ...record.content, ...content };

    const errors = [...CaseStore.validate(step, merged), ...CaseStore.runAutomated(step, merged)];
    if (errors.length) return { ...CaseStore.fail(422, 'Validation fail', 'Validation failed'), errors };

    record.content = merged;
    const steps = CaseTypeDefinition.primaryAssignments();
    if (record.assignmentIndex + 1 < steps.length) {
      record.assignmentIndex += 1;
      record.status = 'Open';
    } else {
      record.assignmentIndex = -1;
      record.status = CaseTypeDefinition.resolutionStage().resolutionStatuses?.[0] ?? 'Resolved-Completed';
    }
    record.assignmentStartedAt = new Date();
    record.saveDateTime = CaseStore.stamp();
    return CaseStore.ok(200, record, true);
  }

  /** eTag format mirrors a save timestamp, e.g. "20261008T185600.123 GMT". Strictly increasing. */
  static eTagOf(record: { saveDateTime: Date }): string {
    const iso = record.saveDateTime.toISOString();
    return `"${iso.slice(0, 19).replace(/[-:]/g, '')}.${iso.slice(20, 23)} GMT"`;
  }

  private static checkUpdate(assignmentID: string, actionID: string, ifMatch: string | undefined):
    | { ok: true; record: CaseRecord; step: AssignmentStep }
    | Extract<StoreResult, { ok: false }> {
    const found = CaseStore.findAssignment(assignmentID);
    if (!found) return CaseStore.fail(404, 'NotFound', `No open assignment ${assignmentID}`);
    if (found.step.step.id !== actionID) return CaseStore.fail(404, 'NotFound', `Action ${actionID} is not available on ${assignmentID}`);
    if (!ifMatch) return CaseStore.fail(428, 'Precondition required', 'The If-Match header is required for updates.');
    if (CaseStore.normalizeTag(ifMatch) !== CaseStore.normalizeTag(CaseStore.eTagOf(found.record))) {
      return CaseStore.fail(409, 'Conflict', 'The case was updated by someone else. Refresh and try again.');
    }
    return { ok: true, record: found.record, step: found.step };
  }

  private static findAssignment(assignmentID: string): { record: CaseRecord; step: AssignmentStep } | null {
    for (const record of CaseStore.cases.values()) {
      const step = CaseStore.currentStep(record);
      if (step && CaseStore.assignmentId(record, step) === assignmentID) return { record, step };
    }
    return null;
  }

  private static currentStep(record: CaseRecord): AssignmentStep | null {
    return record.assignmentIndex < 0 ? null : CaseTypeDefinition.primaryAssignments()[record.assignmentIndex] ?? null;
  }

  private static assignmentId(record: CaseRecord, step: AssignmentStep): string {
    return `ASSIGN-WORKLIST ${record.id}!${step.step.id.toUpperCase()}`;
  }

  private static validate(step: AssignmentStep, content: CaseContent): FieldError[] {
    const form = CaseTypeDefinition.form(step.step.form);
    const errors: FieldError[] = [];
    for (const f of form?.fields ?? []) {
      const def = CaseTypeDefinition.field(f.field);
      const raw = content[f.key];
      const value = typeof raw === 'string' ? raw.trim() : raw;
      if (value === undefined || value === '') {
        if (def.required) errors.push({ field: f.key, message: `${f.label} is required.` });
        continue;
      }
      if (def.pattern && !new RegExp(def.pattern).test(String(value))) {
        errors.push({ field: f.key, message: `${f.label} has an invalid format.` });
      } else if (def.type === 'email' && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(value))) {
        errors.push({ field: f.key, message: `${f.label} must be an email address.` });
      } else if (def.type === 'date' && Number.isNaN(Date.parse(String(value)))) {
        errors.push({ field: f.key, message: `${f.label} must be a date.` });
      }
    }
    return errors;
  }

  /** Automated steps that follow the submitted assignment. Only policyMustBeActive exists today. */
  private static runAutomated(step: AssignmentStep, content: CaseContent): FieldError[] {
    const errors: FieldError[] = [];
    for (const auto of step.automatedAfter) {
      if (auto.rule === 'policyMustBeActive' && content.policyNumber) {
        const policy = CaseTypeDefinition.load().referenceData.policies.find((p) => p.policyNumber === content.policyNumber);
        if (!policy) errors.push({ field: 'policyNumber', message: 'Policy not found.' });
        else if (policy.status !== 'Active') errors.push({ field: 'policyNumber', message: `Policy is ${policy.status}.` });
      }
    }
    return errors;
  }

  private static toCaseInfo(record: CaseRecord): CaseInfo {
    const step = CaseStore.currentStep(record);
    const stage = step?.stage ?? CaseTypeDefinition.resolutionStage();
    const primary = CaseTypeDefinition.primaryStages();
    const activeIdx = primary.findIndex((s) => s.id === stage.id);
    const stages: StageView[] = primary.map((s, i) => ({
      ID: s.id,
      name: s.label,
      visited_status: i < activeIdx ? 'completed' : i === activeIdx ? 'active' : 'future',
    }));
    const assignments: AssignmentView[] = step
      ? [{
          ID: CaseStore.assignmentId(record, step),
          name: step.step.label,
          actions: [{ ID: step.step.id, name: step.step.label, type: 'FlowAction' }],
          sla: CaseStore.slaFor(step, record.assignmentStartedAt),
        }]
      : [];
    const def = CaseTypeDefinition.load().caseType;
    return {
      ID: record.id,
      businessID: record.businessId,
      caseTypeID: def.id,
      caseTypeName: def.name,
      status: record.status,
      stageID: stage.id,
      stageLabel: stage.label,
      stages,
      assignments,
      lastUpdateTime: record.saveDateTime.toISOString(),
      content: { ...record.content },
    };
  }

  private static slaFor(step: AssignmentStep, startedAt: Date): AssignmentView['sla'] {
    const sla = CaseTypeDefinition.sla(step.step.sla);
    return sla ? { goal: Duration.addTo(startedAt, sla.goal), deadline: Duration.addTo(startedAt, sla.deadline) } : null;
  }

  private static ok(status: 200 | 201, record: CaseRecord, includeNext: boolean): StoreResult {
    const step = CaseStore.currentStep(record);
    const body: DxResponse = {
      data: { caseInfo: CaseStore.toCaseInfo(record) },
      uiResources: { form: CaseTypeDefinition.form(step?.step.form) },
    };
    if (includeNext && step) body.nextAssignmentInfo = { ID: CaseStore.assignmentId(record, step), context: 'self' };
    if (!step) body.confirmationNote = `Thank you. Claim ${record.businessId} is ${record.status}.`;
    return { ok: true, status, eTag: CaseStore.eTagOf(record), body };
  }

  private static fail(status: 404 | 409 | 422 | 428, classification: string, message: string): Extract<StoreResult, { ok: false }> {
    return { ok: false, status, classification, message };
  }

  private static normalizeTag(tag: string): string {
    return tag.trim().replace(/^W\//, '').replace(/^"|"$/g, '');
  }

  private static stamp(): Date {
    CaseStore.lastSave = Math.max(Date.now(), CaseStore.lastSave + 1);
    return new Date(CaseStore.lastSave);
  }
}
