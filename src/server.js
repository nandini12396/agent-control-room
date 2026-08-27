import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgentRun, replayScenario } from './run.js';
import { scenarios } from './scenarios.js';
import { DatadogExporter } from './datadog-exporter.js';

const root = fileURLToPath(new URL('../public/', import.meta.url));
const port = Number(process.env.PORT || 4318);
const host = process.env.HOST || '127.0.0.1';
const runs = new Map();
const clients = new Set();
const datadog = new DatadogExporter();

function broadcast(message) {
  const payload = `event: ${message.type}\ndata: ${JSON.stringify(message)}\n\n`;
  for (const client of clients) client.write(payload);
  datadog.export(message).catch((error) => console.error(`[datadog] ${error.message}`));
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

    if (request.method === 'GET' && url.pathname === '/api/stream') return openStream(request, response);
    if (request.method === 'GET' && url.pathname === '/api/config') return json(response, 200, {
      scenarios: Object.entries(scenarios).map(([id, value]) => ({ id, name: value.name, description: value.description })),
      supervisorModes: ['hybrid', 'heuristic', 'judge'],
      contextPolicies: ['dynamic', 'ranked', 'append'],
      datadogExport: datadog.enabled,
    });
    if (request.method === 'GET' && url.pathname === '/api/runs') return json(response, 200, [...runs.values()].map((run) => run.snapshot()));
    if (request.method === 'POST' && url.pathname === '/api/runs') {
      const config = await body(request);
      const run = new AgentRun(config, broadcast);
      runs.set(run.id, run);
      run.start();
      return json(response, 201, run.snapshot());
    }
    if (request.method === 'POST' && url.pathname === '/api/replay') return json(response, 200, replayScenario(await body(request)));
    if (request.method === 'POST' && url.pathname === '/api/v1/events') return ingestEvent(request, response);

    const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)(?:\/control)?$/);
    if (runMatch) {
      const run = runs.get(runMatch[1]);
      if (!run) return json(response, 404, { error: 'run not found' });
      if (request.method === 'GET') return json(response, 200, run.snapshot());
      if (request.method === 'POST') {
        const { action } = await body(request);
        if (action === 'pause') run.pause();
        else if (action === 'resume') run.resume();
        else if (action === 'inject-failure') run.injectFailure();
        else if (action === 'step') run.step();
        else return json(response, 400, { error: 'unknown action' });
        return json(response, 200, run.snapshot());
      }
    }

    if (request.method === 'GET') return staticFile(url.pathname, response);
    json(response, 404, { error: 'not found' });
  } catch (error) {
    json(response, 500, { error: error.message });
  }
});

async function ingestEvent(request, response) {
  const payload = await body(request);
  const runId = payload.runId || payload.trace_id || 'external-agent';
  let run = runs.get(runId);
  if (!run) {
    run = new AgentRun({ id: runId, scenario: 'healthy-recovery', enforcement: false }, broadcast);
    run.events = [];
    run.status = 'running';
    run.startedAt = new Date().toISOString();
    runs.set(runId, run);
  }
  const event = normalizeOtelEvent(payload, run.index + 1);
  const supervisor = run.supervisor.observe(event);
  const context = run.context.update(event, payload.candidates || []);
  run.timeline.push({ event, supervisor, context });
  run.index += 1;
  broadcast({ type: 'trajectory.event', data: { event, supervisor, context }, at: event.timestamp });
  return json(response, 202, { runId, seq: event.seq, decision: supervisor.decision, score: supervisor.score, intervention: supervisor.intervention });
}

function normalizeOtelEvent(payload, seq) {
  const attributes = payload.attributes || {};
  return {
    runId: payload.runId || payload.trace_id || 'external-agent',
    spanId: payload.spanId || payload.span_id || `external-${seq}`,
    seq: payload.seq || seq,
    timestamp: payload.timestamp || new Date().toISOString(),
    tool: payload.tool || attributes['gen_ai.tool.name'] || attributes['operation.name'] || 'model',
    title: payload.title || payload.name || 'External GenAI span',
    input: payload.input || attributes['gen_ai.input'] || '',
    output: payload.output || attributes['gen_ai.output'] || '',
    tokens: Number(payload.tokens || attributes['gen_ai.usage.total_tokens'] || 0),
    durationMs: Number(payload.durationMs || attributes['duration_ms'] || 0),
    file: payload.file || attributes['code.filepath'],
    test: payload.test,
    evidence: payload.evidence || [],
    progress: payload.progress || false,
    contradiction: payload.contradiction || false,
    promote: payload.promote || [],
    contradicts: payload.contradicts || [],
  };
}

function openStream(request, response) {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  response.write(`event: connected\ndata: {"ok":true}\n\n`);
  clients.add(response);
  request.on('close', () => clients.delete(response));
}

async function staticFile(pathname, response) {
  const requestPath = pathname === '/' ? 'index.html' : pathname.slice(1);
  const safePath = normalize(requestPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const filePath = join(root, safePath);
  if (!filePath.startsWith(root)) return json(response, 403, { error: 'forbidden' });
  try {
    const contents = await readFile(filePath);
    response.writeHead(200, { 'Content-Type': mime(extname(filePath)), 'Cache-Control': 'no-store' });
    response.end(contents);
  } catch {
    json(response, 404, { error: 'not found' });
  }
}

function mime(extension) {
  return ({ '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' })[extension] || 'application/octet-stream';
}

async function body(request) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new Error('request too large');
  }
  return raw ? JSON.parse(raw) : {};
}

function json(response, status, value) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(value));
}

server.listen(port, host, () => {
  console.log(`\n  Agent Control Room  →  http://${host}:${port}\n`);
});

export { server };
