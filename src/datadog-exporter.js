export class DatadogExporter {
  constructor({ apiKey = process.env.DD_API_KEY, site = process.env.DD_SITE || 'datadoghq.com' } = {}) {
    this.apiKey = apiKey;
    this.site = site;
    this.enabled = Boolean(apiKey);
  }

  async export(message) {
    if (!this.enabled || !['trajectory.event', 'run.completed'].includes(message.type)) return;
    const event = message.data.event;
    const supervisor = message.data.supervisor;
    const run = message.data;
    const record = {
      ddsource: 'agent-control-room',
      service: 'coding-agent-supervisor',
      status: supervisor?.decision === 'terminate' ? 'error' : supervisor?.decision === 'intervene' ? 'warn' : 'info',
      message: event ? `${event.tool}: ${event.title}` : `Agent run ${run.status}`,
      run_id: event?.runId || run.id,
      span_id: event?.spanId,
      'agent.tool': event?.tool,
      'agent.tokens': event?.tokens,
      'agent.supervisor.score': supervisor?.score || run.score,
      'agent.supervisor.decision': supervisor?.decision || run.decision,
      'agent.context.density': message.data.context?.density,
      'agent.context.used_tokens': message.data.context?.used,
      timestamp: message.at,
    };
    const response = await fetch(`https://http-intake.logs.${this.site}/api/v2/logs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'DD-API-KEY': this.apiKey },
      body: JSON.stringify([record]),
    });
    if (!response.ok) throw new Error(`Datadog intake returned ${response.status}`);
  }
}
