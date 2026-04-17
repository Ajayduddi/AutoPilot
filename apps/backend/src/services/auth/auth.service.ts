/**
 * @fileoverview services/auth.service.
 *
 * High-level purpose:
 * Application/business orchestration services for domain workflows and integrations.
 *
 * Key Features (and trade-offs):
 * - Encapsulates domain logic behind testable service APIs.
 * - Coordinates provider calls, repository access, and policy checks.
 * - Provides reusable units consumed by routes and background flows.
 * - Trade-off: abstraction centralization requires disciplined boundaries to
 *   avoid hidden coupling across domains.
 *
 * Usage Guide:
 * 1. Import this module through backend domain boundaries.
 * 2. Keep side effects localized and explicit in service methods.
 * 3. Prefer dependency reuse over duplicating orchestration logic.
 * 4. Validate behavior with targeted service tests.
 * 5. Keep documentation aligned with behavior and tests.
 */
import { UserRepo } from '../../repositories/user.repo';
import { AuthSessionRepo } from '../../repositories/auth-session.repo';
import { getRuntimeConfig } from '../../config/runtime.config';
import {
  hashPasswordScrypt,
  randomToken,
  sha256Base64Url,
  sha256HexSync,
  verifyPasswordScrypt,
} from '../../util/auth-crypto';
import { decryptMfaSecret, encryptMfaSecret } from '../../util/mfa-secret-crypto';
import { buildTotpProvisioningUri, generateTotpSecret, verifyTotpCode } from '../../util/totp';

const SESSION_COOKIE_NAME = 'ap_session';
const OAUTH_STATE_COOKIE_NAME = 'ap_oauth_state';
const OAUTH_PKCE_COOKIE_NAME = 'ap_oauth_pkce';
const IS_PROD = process.env.NODE_ENV === 'production';
const PASSWORD_MIN_LENGTH = 12;
const SESSION_TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const TOTP_ISSUER = "Autopilot";

type PasswordValidationResult = {
  ok: boolean;
  message?: string;
};

function getSessionTtlDays() {
  return getRuntimeConfig().auth.sessionTtlDays;
}

function getFrontendOrigin() {
  return getRuntimeConfig().auth.frontendOrigin;
}

function shouldRevokeOtherSessionsOnPasswordChange() {
  return getRuntimeConfig().auth.revokeOtherSessionsOnPasswordChange;
}

function getGoogleOAuthConfig() {
  return getRuntimeConfig().auth.google;
}

function resolveCookieSecret(): string {
    const value = process.env.AUTH_COOKIE_SECRET?.trim();
  if (value && value !== 'dev_auth_secret_change_me') return value;
  if (IS_PROD) {
    throw new Error('AUTH_COOKIE_SECRET must be set to a strong value in production.');
  }
  return 'dev_auth_secret_change_me';
}

const COOKIE_SECRET = resolveCookieSecret();

/**
 * SafeUser type alias.
 */
export type SafeUser = {
    id: string;
    email: string;
    name: string | null;
  timezone?: string | null;
};

type SessionResolution = {
  user: any;
  session: any;
  tokenHash: string;
  mfaRequired: boolean;
};

/**
 * toSafeUser function.
 *
 * Performs to safe user logic within application service orchestration.
 *
 * @remarks
 * Keep side effects explicit and propagate failures to caller-level handlers.
 */
export function toSafeUser(user: any): SafeUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name || null,
    timezone: user.timezone || null,
  };
}

function parseCookieHeader(cookieHeader?: string | null): Record<string, string> {
    const out: Record<string, string> = {};
  if (!cookieHeader) return out;
    const parts = cookieHeader.split(';');
  for (const raw of parts) {
    const [k, ...rest] = raw.trim().split('=');
    if (!k) continue;
    out[k] = decodeURIComponent(rest.join('=') || '');
  }
  return out;
}

function serializeCookie(name: string, value: string, opts?: { maxAge?: number; path?: string; httpOnly?: boolean }) {
    const segments = [`${name}=${encodeURIComponent(value)}`];
  segments.push(`Path=${opts?.path || '/'}`);
  if (typeof opts?.maxAge === 'number') segments.push(`Max-Age=${Math.max(0, Math.floor(opts.maxAge))}`);
  segments.push('SameSite=Lax');
  if (opts?.httpOnly !== false) segments.push('HttpOnly');
  if (IS_PROD) segments.push('Secure');
  return segments.join('; ');
}

function hashSessionToken(rawToken: string) {
  return sha256HexSync(`${COOKIE_SECRET}:${rawToken}`);
}

function makeSessionToken() {
  return randomToken(32);
}

function validatePasswordPolicy(password: string): PasswordValidationResult {
  if (!password || password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.` };
  }
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return { ok: false, message: 'Password must include at least one letter and one number.' };
  }
  return { ok: true };
}

/**
 * AuthService class.
 *
 * Encapsulates auth service behavior for application service orchestration.
 *
 * @remarks
 * This service is part of the backend composition pipeline and is used by
 * higher-level route/service flows to keep responsibilities separated.
 */
export class AuthService {
  static SESSION_COOKIE_NAME = SESSION_COOKIE_NAME;
  static OAUTH_STATE_COOKIE_NAME = OAUTH_STATE_COOKIE_NAME;
  static OAUTH_PKCE_COOKIE_NAME = OAUTH_PKCE_COOKIE_NAME;
  static PASSWORD_MIN_LENGTH = PASSWORD_MIN_LENGTH;
  static get FRONTEND_ORIGIN() {
    return getFrontendOrigin();
  }

  static validatePasswordPolicy(password: string): PasswordValidationResult {
    return validatePasswordPolicy(password);
  }

    static async generateOAuthStateAndPkce() {
        const state = randomToken(32);
        const codeVerifier = randomToken(32);
        const codeChallenge = await sha256Base64Url(codeVerifier);
    return {
      state,
      pkce: { codeVerifier, codeChallenge },
    };
  }

    static serializePkceCookie(codeVerifier: string) {
    return serializeCookie(OAUTH_PKCE_COOKIE_NAME, codeVerifier, {
      maxAge: 10 * 60, // 10 minutes
      path: '/',
      httpOnly: true,
    });
  }

    static clearPkceCookie() {
    return serializeCookie(OAUTH_PKCE_COOKIE_NAME, '', { maxAge: 0, path: '/', httpOnly: true });
  }

    static parseCookies(cookieHeader?: string | null) {
    return parseCookieHeader(cookieHeader);
  }

  static serializeSessionCookie(token: string) {
    return serializeCookie(SESSION_COOKIE_NAME, token, {
      maxAge: getSessionTtlDays() * 24 * 60 * 60,
      path: '/',
      httpOnly: true,
    });
  }

    static clearSessionCookie() {
    return serializeCookie(SESSION_COOKIE_NAME, '', { maxAge: 0, path: '/', httpOnly: true });
  }

    static serializeOAuthStateCookie(state: string) {
    return serializeCookie(OAUTH_STATE_COOKIE_NAME, state, { maxAge: 10 * 60, path: '/', httpOnly: true });
  }

    static clearOAuthStateCookie() {
    return serializeCookie(OAUTH_STATE_COOKIE_NAME, '', { maxAge: 0, path: '/', httpOnly: true });
  }

    static async hashPassword(password: string) {
    return await hashPasswordScrypt(password);
  }

    static async verifyPassword(password: string, passwordHash?: string | null) {
    return await verifyPasswordScrypt(password, passwordHash);
  }

  static async createSessionForUser(params: { userId: string; userAgent?: string | null; ip?: string | null }) {
    const user = await UserRepo.getById(params.userId);
    if (!user) {
      throw new Error("User not found");
    }
    const rawToken = makeSessionToken();
    const tokenHash = hashSessionToken(rawToken);
    const expiresAt = new Date(Date.now() + getSessionTtlDays() * 24 * 60 * 60 * 1000);
    await AuthSessionRepo.create({
      userId: params.userId,
      tokenHash,
      expiresAt,
      mfaVerifiedAt: user.mfaTotpEnabledAt ? null : new Date(),
      userAgent: params.userAgent || null,
      ip: params.ip || null,
    });
    return rawToken;
  }

  static async getSessionUserFromCookie(cookieHeader?: string | null): Promise<SessionResolution | null> {
    const cookies = parseCookieHeader(cookieHeader);
    const token = cookies[SESSION_COOKIE_NAME];
    if (!token) return null;
    const tokenHash = hashSessionToken(token);
    const session = await AuthSessionRepo.getActiveByTokenHash(tokenHash);
    if (!session) return null;
    const user = await UserRepo.getById(session.userId);
    if (!user) return null;
    const mfaRequired = Boolean(user.mfaTotpEnabledAt && !session.mfaVerifiedAt);
    const lastSeenAt = session.lastSeenAt ? new Date(session.lastSeenAt).getTime() : 0;
    if ((Date.now() - lastSeenAt) >= SESSION_TOUCH_INTERVAL_MS) {
      await AuthSessionRepo.touch(session.id).catch(() => {});
    }
    return { user, session, tokenHash, mfaRequired };
  }

    static async logoutByCookie(cookieHeader?: string | null) {
        const cookies = parseCookieHeader(cookieHeader);
        const token = cookies[SESSION_COOKIE_NAME];
    if (!token) return;
        const tokenHash = hashSessionToken(token);
    await AuthSessionRepo.revokeByTokenHash(tokenHash);
  }

    static async revokeOtherSessionsForCookie(userId: string, cookieHeader?: string | null) {
    if (!shouldRevokeOtherSessionsOnPasswordChange()) return;
        const cookies = parseCookieHeader(cookieHeader);
        const token = cookies[SESSION_COOKIE_NAME];
    if (!token) {
      await AuthSessionRepo.revokeAllForUserExceptSession(userId, null);
      return;
    }
        const tokenHash = hashSessionToken(token);
        const current = await AuthSessionRepo.getActiveByTokenHash(tokenHash);
    await AuthSessionRepo.revokeAllForUserExceptSession(userId, current?.id || null);
  }

  static isGoogleConfigured() {
    const google = getGoogleOAuthConfig();
    return Boolean(
      google.clientId.trim()
      && google.clientSecret.trim()
      && google.redirectUri.trim(),
    );
  }

    static getGoogleStartUrl(state: string, codeChallenge?: string) {
        const google = getGoogleOAuthConfig();
        const clientId = google.clientId;
        const redirectUri = google.redirectUri;
        const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    url.searchParams.set('prompt', 'select_account');
    // PKCE for enhanced security (RFC 7636)
    if (codeChallenge) {
      url.searchParams.set('code_challenge', codeChallenge);
      url.searchParams.set('code_challenge_method', 'S256');
    }
    return url.toString();
  }

    static async exchangeGoogleCode(code: string, codeVerifier?: string) {
        const google = getGoogleOAuthConfig();
        const clientId = google.clientId;
        const clientSecret = google.clientSecret;
        const redirectUri = google.redirectUri;
        const params: Record<string, string> = {
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    };
    // Include PKCE code_verifier if provided
    if (codeVerifier) {
      params.code_verifier = codeVerifier;
    }
        const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    });
    if (!tokenRes.ok) {
      throw new Error(`Google token exchange failed: HTTP ${tokenRes.status}`);
    }
        const tokenJson = await tokenRes.json() as { access_token?: string };
    if (!tokenJson.access_token) throw new Error('Google token exchange missing access_token');

        const profileRes = await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { Authorization: `Bearer ${tokenJson.access_token}` },
    });
    if (!profileRes.ok) throw new Error(`Google userinfo failed: HTTP ${profileRes.status}`);
        const profile = await profileRes.json() as { sub?: string; email?: string; name?: string };
    if (!profile.sub || !profile.email) throw new Error('Google profile missing required fields');
    return { sub: profile.sub, email: profile.email.toLowerCase(), name: profile.name || null };
  }

  static async getAuthMode(currentUser?: any) {
    if (currentUser) return 'authenticated' as const;
    const realUsers = await UserRepo.countRealUsers();
    return realUsers === 0 ? 'onboarding' as const : 'login' as const;
  }

  static async getMfaStatus(userId: string) {
    const user = await UserRepo.getById(userId);
    if (!user) throw new Error("User not found");
    return {
      enabled: Boolean(user.mfaTotpEnabledAt && user.mfaTotpSecretEnc),
      pending: Boolean(user.mfaTotpPendingSecretEnc),
      enabledAt: user.mfaTotpEnabledAt || null,
      method: user.mfaTotpEnabledAt ? "totp" as const : null,
    };
  }

  static async beginTotpSetup(userId: string, email: string) {
    const secret = generateTotpSecret();
    const encrypted = await encryptMfaSecret(secret);
    if (!encrypted) throw new Error("Failed to secure pending MFA secret");
    await UserRepo.beginTotpSetup(userId, encrypted);
    return {
      secret,
      issuer: TOTP_ISSUER,
      otpauthUri: buildTotpProvisioningUri({
        issuer: TOTP_ISSUER,
        accountName: email,
        secret,
      }),
    };
  }

  static async enableTotpForUser(userId: string, code: string) {
    const user = await UserRepo.getById(userId);
    if (!user?.mfaTotpPendingSecretEnc) {
      throw new Error("No pending TOTP setup found");
    }
    const secret = await decryptMfaSecret(user.mfaTotpPendingSecretEnc);
    if (!secret) {
      throw new Error("Failed to read pending TOTP setup");
    }
    const valid = await verifyTotpCode({ secret, code, digits: 6, period: 30, window: 1 });
    if (!valid) {
      return { ok: false as const };
    }
    await UserRepo.enableTotp(userId, user.mfaTotpPendingSecretEnc);
    return { ok: true as const };
  }

  static async disableTotpForUser(userId: string, code: string) {
    const user = await UserRepo.getById(userId);
    if (!user?.mfaTotpSecretEnc || !user.mfaTotpEnabledAt) {
      throw new Error("TOTP MFA is not enabled");
    }
    const secret = await decryptMfaSecret(user.mfaTotpSecretEnc);
    if (!secret) {
      throw new Error("Failed to read configured TOTP secret");
    }
    const valid = await verifyTotpCode({ secret, code, digits: 6, period: 30, window: 1 });
    if (!valid) {
      return { ok: false as const };
    }
    await UserRepo.disableTotp(userId);
    return { ok: true as const };
  }

  static async verifyTotpForPendingSession(cookieHeader: string | null | undefined, code: string) {
    const resolved = await this.getSessionUserFromCookie(cookieHeader);
    if (!resolved) {
      return { ok: false as const, reason: "NO_SESSION" as const };
    }
    if (!resolved.mfaRequired) {
      return { ok: false as const, reason: "MFA_NOT_REQUIRED" as const };
    }
    const secret = await decryptMfaSecret(resolved.user.mfaTotpSecretEnc);
    if (!secret) {
      return { ok: false as const, reason: "MFA_UNAVAILABLE" as const };
    }
    const valid = await verifyTotpCode({ secret, code, digits: 6, period: 30, window: 1 });
    if (!valid) {
      return { ok: false as const, reason: "INVALID_CODE" as const };
    }
    await AuthSessionRepo.markMfaVerified(resolved.session.id);
    return { ok: true as const, user: resolved.user };
  }
}
