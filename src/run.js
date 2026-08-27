import { randomUUID } from 'node:crypto';
import { FlightSupervisor } from './supervisor.js';
import { ContextBudgetManager } from './context-manager.js';
import { scenarioEvents, scenarios } from './scenarios.js';

export class AgentRun {
  constructor(config, emit) {
    this.id = config.id || randomUUID().slice(0, 8);
    this.config = {
      scenario: config.scenario || 'bad-hypothesis',
      supervisorMode: config.supervisorMode || 'hybrid',
      enforcement: config.enforcement !== false,
      contextPolicy: config.contextPolicy || 'dynamic',
      granularity: config.granularity || 'symbol',
      budget: Number(config.budget || 8000),
      speed: Number(config.speed || 700),
    };
    this.emit = emit;
    this.supervisor = new FlightSupervisor({ mode: this.config.supervisorMode });
    this.context = new ContextBudgetManager({ budget: this.config.budget, policy: this.config.contextPolicy, granularity: this.config.granularity });
    this.events = scenarioEvents(this.config.scenario);
    this.timeline = [];
    this.index = 0;
    this.status = 'ready';
    this.startedAt = null;
    this.completedAt = null;
    this.timer = null;
    this.forcedFailure = false;
  }

  start() {
    if (this.status === 'running') return;
    this.status = 'running';
    this.startedAt ||= new Date().toISOString();
    this.#broadcast('run.started', this.snapshot());
    this.timer = setInterval(() => this.step(), Math.max(100, this.config.speed));
    setTimeout(() => this.step(), 40);
  }

  step() {
    if (this.status !== 'running') return;
    const source = this.events[this.index];
    if (!source) return this.complete('completed');
    const event = {
      ...source,
      runId: this.id,
      timestamp: new Date().toISOString(),
      spanId: `${this.id}-${String(source.seq).padStart(3, '0')}`,
    };
    const supervisor = this.supervisor.observe(event);
    const context = this.context.update(event, event.candidates);
    const record = { event, supervisor, context };
    this.timeline.push(record);
    this.index += 1;
    this.#broadcast('trajectory.event', record);

    if (supervisor.decision === 'terminate' && this.config.enforcement) {
      return this.complete('terminated');
    }
    if (this.index >= this.events.length) this.complete('completed');
  }

  pause() {
    if (this.status !== 'running') return;
    this.status = 'paused';
    clearInterval(this.timer);
    this.#broadcast('run.updated', this.snapshot());
  }

  resume() {
    if (this.status !== 'paused') return;
    this.status = 'running';
    this.timer = setInterval(() => this.step(), Math.max(100, this.config.speed));
    this.#broadcast('run.updated', this.snapshot());
  }

  injectFailure() {
    if (this.forcedFailure || this.status !== 'running') return false;
    const failure = scenarioEvents('search-loop').slice(5);
    this.events.splice(this.index, this.events.length - this.index, ...failure.map((item, offset) => ({ ...item, seq: this.index + offset + 1 })));
    this.forcedFailure = true;
    this.config.scenario = 'injected-search-loop';
    this.#broadcast('run.updated', this.snapshot());
    return true;
  }

  complete(status) {
    clearInterval(this.timer);
    this.status = status;
    this.completedAt = new Date().toISOString();
    this.#broadcast('run.completed', this.snapshot());
  }

  snapshot() {
    const last = this.timeline.at(-1);
    const usedTokens = this.timeline.reduce((sum, row) => sum + (row.event.tokens || 0), 0);
    const potential = this.events.reduce((sum, event) => sum + (event.tokens || 0), 0);
    return {
      id: this.id,
      config: this.config,
      scenarioName: scenarios[this.config.scenario]?.name || 'Injected failure trajectory',
      status: this.status,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      currentSeq: this.index,
      totalEvents: this.events.length,
      usedTokens,
      tokensAvoided: this.status === 'terminated' ? potential - usedTokens : 0,
      decision: last?.supervisor.decision || 'continue',
      score: last?.supervisor.score ?? 100,
      timeline: this.timeline,
    };
  }

  #broadcast(type, data) {
    this.emit({ type, data, at: new Date().toISOString() });
  }
}

export function replayScenario(config = {}) {
  const events = scenarioEvents(config.scenario || 'bad-hypothesis');
  const supervised = evaluate(events, { ...config, enforcement: true });
  const unrestrained = evaluate(events, { ...config, enforcement: false });
  return {
    scenario: config.scenario || 'bad-hypothesis',
    supervised,
    unrestrained,
    savings: {
      calls: unrestrained.calls - supervised.calls,
      tokens: unrestrained.tokens - supervised.tokens,
      durationMs: unrestrained.durationMs - supervised.durationMs,
    },
  };
}

function evaluate(events, config) {
  const supervisor = new FlightSupervisor({ mode: config.supervisorMode || 'hybrid' });
  let terminationSeq = null;
  const history = [];
  for (const event of events) {
    const result = supervisor.observe(event);
    history.push({ seq: event.seq, score: result.score, decision: result.decision });
    if (result.decision === 'terminate' && config.enforcement !== false) {
      terminationSeq = event.seq;
      break;
    }
  }
  const consumed = terminationSeq ? events.slice(0, terminationSeq) : events;
  return {
    calls: consumed.length,
    tokens: consumed.reduce((sum, event) => sum + (event.tokens || 0), 0),
    durationMs: consumed.reduce((sum, event) => sum + (event.durationMs || 0), 0),
    terminationSeq,
    outcome: terminationSeq ? 'circuit opened' : 'ran to completion',
    history,
  };
}
