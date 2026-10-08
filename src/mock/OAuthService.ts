import { randomBytes } from 'node:crypto';

/**
 * Mock OAuth 2.0 token service: client credentials grant only (RFC 6749 §4.4),
 * plus a mock "portal session" used by the demo screen in place of a real login.
 *
 * The client credentials below are placeholders for a mock. They protect
 * nothing and are not secrets.
 */
export interface MockClient {
  clientId: string;
  clientSecret: string;
  operator: string;
}

interface IssuedToken {
  operator: string;
  expiresAt: number;
}

export type TokenResult =
  | { ok: true; body: { access_token: string; token_type: 'bearer'; expires_in: number } }
  | { ok: false; status: 400 | 401; body: { error: string; error_description: string } };

export class OAuthService {
  static readonly TOKEN_TTL_SECONDS = 3600;

  static readonly clients: readonly MockClient[] = [
    {
      clientId: process.env.MOCK_CLIENT_ID ?? 'claims-qa-client',
      clientSecret: process.env.MOCK_CLIENT_SECRET ?? 'not-a-real-secret',
      operator: 'svc.claims-qa',
    },
  ];

  private static readonly tokens = new Map<string, IssuedToken>();

  /**
   * Handles POST /prweb/PRRestService/oauth2/v1/token.
   * Client auth via HTTP Basic or client_id / client_secret form fields.
   */
  static issueClientCredentialsToken(form: URLSearchParams, authorization: string | undefined): TokenResult {
    if (form.get('grant_type') !== 'client_credentials') {
      return OAuthService.error(400, 'unsupported_grant_type', 'Only client_credentials is supported by this mock.');
    }
    const { clientId, clientSecret } = OAuthService.readClientAuth(form, authorization);
    const client = OAuthService.clients.find((c) => c.clientId === clientId && c.clientSecret === clientSecret);
    if (!client) {
      return OAuthService.error(401, 'invalid_client', 'Unknown client or bad client secret.');
    }
    return { ok: true, body: OAuthService.mint(client.operator) };
  }

  /** Mock stand-in for an interactive portal login. Used only by the demo screen. */
  static issuePortalSessionToken(): { access_token: string; token_type: 'bearer'; expires_in: number } {
    return OAuthService.mint('demo.claimant');
  }

  /** Returns the operator for a valid "Bearer <token>" header, else null. */
  static verify(authorization: string | undefined): string | null {
    const token = /^Bearer\s+(\S+)$/i.exec(authorization ?? '')?.[1];
    if (!token) return null;
    const issued = OAuthService.tokens.get(token);
    if (!issued || issued.expiresAt < Date.now()) return null;
    return issued.operator;
  }

  private static mint(operator: string) {
    const accessToken = randomBytes(24).toString('base64url');
    OAuthService.tokens.set(accessToken, {
      operator,
      expiresAt: Date.now() + OAuthService.TOKEN_TTL_SECONDS * 1000,
    });
    return { access_token: accessToken, token_type: 'bearer' as const, expires_in: OAuthService.TOKEN_TTL_SECONDS };
  }

  private static readClientAuth(form: URLSearchParams, authorization: string | undefined) {
    const basic = /^Basic\s+(\S+)$/i.exec(authorization ?? '')?.[1];
    if (basic) {
      const decoded = Buffer.from(basic, 'base64').toString('utf8');
      const sep = decoded.indexOf(':');
      return {
        clientId: decodeURIComponent(decoded.slice(0, sep)),
        clientSecret: decodeURIComponent(decoded.slice(sep + 1)),
      };
    }
    return { clientId: form.get('client_id') ?? '', clientSecret: form.get('client_secret') ?? '' };
  }

  private static error(status: 400 | 401, error: string, description: string): TokenResult {
    return { ok: false, status, body: { error, error_description: description } };
  }
}
