/**
 * @fileoverview services/event.service.
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
import { EventEmitter } from 'events';

/**
 * EventBus class.
 */
class EventBus extends EventEmitter {}

/**
 * eventBus exported constant.
 */
export const eventBus = new EventBus();

/**
 * EventTypes exported constant.
 */
export const EventTypes = {
  NOTIFICATION_CREATED: 'NOTIFICATION_CREATED',
  WORKFLOW_RUN_UPDATED: 'WORKFLOW_RUN_UPDATED',
  WORKFLOW_TRIGGERED: 'WORKFLOW_TRIGGERED',
  WORKFLOW_APPROVAL_REQUESTED: 'WORKFLOW_APPROVAL_REQUESTED',
  CONTEXT_INDEXED: 'CONTEXT_INDEXED',
};
