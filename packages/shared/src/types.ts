/**
 * Payload contract sent from this app to an n8n workflow trigger.
 *
 * @remarks
 * This envelope carries traceability fields and callback endpoints so n8n
 * can report completion/failure back to the platform.
 */
export interface N8nInboundEnvelope {
  trace_id: string;
  workflow_key: string;
  user_id: string;
  thread_id: string;
  message_id: string;
  payload: Record<string, unknown>;
  callback_url: string;
  notification_url: string;
}

/**
 * Callback contract sent from n8n to this app after trigger/processing.
 */
export interface N8nOutboundEnvelope {
  trace_id: string;
  workflow_key: string;
  status: 'running' | 'waiting_approval' | 'completed' | 'failed';
  user_id: string;
  thread_id: string;
  message_id: string;
  result?: Record<string, unknown>;
  error?: Record<string, unknown>;
  notification?: Record<string, unknown>;
  approval?: Record<string, unknown>;
}
