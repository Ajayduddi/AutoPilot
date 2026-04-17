/**
 * @fileoverview routes/auth.routes.
 *
 * High-level purpose:
 * HTTP route surface that validates requests and delegates business logic to services.
 *
 * Key Features (and trade-offs):
 * - Schema-driven request validation and response normalization.
 * - Auth/rate-limit aware route composition for API boundaries.
 * - Thin handlers that preserve routes -> services -> repositories layering.
 * - Trade-off: abstraction centralization requires disciplined boundaries to
 *   avoid hidden coupling across domains.
 *
 * Usage Guide:
 * 1. Import this module through backend domain boundaries.
 * 2. Add new endpoints by pairing route handlers with schemas.
 * 3. Delegate business decisions to service layer components.
 * 4. Verify contract changes with API and route tests.
 * 5. Keep documentation aligned with behavior and tests.
 */
import { Router } from 'express';
import { db } from '../db';
import { users } from '../db/schema';
import { and, eq, ne } from 'drizzle-orm';
import { AuthService, toSafeUser } from '../services/auth/auth.service';
import { UserRepo } from '../repositories/user.repo';
import { rateLimit } from '../middleware/rate-limit.middleware';
import { TemporalService } from '../services/temporal.service';
import { resolveRequestIp } from '../util/request-ip';

const router = Router();

router.get('/state', async (req, res, next) => {
  try {
    const mode = await AuthService.getAuthMode(req.auth?.user);
    res.json({
      status: 'ok',
      data: {
        mode,
        user: req.auth?.user || null,
        pendingMfaUser: req.auth?.pendingMfaUser || null,
        mfaVerified: req.auth?.mfaVerified ?? false,
        oauth: {
          google: AuthService.isGoogleConfigured(),
        },
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/onboarding/register', async (req, res, next) => {
  try {
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
        const password = typeof req.body?.password === 'string' ? req.body.password : '';

    if (!email || !password) {
      return res.status(400).json({ error: 'Valid email and password are required' });
    }
    const passwordPolicy = AuthService.validatePasswordPolicy(password);
    if (!passwordPolicy.ok) {
      return res.status(400).json({ error: passwordPolicy.message });
    }

        const realUsers = await UserRepo.countRealUsers();
    if (realUsers > 0) {
      return res.status(409).json({ error: 'Onboarding is closed. Account already exists.' });
    }

        const existingReal = await db.query.users.findFirst({ where: andRealByEmail(email) });
    if (existingReal) {
      return res.status(409).json({ error: 'Email already in use' });
    }

    await UserRepo.normalizeLegacyEmailIfConflicts(email);
        const passwordHash = await AuthService.hashPassword(password);
        const created = await UserRepo.createUser({
      email,
      name: name || null,
      passwordHash,
    });
    await UserRepo.reassignLegacyDataTo(created.id);
    await UserRepo.deleteLegacyUser().catch(() => {});

        const token = await AuthService.createSessionForUser({
      userId: created.id,
            userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
      ip: resolveRequestIp(req),
    });

    res.setHeader('Set-Cookie', AuthService.serializeSessionCookie(token));
    res.status(201).json({ status: 'ok', data: { user: toSafeUser(created) } });
  } catch (err) {
    next(err);
  }
});

router.post(
  '/login',
  rateLimit({
    keyPrefix: 'auth-login',
    limit: 10,
    windowMs: 60_000,
        keyBy: (req) => {
            const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
            const ip = resolveRequestIp(req);
      return `${ip}:${email || 'unknown'}`;
    },
  }),
  async (req, res, next) => {
  try {
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!email || !password) {
      return res.status(400).json({
        status: 'error',
        error: { code: 'VALIDATION_ERROR', message: 'Email and password are required' },
      });
    }

        const user = await UserRepo.getByEmail(email);
    if (!user || user.id === UserRepo.LEGACY_USER_ID) {
      return res.status(401).json({
        status: 'error',
        error: { code: 'UNAUTHORIZED', message: 'Invalid credentials' },
      });
    }
        const valid = await AuthService.verifyPassword(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({
        status: 'error',
        error: { code: 'UNAUTHORIZED', message: 'Invalid credentials' },
      });
    }

        const token = await AuthService.createSessionForUser({
      userId: user.id,
            userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
      ip: resolveRequestIp(req),
    });
    const hasMfa = Boolean(user.mfaTotpEnabledAt && user.mfaTotpSecretEnc);
    res.setHeader('Set-Cookie', AuthService.serializeSessionCookie(token));
    if (hasMfa) {
      return res.status(202).json({
        status: 'ok',
        data: {
          mfaRequired: true,
          method: 'totp',
        },
      });
    }
    res.json({ status: 'ok', data: { user: toSafeUser(user) } });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', async (req, res, next) => {
  try {
    await AuthService.logoutByCookie(req.headers.cookie);
    res.setHeader('Set-Cookie', AuthService.clearSessionCookie());
    res.json({ status: 'ok', data: { loggedOut: true } });
  } catch (err) {
    next(err);
  }
});

router.get('/me', async (req, res) => {
  if (!req.auth?.user) return res.status(401).json({ error: 'Authentication required' });
  res.json({ status: 'ok', data: { user: req.auth.user } });
});

router.post('/mfa/totp/verify', async (req, res, next) => {
  try {
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    if (!code) {
      return res.status(400).json({ error: 'TOTP code is required' });
    }
    const result = await AuthService.verifyTotpForPendingSession(req.headers.cookie, code);
    if (!result.ok) {
      const status = result.reason === 'NO_SESSION' ? 401 : 400;
      return res.status(status).json({
        status: 'error',
        error: {
          code: result.reason,
          message: result.reason === 'INVALID_CODE' ? 'Invalid TOTP code' : 'TOTP verification failed',
        },
      });
    }
    return res.json({ status: 'ok', data: { user: toSafeUser(result.user) } });
  } catch (err) {
    next(err);
  }
});

router.get('/account', async (req, res) => {
  if (!req.auth?.user) return res.status(401).json({ error: 'Authentication required' });
    const user = await UserRepo.getById(req.auth.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });

    const hasPassword = Boolean(user.passwordHash);
    const authProvider = hasPassword
    ? (user.googleSub ? 'hybrid' : 'password')
    : 'google';

  res.json({
    status: 'ok',
    data: {
      id: user.id,
      name: user.name || null,
      email: user.email,
      timezone: user.timezone || null,
      hasPassword,
      authProvider,
      mfa: {
        enabled: Boolean(user.mfaTotpEnabledAt && user.mfaTotpSecretEnc),
        pending: Boolean(user.mfaTotpPendingSecretEnc),
        method: user.mfaTotpEnabledAt ? 'totp' : null,
        enabledAt: user.mfaTotpEnabledAt || null,
      },
    },
  });
});

router.get('/account/mfa', async (req, res, next) => {
  try {
    if (!req.auth?.user) return res.status(401).json({ error: 'Authentication required' });
    const status = await AuthService.getMfaStatus(req.auth.user.id);
    return res.json({ status: 'ok', data: status });
  } catch (err) {
    next(err);
  }
});

router.post('/account/mfa/totp/setup', async (req, res, next) => {
  try {
    if (!req.auth?.user) return res.status(401).json({ error: 'Authentication required' });
    const user = await UserRepo.getById(req.auth.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const status = await AuthService.getMfaStatus(user.id);
    if (status.enabled) {
      return res.status(409).json({ error: 'TOTP MFA is already enabled' });
    }
    const setup = await AuthService.beginTotpSetup(user.id, user.email);
    return res.json({ status: 'ok', data: setup });
  } catch (err) {
    next(err);
  }
});

router.post('/account/mfa/totp/enable', async (req, res, next) => {
  try {
    if (!req.auth?.user) return res.status(401).json({ error: 'Authentication required' });
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    if (!code) {
      return res.status(400).json({ error: 'TOTP code is required' });
    }
    const result = await AuthService.enableTotpForUser(req.auth.user.id, code);
    if (!result.ok) {
      return res.status(400).json({ error: 'Invalid TOTP code' });
    }
    return res.json({ status: 'ok', data: await AuthService.getMfaStatus(req.auth.user.id) });
  } catch (err) {
    next(err);
  }
});

router.post('/account/mfa/totp/disable', async (req, res, next) => {
  try {
    if (!req.auth?.user) return res.status(401).json({ error: 'Authentication required' });
    const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
    const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
    if (!code) {
      return res.status(400).json({ error: 'TOTP code is required' });
    }
    const user = await UserRepo.getById(req.auth.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.passwordHash) {
      if (!currentPassword) {
        return res.status(400).json({ error: 'Current password is required' });
      }
      const validPassword = await AuthService.verifyPassword(currentPassword, user.passwordHash);
      if (!validPassword) {
        return res.status(401).json({ error: 'Current password is incorrect' });
      }
    }
    const result = await AuthService.disableTotpForUser(req.auth.user.id, code);
    if (!result.ok) {
      return res.status(400).json({ error: 'Invalid TOTP code' });
    }
    return res.json({ status: 'ok', data: await AuthService.getMfaStatus(req.auth.user.id) });
  } catch (err) {
    next(err);
  }
});

router.patch('/account/profile', async (req, res, next) => {
  try {
    if (!req.auth?.user) return res.status(401).json({ error: 'Authentication required' });
        const rawName = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
        const rawTimezone = typeof req.body?.timezone === 'string' ? req.body.timezone.trim() : '';
    if (!rawName) return res.status(400).json({ error: 'Username is required' });
    if (rawName.length > 80) return res.status(400).json({ error: 'Username is too long (max 80 chars)' });
        const timezone = rawTimezone ? TemporalService.validateTimezone(rawTimezone) : null;
    if (rawTimezone && !timezone) {
      return res.status(400).json({ error: 'Invalid timezone value' });
    }

        const updated = await UserRepo.updateProfile(req.auth.user.id, { name: rawName, timezone });
    if (!updated) return res.status(404).json({ error: 'User not found' });
    res.json({ status: 'ok', data: { user: toSafeUser(updated) } });
  } catch (err) {
    next(err);
  }
});

router.patch('/account/email', async (req, res, next) => {
  try {
    if (!req.auth?.user) return res.status(401).json({ error: 'Authentication required' });
        const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
        const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';

    if (!email || !EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: 'Valid email is required' });
    }
    if (!currentPassword) {
      return res.status(400).json({ error: 'Current password is required' });
    }

        const user = await UserRepo.getById(req.auth.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.passwordHash) {
      return res.status(400).json({ error: 'Password login is disabled for this account' });
    }

        const validPassword = await AuthService.verifyPassword(currentPassword, user.passwordHash);
    if (!validPassword) return res.status(401).json({ error: 'Current password is incorrect' });

        const inUse = await UserRepo.isEmailTakenByAnotherUser(email, user.id);
    if (inUse) return res.status(409).json({ error: 'Email already in use' });

        const updated = await UserRepo.updateEmail(user.id, email);
    if (!updated) return res.status(404).json({ error: 'User not found' });

    res.json({ status: 'ok', data: { user: toSafeUser(updated) } });
  } catch (err) {
    next(err);
  }
});

router.patch('/account/password', async (req, res, next) => {
  try {
    if (!req.auth?.user) return res.status(401).json({ error: 'Authentication required' });
        const currentPassword = typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '';
        const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

    if (!currentPassword) return res.status(400).json({ error: 'Current password is required' });
    const passwordPolicy = AuthService.validatePasswordPolicy(newPassword);
    if (!passwordPolicy.ok) {
      return res.status(400).json({ error: passwordPolicy.message });
    }

        const user = await UserRepo.getById(req.auth.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (!user.passwordHash) {
      return res.status(400).json({ error: 'Password login is disabled for this account' });
    }

        const validPassword = await AuthService.verifyPassword(currentPassword, user.passwordHash);
    if (!validPassword) return res.status(401).json({ error: 'Current password is incorrect' });

        const newPasswordHash = await AuthService.hashPassword(newPassword);
    await UserRepo.updatePasswordHash(user.id, newPasswordHash);
    await AuthService.revokeOtherSessionsForCookie(user.id, req.headers.cookie);
    res.json({ status: 'ok', data: { updated: true } });
  } catch (err) {
    next(err);
  }
});

router.get('/google/start', async (_req, res) => {
  if (!AuthService.isGoogleConfigured()) {
    return res.status(400).json({ error: 'Google OAuth is not configured' });
  }
  const { state, pkce } = await AuthService.generateOAuthStateAndPkce();
  res.setHeader('Set-Cookie', [
    AuthService.serializeOAuthStateCookie(state),
    AuthService.serializePkceCookie(pkce.codeVerifier),
  ]);
  res.redirect(AuthService.getGoogleStartUrl(state, pkce.codeChallenge));
});

router.get('/google/callback', async (req, res) => {
  try {
    if (!AuthService.isGoogleConfigured()) {
      return res.redirect(`${AuthService.FRONTEND_ORIGIN}/login?error=google_not_configured`);
    }

        const code = typeof req.query?.code === 'string' ? req.query.code : '';
        const state = typeof req.query?.state === 'string' ? req.query.state : '';
        const cookies = AuthService.parseCookies(req.headers.cookie);
        const stateCookie = cookies[AuthService.OAUTH_STATE_COOKIE_NAME] || '';
        const pkceCookie = cookies[AuthService.OAUTH_PKCE_COOKIE_NAME] || '';

    if (!code || !state || !stateCookie || state !== stateCookie) {
      res.setHeader('Set-Cookie', [
        AuthService.clearOAuthStateCookie(),
        AuthService.clearPkceCookie(),
      ]);
      return res.redirect(`${AuthService.FRONTEND_ORIGIN}/login?error=invalid_oauth_state`);
    }

        const profile = await AuthService.exchangeGoogleCode(code, pkceCookie);
        const realUsers = await UserRepo.countRealUsers();

        let user = await UserRepo.getByGoogleSub(profile.sub);
    if (!user) {
            const byEmail = await UserRepo.getByEmail(profile.email);
      if (byEmail && byEmail.id !== UserRepo.LEGACY_USER_ID) {
        user = byEmail.googleSub
          ? byEmail
          : await UserRepo.attachGoogleSub(byEmail.id, profile.sub);
      }
    }

    if (realUsers === 0) {
      if (!user) {
        await UserRepo.normalizeLegacyEmailIfConflicts(profile.email);
        user = await UserRepo.createUser({
          email: profile.email,
          name: profile.name,
          googleSub: profile.sub,
          passwordHash: null,
        });
      }
      await UserRepo.reassignLegacyDataTo(user.id);
      await UserRepo.deleteLegacyUser().catch(() => {});
    } else {
      if (!user) {
        return res.redirect(`${AuthService.FRONTEND_ORIGIN}/login?error=single_user_locked`);
      }
            const isAllowed = await UserRepo.canUseAsSingleUser(user.id);
      if (!isAllowed) {
        return res.redirect(`${AuthService.FRONTEND_ORIGIN}/login?error=single_user_locked`);
      }
    }

        const token = await AuthService.createSessionForUser({
      userId: user.id,
            userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
      ip: resolveRequestIp(req),
    });

    const hasMfa = Boolean(user.mfaTotpEnabledAt && user.mfaTotpSecretEnc);
    res.setHeader('Set-Cookie', [
      AuthService.serializeSessionCookie(token),
      AuthService.clearOAuthStateCookie(),
      AuthService.clearPkceCookie(),
    ]);
    return res.redirect(`${AuthService.FRONTEND_ORIGIN}/${hasMfa ? 'login?mfa=required' : ''}`);
  } catch {
    res.setHeader('Set-Cookie', [
      AuthService.clearOAuthStateCookie(),
      AuthService.clearPkceCookie(),
    ]);
    return res.redirect(`${AuthService.FRONTEND_ORIGIN}/login?error=google_auth_failed`);
  }
});

function andRealByEmail(email: string) {
  return and(eq(users.email, email), ne(users.id, UserRepo.LEGACY_USER_ID));
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export { router as authRouter };
