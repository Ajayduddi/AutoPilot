/**
 * @fileoverview services/push.service.
 *
 * Web Push subscription management and notification delivery orchestration.
 */
import webpush from 'web-push';
import { PushSubscriptionRepo, type PushSubscriptionInput } from '../repositories/push-subscription.repo';

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

function ensureVapidKeys() {
  if (vapidConfigured) {
    return {
      publicKey: process.env.VAPID_PUBLIC_KEY || generatedPublicKey,
      privateKey: process.env.VAPID_PRIVATE_KEY || generatedPrivateKey,
    };
  }

    const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
    const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
    const subject = process.env.VAPID_SUBJECT?.trim() || 'mailto:admin@autopilot.local';

    let resolvedPublicKey: string = publicKey || '';
    let resolvedPrivateKey: string = privateKey || '';

  if (!resolvedPublicKey || !resolvedPrivateKey) {
        const generated = webpush.generateVAPIDKeys();
    resolvedPublicKey = generated.publicKey;
    resolvedPrivateKey = generated.privateKey;
    generatedPublicKey = resolvedPublicKey;
    generatedPrivateKey = resolvedPrivateKey;
    console.warn('[PushService] VAPID keys were not configured in env. Generated temporary keys for this process.');
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
        console.warn('[PushService] Push delivery failed:', err?.message || err);
      }
    }));
  }
}
