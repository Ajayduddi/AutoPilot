export class N8nService {
  static async executeWorkflow(webhookUrl: string, payload: any, traceId: string) {
    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-trace-id': traceId
        },
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        throw new Error(`n8n responded with status ${response.status}`);
      }
      return await response.json().catch(() => ({}));
    } catch (err) {
      console.error(`[N8N_DISPATCH_ERROR] Failed to execute n8n webhook at ${webhookUrl}`, err);
      throw err;
    }
  }
}
