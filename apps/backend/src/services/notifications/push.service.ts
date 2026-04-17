/**
 * @fileoverview services/push.service.
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
import webpush from 'web-push';
import { PushSubscriptionRepo, type PushSubscriptionInput } from '../../repositories/push-subscription.repo';
import { logger } from '../../util/logger';
import { getRuntimeConfig } from '../../config/runtime.config';

type PushPayload = {
    title: string;
  body?: string;
  url?: string;
  tag?: string;
  data?: Record<string, unknown>;
  actions?: Array<{ action: string; title: string }>;
};

let vapidConfigured = false;
let generatedPublicKey = '';
let generatedPrivateKey = '';

function isProd(): boolean {
  return String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
}

function ensureVapidKeys() {
  const pushConfig = getRuntimeConfig().push;
  if (vapidConfigured) {
    return {
      publicKey: pushConfig.vapidPublicKey || generatedPublicKey,
      privateKey: pushConfig.vapidPrivateKey || generatedPrivateKey,
    };
  }

    const publicKey = pushConfig.vapidPublicKey.trim();
    const privateKey = pushConfig.vapidPrivateKey.trim();
    const subject = pushConfig.vapidSubject.trim() || 'mailto:admin@autopilot.local';

    let resolvedPublicKey: string = publicKey || '';
    let resolvedPrivateKey: string = privateKey || '';

  if (!resolvedPublicKey || !resolvedPrivateKey) {
    if (isProd()) {
      throw new Error('VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY must be configured in production.');
    }
    const generated = webpush.generateVAPIDKeys();
    resolvedPublicKey = generated.publicKey;
    resolvedPrivateKey = generated.privateKey;
    generatedPublicKey = resolvedPublicKey;
    generatedPrivateKey = resolvedPrivateKey;
    logger.warn({
      scope: 'push.service',
      message: 'VAPID keys were not configured in env. Generated temporary keys for this process.',
    });
  }

  if (isProd() && !subject.startsWith('mailto:')) {
    throw new Error('VAPID_SUBJECT must be configured as a valid mailto: URI in production.');
  }

  webpush.setVapidDetails(subject, resolvedPublicKey, resolvedPrivateKey);
  vapidConfigured = true;

  return { publicKey: resolvedPublicKey, privateKey: resolvedPrivateKey };
}

/**
 * Coordinates VAPID key setup, push subscription persistence, and fan-out delivery.
 */
export class PushService {
    static getPublicKey() {
    return ensureVapidKeys().publicKey;
  }

    static async subscribe(userId: string, subscription: PushSubscriptionInput) {
    ensureVapidKeys();
    return PushSubscriptionRepo.upsertForUser(userId, subscription);
  }

    static async unsubscribe(endpoint: string) {
    return PushSubscriptionRepo.revokeByEndpoint(endpoint);
  }

    static async sendToUser(userId: string, payload: PushPayload) {
    ensureVapidKeys();
        const subscriptions = await PushSubscriptionRepo.getActiveByUser(userId);
    if (subscriptions.length === 0) return;

        const message = JSON.stringify({
      title: payload.title,
      body: payload.body || '',
      url: payload.url || '/notifications',
      tag: payload.tag || 'autopilot-notification',
      data: payload.data || {},
      actions: payload.actions || [],
      ts: Date.now(),
    });

    await Promise.all(subscriptions.map(async (sub) => {
            const pushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth,
        },
      };

      try {
        await webpush.sendNotification(pushSubscription, message, { TTL: 60 });
        await PushSubscriptionRepo.touch(sub.endpoint);
      } catch (err: any) {
                const status = err?.statusCode;
        if (status === 404 || status === 410) {
          await PushSubscriptionRepo.revokeByEndpoint(sub.endpoint);
          return;
        }
        logger.warn({
          scope: 'push.service',
          message: 'Push delivery failed',
          err,
          endpoint: sub.endpoint,
          status,
        });
      }
    }));
  }
}

export function resetPushServiceForTests() {
  vapidConfigured = false;
  generatedPublicKey = '';
  generatedPrivateKey = '';
}
