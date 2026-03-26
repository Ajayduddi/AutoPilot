import { randomUUID } from 'crypto';
export function generateThreadId() {
  return `thread_${randomUUID()}`;
}
