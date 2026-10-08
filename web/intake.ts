/**
 * Intake screen for the mock Auto Insurance Claim. Written from scratch.
 * Talks to the mock DX API v2 on the same origin.
 */

const API = '/prweb/api/application/v2';
const CASE_TYPE_ID = 'Synthetic-Claims-Work-AutoClaim';

interface FormField {
  key: string;
  label: string;
  testId: string;
  required: boolean;
  inputType: 'text' | 'email' | 'phone' | 'date' | 'currency' | 'boolean';
  options?: Array<string | boolean>;
}

interface CaseInfo {
  ID: string;
  businessID: string;
  status: string;
  stageLabel: string;
  stages: Array<{ ID: string; name: string; visited_status: 'completed' | 'active' | 'future' }>;
  assignments: Array<{ ID: string; name: string; actions: Array<{ ID: string }>; sla: { goal: string; deadline: string } | null }>;
  content: Record<string, string | boolean | number>;
}

interface DxResponse {
  data: { caseInfo: CaseInfo };
  uiResources: { form: { name: string; fields: FormField[] } | null };
  confirmationNote?: string;
}

interface DxError {
  localizedValue: string;
  errorDetails: Array<{ message: string; field?: string }>;
}

class ApiClient {
  private static token = '';

  static async startSession(): Promise<void> {
    const res = await fetch('/mock-portal/session', { method: 'POST' });
    ApiClient.token = ((await res.json()) as { access_token: string }).access_token;
  }

  static async call(method: string, path: string, body?: unknown, ifMatch?: string): Promise<{ status: number; eTag: string; json: unknown }> {
    const headers: Record<string, string> = { Authorization: `Bearer ${ApiClient.token}`, 'Content-Type': 'application/json' };
    if (ifMatch) headers['If-Match'] = ifMatch;
    const res = await fetch(API + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, eTag: res.headers.get('ETag') ?? '', json: await res.json() };
  }
}

class IntakeScreen {
  private static eTag = '';
  private static current: CaseInfo | null = null;

  static async init(): Promise<void> {
    await ApiClient.startSession();
    const res = await ApiClient.call('POST', '/cases', { caseTypeID: CASE_TYPE_ID });
    if (res.status !== 201) return IntakeScreen.showErrors(res.json as DxError);
    IntakeScreen.render(res.json as DxResponse, res.eTag);
    IntakeScreen.el<HTMLFormElement>('form').addEventListener('submit', (e) => {
      e.preventDefault();
      void IntakeScreen.submit();
    });
  }

  static async submit(): Promise<void> {
    const assignment = IntakeScreen.current?.assignments[0];
    const action = assignment?.actions[0];
    if (!assignment || !action) return;
    const previousStage = IntakeScreen.current?.stageLabel;
    const path = `/assignments/${encodeURIComponent(assignment.ID)}/actions/${encodeURIComponent(action.ID)}`;
    const res = await ApiClient.call('PATCH', path, { content: IntakeScreen.readForm() }, IntakeScreen.eTag);
    if (res.status === 200) {
      const body = res.json as DxResponse;
      IntakeScreen.render(body, res.eTag);
      const info = body.data.caseInfo;
      IntakeScreen.status(
        body.confirmationNote ??
          (info.stageLabel !== previousStage
            ? `Claim ${info.businessID} moved to ${info.stageLabel}.`
            : `Claim ${info.businessID} saved.`),
      );
    } else {
      IntakeScreen.showErrors(res.json as DxError, res.status === 409);
    }
  }

  private static render(body: DxResponse, eTag: string): void {
    const info = body.data.caseInfo;
    IntakeScreen.current = info;
    IntakeScreen.eTag = eTag;
    IntakeScreen.hideErrors();
    IntakeScreen.el('[data-testid="caseId:text"]').textContent = `(${info.businessID})`;

    const list = IntakeScreen.el('[data-testid="caseStages:list"]');
    list.replaceChildren(
      ...info.stages.map((s) => {
        const li = document.createElement('li');
        li.textContent = s.name;
        li.dataset.testid = `${s.ID}:stage`;
        li.dataset.status = s.visited_status;
        if (s.visited_status === 'active') li.setAttribute('aria-current', 'step');
        return li;
      }),
    );

    const assignment = info.assignments[0];
    IntakeScreen.el('[data-testid="assignmentName:heading"]').textContent = assignment?.name ?? info.status;
    IntakeScreen.el('[data-testid="sla:text"]').textContent = assignment?.sla
      ? `Goal ${IntakeScreen.time(assignment.sla.goal)} · Deadline ${IntakeScreen.time(assignment.sla.deadline)}`
      : '';

    const fields = body.uiResources.form?.fields ?? [];
    IntakeScreen.el('[data-testid="fields:container"]').replaceChildren(...fields.map((f) => IntakeScreen.fieldFor(f, info.content[f.key])));
    IntakeScreen.el<HTMLButtonElement>('button[type="submit"]').hidden = !assignment;
  }

  /** Builds one labelled control. Test IDs follow the "<testId>:input" convention. */
  private static fieldFor(f: FormField, value: string | boolean | number | undefined): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = f.key === 'description' ? 'field field--wide' : 'field';
    const id = `field-${f.testId}`;
    const label = document.createElement('label');
    label.htmlFor = id;
    label.textContent = f.label;

    let control: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    if (f.options && f.inputType !== 'boolean') {
      const select = document.createElement('select');
      select.append(new Option('Select…', ''), ...f.options.map((o) => new Option(String(o), String(o))));
      control = select;
    } else if (f.key === 'description') {
      control = document.createElement('textarea');
      control.rows = 3;
    } else {
      const input = document.createElement('input');
      input.type = { text: 'text', email: 'email', phone: 'tel', date: 'date', currency: 'number', boolean: 'checkbox' }[f.inputType];
      if (f.inputType === 'boolean') input.checked = value === true;
      control = input;
    }
    if (f.inputType !== 'boolean' && value !== undefined) control.value = String(value);
    control.id = id;
    control.name = f.key;
    control.dataset.testid = `${f.testId}:input`;
    if (f.required) {
      control.required = true;
      control.setAttribute('aria-required', 'true');
    }

    const error = document.createElement('span');
    error.className = 'field__error';
    error.id = `${id}-error`;
    error.dataset.testid = `${f.testId}:error`;

    wrap.append(label, control, error);
    return wrap;
  }

  private static readForm(): Record<string, string | boolean> {
    const out: Record<string, string | boolean> = {};
    for (const control of IntakeScreen.el('form').querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>('[name]')) {
      out[control.name] = control instanceof HTMLInputElement && control.type === 'checkbox' ? control.checked : control.value;
    }
    return out;
  }

  private static showErrors(err: DxError, conflict = false): void {
    const box = IntakeScreen.el('[data-testid="errors:alert"]');
    box.hidden = false;
    box.textContent = conflict ? 'This claim was changed elsewhere. Reload to get the latest version.' : err.localizedValue;
    for (const el of IntakeScreen.el('form').querySelectorAll('[aria-invalid]')) {
      el.removeAttribute('aria-invalid');
      el.removeAttribute('aria-describedby');
    }
    for (const el of IntakeScreen.el('form').querySelectorAll('.field__error')) el.textContent = '';
    for (const d of err.errorDetails) {
      if (!d.field) continue;
      const control = IntakeScreen.el('form').querySelector<HTMLElement>(`[name="${d.field}"]`);
      const msg = document.getElementById(`${control?.id ?? ''}-error`);
      if (control && msg) {
        control.setAttribute('aria-invalid', 'true');
        control.setAttribute('aria-describedby', msg.id);
        msg.textContent = d.message;
      }
    }
  }

  private static hideErrors(): void {
    const box = IntakeScreen.el('[data-testid="errors:alert"]');
    box.hidden = true;
    box.textContent = '';
  }

  private static status(text: string): void {
    IntakeScreen.el('[data-testid="status:text"]').textContent = text;
  }

  private static time(iso: string): string {
    return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' });
  }

  private static el<T extends HTMLElement = HTMLElement>(selector: string): T {
    const found = document.querySelector<T>(selector);
    if (!found) throw new Error(`Missing element ${selector}`);
    return found;
  }
}

void IntakeScreen.init();
