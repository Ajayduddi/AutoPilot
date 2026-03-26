export interface N8nInboundEnvelope {
  trace_id: string;
  workflow_key: string;
  user_id: string;
  thread_id: string;
  message_id: string;
  payload: Record<string, any>;
  callback_url: string;
  notification_url: string;
}

export interface N8nOutboundEnvelope {
  trace_id: string;
  workflow_key: string;
  status: 'running' | 'waiting_approval' | 'completed' | 'failed';
  user_id: string;
  thread_id: string;
  message_id: string;
  result?: Record<string, any>;
  error?: Record<string, any>;
  notification?: Record<string, any>;
  approval?: Record<string, any>;
}
