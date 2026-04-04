/**
 * @fileoverview services/event.service.
 *
 * Domain and orchestration logic that coordinates repositories, providers, and policy rules.
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
