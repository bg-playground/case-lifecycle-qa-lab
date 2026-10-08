/**
 * Types for the handwritten case-type definition (apps/claim/case-type.yaml)
 * and for the mock DX API v2 payloads.
 *
 * The response shapes follow the top-level structure that Pega's public
 * Academy material describes for the Constellation DX API (data,
 * uiResources, nextAssignmentInfo, confirmationNote; eTag / if-match).
 * Inner field names are this repo's own approximation, written from scratch.
 */

export type StepType = 'assignment' | 'automated' | 'optional' | 'decision';

export interface StepDefinition {
  id: string;
  label: string;
  type: StepType;
  form?: string;
  sla?: string;
  rule?: string;
}

export interface StageDefinition {
  id: string;
  label: string;
  kind: 'primary' | 'alternate';
  steps?: StepDefinition[];
  resolutionStatuses?: string[];
}

export interface FieldDefinition {
  type: 'text' | 'email' | 'phone' | 'date' | 'currency' | 'boolean';
  required?: boolean;
  pattern?: string;
  enum?: Array<string | boolean>;
}

export interface FormFieldDefinition {
  field: string;
  label: string;
  testId: string;
}

export interface SlaDefinition {
  goal: string;
  deadline: string;
}

export interface PolicyRecord {
  policyNumber: string;
  coverage: string;
  deductible: number;
  status: 'Active' | 'Lapsed';
}

export interface CaseTypeFile {
  caseType: { id: string; name: string; idPrefix: string; firstId: number };
  stages: StageDefinition[];
  dataObjects: Record<string, { fields: Record<string, FieldDefinition> }>;
  forms: Record<string, FormFieldDefinition[]>;
  slas: Record<string, SlaDefinition>;
  referenceData: { policies: PolicyRecord[] };
}

/** A step that a person works on, with its owning stage. */
export interface AssignmentStep {
  stage: StageDefinition;
  step: StepDefinition;
  /** Automated steps that run after this assignment is submitted, before the next one. */
  automatedAfter: StepDefinition[];
}

export type CaseContent = Record<string, string | boolean | number>;

export interface FieldError {
  field: string;
  message: string;
}

export interface StageView {
  ID: string;
  name: string;
  visited_status: 'completed' | 'active' | 'future';
}

export interface ActionView {
  ID: string;
  name: string;
  type: 'FlowAction';
}

export interface AssignmentView {
  ID: string;
  name: string;
  actions: ActionView[];
  sla: { goal: string; deadline: string } | null;
}

export interface CaseInfo {
  ID: string;
  businessID: string;
  caseTypeID: string;
  caseTypeName: string;
  status: string;
  stageID: string;
  stageLabel: string;
  stages: StageView[];
  assignments: AssignmentView[];
  lastUpdateTime: string;
  content: CaseContent;
}

export interface UiForm {
  name: string;
  fields: Array<
    FormFieldDefinition & {
      key: string;
      required: boolean;
      inputType: FieldDefinition['type'];
      options?: Array<string | boolean>;
    }
  >;
}

export interface DxResponse {
  data: { caseInfo: CaseInfo };
  uiResources: { form: UiForm | null };
  nextAssignmentInfo?: { ID: string; context: 'self' };
  confirmationNote?: string;
}

export interface DxError {
  errorClassification: string;
  localizedValue: string;
  errorDetails: Array<{ message: string; field?: string }>;
}
