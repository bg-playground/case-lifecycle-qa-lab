import { expect, type APIRequestContext, type APIResponse } from '@playwright/test';

const API = '/prweb/api/application/v2';
const TOKEN_PATH = '/prweb/PRRestService/oauth2/v1/token';
export const CASE_TYPE_ID = 'Synthetic-Claims-Work-AutoClaim';

/** Mock client credentials. Placeholders for the mock only, not secrets. */
const CLIENT_ID = process.env.MOCK_CLIENT_ID ?? 'claims-qa-client';
const CLIENT_SECRET = process.env.MOCK_CLIENT_SECRET ?? 'not-a-real-secret';

export interface CaseInfo {
  ID: string;
  businessID: string;
  status: string;
  stageID: string;
  stageLabel: string;
  stages: Array<{ ID: string; name: string; visited_status: string }>;
  assignments: Array<{ ID: string; name: string; actions: Array<{ ID: string; name: string }>; sla: { goal: string; deadline: string } | null }>;
  content: Record<string, unknown>;
}

export interface DxResponse {
  data: { caseInfo: CaseInfo };
  uiResources: { form: { name: string; fields: Array<{ key: string; testId: string }> } | null };
  nextAssignmentInfo?: { ID: string; context: string };
}

export interface DxCall {
  response: APIResponse;
  eTag: string;
  body: DxResponse;
}

/** Valid Intake content using synthetic data only. */
export const VALID_INTAKE = {
  fullName: 'Avery Example',
  email: 'avery@claimant.example',
  phone: '555-0142',
  policyNumber: 'POL-100001',
  vin: '1HGBH41JXMN109186',
  incidentDate: '2026-10-01',
  description: 'Rear-ended at a stop light. Bumper and tail light damaged.',
} as const;

/** Thin typed client for the mock DX API v2, used by the API-level tests. */
export class DxApiClient {
  static async token(request: APIRequestContext): Promise<string> {
    const response = await request.post(TOKEN_PATH, {
      form: { grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: CLIENT_SECRET },
    });
    expect(response.status(), 'token endpoint status').toBe(200);
    const body = (await response.json()) as { access_token: string; token_type: string };
    expect(body.token_type).toBe('bearer');
    return body.access_token;
  }

  static async createCase(request: APIRequestContext, token: string, content: Record<string, unknown> = {}): Promise<DxCall> {
    const response = await request.post(`${API}/cases`, {
      headers: DxApiClient.auth(token),
      data: { caseTypeID: CASE_TYPE_ID, content },
    });
    return DxApiClient.read(response);
  }

  static async getAssignment(request: APIRequestContext, token: string, assignmentID: string): Promise<DxCall> {
    const response = await request.get(`${API}/assignments/${encodeURIComponent(assignmentID)}`, {
      headers: DxApiClient.auth(token),
    });
    return DxApiClient.read(response);
  }

  static async submit(request: APIRequestContext, token: string, assignmentID: string, actionID: string, eTag: string | null, content: Record<string, unknown>): Promise<APIResponse> {
    return request.patch(DxApiClient.actionPath(assignmentID, actionID), {
      headers: { ...DxApiClient.auth(token), ...(eTag ? { 'If-Match': eTag } : {}) },
      data: { content },
    });
  }

  static async save(request: APIRequestContext, token: string, assignmentID: string, actionID: string, eTag: string, content: Record<string, unknown>): Promise<APIResponse> {
    return request.patch(`${DxApiClient.actionPath(assignmentID, actionID)}/save`, {
      headers: { ...DxApiClient.auth(token), 'If-Match': eTag },
      data: { content },
    });
  }

  static async read(response: APIResponse): Promise<DxCall> {
    return { response, eTag: response.headers()['etag'] ?? '', body: (await response.json()) as DxResponse };
  }

  private static actionPath(assignmentID: string, actionID: string): string {
    return `${API}/assignments/${encodeURIComponent(assignmentID)}/actions/${encodeURIComponent(actionID)}`;
  }

  private static auth(token: string): Record<string, string> {
    return { Authorization: `Bearer ${token}` };
  }
}
