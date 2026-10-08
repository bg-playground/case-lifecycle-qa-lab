import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import { CaseStore, type StoreResult } from './CaseStore.js';
import { OAuthService } from './OAuthService.js';
import type { CaseContent, DxError } from './types.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const API = '/prweb/api/application/v2';
const TOKEN_PATH = '/prweb/PRRestService/oauth2/v1/token';
const MAX_BODY_BYTES = 64 * 1024;

const STATIC_FILES: Record<string, { file: string; type: string }> = {
  '/': { file: 'web/index.html', type: 'text/html; charset=utf-8' },
  '/app/intake.js': { file: 'dist/web/intake.js', type: 'text/javascript; charset=utf-8' },
  '/app/styles.css': { file: 'web/styles.css', type: 'text/css; charset=utf-8' },
  // Inter (OFL-1.1, from the @fontsource/inter dev dependency). A bundled font keeps
  // rendering identical across machines, which the visual-diff test relies on.
  '/app/fonts/inter-400.woff2': { file: 'node_modules/@fontsource/inter/files/inter-latin-400-normal.woff2', type: 'font/woff2' },
  '/app/fonts/inter-600.woff2': { file: 'node_modules/@fontsource/inter/files/inter-latin-600-normal.woff2', type: 'font/woff2' },
};

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

/** Routes HTTP requests for the mock DX API v2, the mock token endpoint and the demo screen. */
export class DxApiRouter {
  static async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      await DxApiRouter.route(req, res);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      const message = err instanceof Error ? err.message : 'Internal error';
      DxApiRouter.sendError(res, status, status === 500 ? 'Internal error' : 'Bad request', message);
    }
  }

  private static async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://mock.invalid');
    const path = url.pathname;
    const method = req.method ?? 'GET';

    if (method === 'GET' && path === '/health') return DxApiRouter.sendJson(res, 200, { status: 'ok' });
    if (method === 'GET' && STATIC_FILES[path]) return DxApiRouter.sendStatic(res, path);

    if (method === 'POST' && path === TOKEN_PATH) {
      const form = new URLSearchParams(await DxApiRouter.readBody(req));
      const result = OAuthService.issueClientCredentialsToken(form, req.headers.authorization);
      return DxApiRouter.sendJson(res, result.ok ? 200 : result.status, result.body, { 'Cache-Control': 'no-store' });
    }
    if (method === 'POST' && path === '/mock-portal/session') {
      return DxApiRouter.sendJson(res, 200, OAuthService.issuePortalSessionToken(), { 'Cache-Control': 'no-store' });
    }

    if (!path.startsWith(`${API}/`)) return DxApiRouter.sendError(res, 404, 'NotFound', `No route for ${method} ${path}`);
    if (!OAuthService.verify(req.headers.authorization)) {
      return DxApiRouter.sendError(res, 401, 'Unauthorized', 'A valid bearer token is required.', {
        'WWW-Authenticate': 'Bearer',
      });
    }

    const parts = path.slice(API.length + 1).split('/').map((p) => decodeURIComponent(p));
    const ifMatch = DxApiRouter.header(req, 'if-match');

    // POST /cases
    if (method === 'POST' && parts.length === 1 && parts[0] === 'cases') {
      const body = await DxApiRouter.readJson(req);
      if (typeof body.caseTypeID !== 'string') throw new HttpError(400, 'caseTypeID is required.');
      return DxApiRouter.sendStore(res, CaseStore.createCase(body.caseTypeID, DxApiRouter.content(body)));
    }
    // GET /cases/{caseID}
    if (method === 'GET' && parts.length === 2 && parts[0] === 'cases') {
      return DxApiRouter.sendStore(res, CaseStore.getCase(parts[1]!));
    }
    // GET /assignments/{assignmentID}
    if (method === 'GET' && parts.length === 2 && parts[0] === 'assignments') {
      return DxApiRouter.sendStore(res, CaseStore.getAssignment(parts[1]!));
    }
    // PATCH /assignments/{assignmentID}/actions/{actionID}[/save]
    if (method === 'PATCH' && parts[0] === 'assignments' && parts[2] === 'actions' && (parts.length === 4 || (parts.length === 5 && parts[4] === 'save'))) {
      const body = await DxApiRouter.readJson(req);
      const [, assignmentID, , actionID] = parts as [string, string, string, string];
      const result = parts.length === 5
        ? CaseStore.saveAssignment(assignmentID, actionID, ifMatch, DxApiRouter.content(body))
        : CaseStore.submitAssignment(assignmentID, actionID, ifMatch, DxApiRouter.content(body));
      return DxApiRouter.sendStore(res, result);
    }

    return DxApiRouter.sendError(res, 404, 'NotFound', `No route for ${method} ${path}`);
  }

  private static content(body: Record<string, unknown>): CaseContent {
    const raw = body.content;
    if (raw === undefined) return {};
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new HttpError(400, 'content must be an object.');
    const out: CaseContent = {};
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') out[k] = v;
      else throw new HttpError(400, `content.${k} must be a string, number or boolean.`);
    }
    return out;
  }

  private static sendStore(res: ServerResponse, result: StoreResult): void {
    if (result.ok) return DxApiRouter.sendJson(res, result.status, result.body, { ETag: result.eTag });
    const details = result.errors?.map((e) => ({ message: e.message, field: e.field }));
    return DxApiRouter.sendError(res, result.status, result.classification, result.message, {}, details);
  }

  private static sendError(
    res: ServerResponse,
    status: number,
    classification: string,
    message: string,
    headers: Record<string, string> = {},
    details?: DxError['errorDetails'],
  ): void {
    const body: DxError = {
      errorClassification: classification,
      localizedValue: message,
      errorDetails: details ?? [{ message }],
    };
    DxApiRouter.sendJson(res, status, body, headers);
  }

  private static sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
    res.end(JSON.stringify(body));
  }

  private static async sendStatic(res: ServerResponse, path: string): Promise<void> {
    const entry = STATIC_FILES[path]!;
    const data = await readFile(ROOT + entry.file);
    res.writeHead(200, { 'Content-Type': entry.type, 'Cache-Control': 'no-store' });
    res.end(data);
  }

  private static header(req: IncomingMessage, name: string): string | undefined {
    const v = req.headers[name];
    return Array.isArray(v) ? v[0] : v;
  }

  private static async readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
    const text = await DxApiRouter.readBody(req);
    if (!text) return {};
    try {
      const parsed: unknown = JSON.parse(text);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error();
      return parsed as Record<string, unknown>;
    } catch {
      throw new HttpError(400, 'Body must be a JSON object.');
    }
  }

  private static async readBody(req: IncomingMessage): Promise<string> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_BODY_BYTES) throw new HttpError(413, 'Body too large.');
      chunks.push(chunk as Buffer);
    }
    return Buffer.concat(chunks).toString('utf8');
  }
}
