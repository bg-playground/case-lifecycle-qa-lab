import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import type {
  AssignmentStep,
  CaseTypeFile,
  FieldDefinition,
  SlaDefinition,
  StageDefinition,
  UiForm,
} from './types.js';

const DEFAULT_PATH = fileURLToPath(new URL('../../apps/claim/case-type.yaml', import.meta.url));

/** Loads the handwritten case-type YAML and answers lifecycle questions about it. */
export class CaseTypeDefinition {
  private static cached: CaseTypeFile | null = null;

  static load(path: string = DEFAULT_PATH): CaseTypeFile {
    if (!CaseTypeDefinition.cached) {
      CaseTypeDefinition.cached = parse(readFileSync(path, 'utf8')) as CaseTypeFile;
    }
    return CaseTypeDefinition.cached;
  }

  static primaryStages(): StageDefinition[] {
    return CaseTypeDefinition.load().stages.filter((s) => s.kind === 'primary');
  }

  /**
   * The primary path as an ordered list of assignments. Automated steps are
   * attached to the assignment they follow. Decision and optional steps are
   * skipped in this slice (routing is not executed yet).
   */
  static primaryAssignments(): AssignmentStep[] {
    const out: AssignmentStep[] = [];
    for (const stage of CaseTypeDefinition.primaryStages()) {
      for (const step of stage.steps ?? []) {
        if (step.type === 'assignment') {
          out.push({ stage, step, automatedAfter: [] });
        } else if (step.type === 'automated') {
          out.at(-1)?.automatedAfter.push(step);
        }
      }
    }
    return out;
  }

  static resolutionStage(): StageDefinition {
    const stage = CaseTypeDefinition.primaryStages().find((s) => s.resolutionStatuses?.length);
    if (!stage) throw new Error('case-type.yaml has no resolution stage');
    return stage;
  }

  static sla(name: string | undefined): SlaDefinition | null {
    return name ? CaseTypeDefinition.load().slas[name] ?? null : null;
  }

  /** Looks up "Object.field" in dataObjects. */
  static field(path: string): FieldDefinition {
    const [object, field] = path.split('.');
    const def = object && field ? CaseTypeDefinition.load().dataObjects[object]?.fields[field] : undefined;
    if (!def) throw new Error(`Unknown field ${path} in case-type.yaml`);
    return def;
  }

  static form(name: string | undefined): UiForm | null {
    if (!name) return null;
    const fields = CaseTypeDefinition.load().forms[name];
    if (!fields) throw new Error(`Unknown form ${name} in case-type.yaml`);
    return {
      name,
      fields: fields.map((f) => {
        const def = CaseTypeDefinition.field(f.field);
        return {
          ...f,
          key: f.field.split('.')[1] ?? f.field,
          required: def.required === true,
          inputType: def.type,
          ...(def.enum ? { options: def.enum } : {}),
        };
      }),
    };
  }
}
