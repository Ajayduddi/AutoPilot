import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { UserRepo } from '../repositories/user.repo';
import { AuthSessionRepo } from '../repositories/auth-session.repo';

const SESSION_COOKIE_NAME = 'ap_session';
const OAUTH_STATE_COOKIE_NAME = 'ap_oauth_state';
const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS || '14');
const COOKIE_SECRET = process.env.AUTH_COOKIE_SECRET || 'dev_auth_secret_change_me';
const FRONTEND_ORIGIN = (process.env.FRONTEND_ORIGIN || 'http://localhost:5173').replace(/\/$/, '');
const IS_PROD = process.env.NODE_ENV === 'production';
const REVOKE_OTHER_SESSIONS_ON_PASSWORD_CHANGE =
  (process.env.AUTH_REVOKE_OTHER_SESSIONS_ON_PASSWORD_CHANGE || 'true') === 'true';
const scrypt = promisify(scryptCb);

export type SafeUser = {
  id: string;
  email: string;
  name: string | null;
};

export function toSafeUser(user: any): SafeUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name || null,
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
  return createHash('sha256').update(`${COOKIE_SECRET}:${rawToken}`).digest('hex');
}

function makeSessionToken() {
  return randomBytes(32).toString('base64url');
}

export class AuthService {
  static SESSION_COOKIE_NAME = SESSION_COOKIE_NAME;
  static OAUTH_STATE_COOKIE_NAME = OAUTH_STATE_COOKIE_NAME;
  static FRONTEND_ORIGIN = FRONTEND_ORIGIN;

  static parseCookies(cookieHeader?: string | null) {
    return parseCookieHeader(cookieHeader);
  }

  static serializeSessionCookie(token: string) {
    return serializeCookie(SESSION_COOKIE_NAME, token, {
      maxAge: SESSION_TTL_DAYS * 24 * 60 * 60,
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
    const salt = randomBytes(16).toString('hex');
    const key = await scrypt(password, salt, 64) as Buffer;
    return `${salt}:${key.toString('hex')}`;
  }

  static async verifyPassword(password: string, passwordHash?: string | null) {
    if (!passwordHash) return false;
    const [salt, storedHex] = passwordHash.split(':');
    if (!salt || !storedHex) return false;
    const derived = await scrypt(password, salt, 64) as Buffer;
    const stored = Buffer.from(storedHex, 'hex');
    if (stored.length !== derived.length) return false;
    return timingSafeEqual(stored, derived);
  }

  static async createSessionForUser(params: { userId: string; userAgent?: string | null; ip?: string | null }) {
    const rawToken = makeSessionToken();
    const tokenHash = hashSessionToken(rawToken);
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
    await AuthSessionRepo.create({
      userId: params.userId,
      tokenHash,
      expiresAt,
      userAgent: params.userAgent || null,
      ip: params.ip || null,
    });
    return rawToken;
  }

  static async getSessionUserFromCookie(cookieHeader?: string | null) {
    const cookies = parseCookieHeader(cookieHeader);
    const token = cookies[SESSION_COOKIE_NAME];
    if (!token) return null;
    const tokenHash = hashSessionToken(token);
    const session = await AuthSessionRepo.getActiveByTokenHash(tokenHash);
    if (!session) return null;
    const user = await UserRepo.getById(session.userId);
    if (!user) return null;
    await AuthSessionRepo.touch(session.id).catch(() => {});
    return { user, session, tokenHash };
  }

  static async logoutByCookie(cookieHeader?: string | null) {
    const cookies = parseCookieHeader(cookieHeader);
    const token = cookies[SESSION_COOKIE_NAME];
    if (!token) return;
    const tokenHash = hashSessionToken(token);
    await AuthSessionRepo.revokeByTokenHash(tokenHash);
  }

  static async revokeOtherSessionsForCookie(userId: string, cookieHeader?: string | null) {
    if (!REVOKE_OTHER_SESSIONS_ON_PASSWORD_CHANGE) return;
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
    return Boolean(
      process.env.GOOGLE_CLIENT_ID?.trim()
      && process.env.GOOGLE_CLIENT_SECRET?.trim()
      && process.env.GOOGLE_REDIRECT_URI?.trim(),
    );
  }

  static getGoogleStartUrl(state: string) {
    const clientId = process.env.GOOGLE_CLIENT_ID || '';
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || '';
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'openid email profile');
    url.searchParams.set('state', state);
    url.searchParams.set('prompt', 'select_account');
    return url.toString();
  }

  static async exchangeGoogleCode(code: string) {
    const clientId = process.env.GOOGLE_CLIENT_ID || '';
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || '';
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
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
}
