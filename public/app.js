const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const state = { run: null, config: null, granularity: 'symbol', paused: false, elapsedMs: 0, changes: [] };

boot();

async function boot() {
  state.config = await api('/api/config');
  populateScenarios();
  bindControls();
  connectStream();
  const params = new URLSearchParams(location.search);
  if (params.has('autostart')) {
    if (params.get('scenario')) $('#scenario').value = params.get('scenario');
    describeScenario();
    await startRun();
  }
}

function populateScenarios() {
  for (const select of [$('#scenario'), $('#replay-scenario')]) {
    select.innerHTML = state.config.scenarios.map((item) => `<option value="${item.id}">${item.name}</option>`).join('');
  }
  $('#scenario').value = 'healthy-recovery';
  $('#replay-scenario').value = 'bad-hypothesis';
  describeScenario();
}

function bindControls() {
  $$('.nav-tab').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
  $('#scenario').addEventListener('change', describeScenario);
  $('#budget').addEventListener('input', () => { $('#budget-value').textContent = `${Number($('#budget').value) / 1000}K`; });
  $$('#granularity button').forEach((button) => button.addEventListener('click', () => {
    $$('#granularity button').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    state.granularity = button.dataset.value;
  }));
  $('#start-run').addEventListener('click', startRun);
  $('#inject-failure').addEventListener('click', () => control('inject-failure'));
  $('#pause-run').addEventListener('click', () => control(state.paused ? 'resume' : 'pause'));
  $('#run-replay').addEventListener('click', runReplay);
}

function switchView(view) {
  $$('.nav-tab').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  $$('.view').forEach((panel) => panel.classList.remove('active'));
  $(`#${view}-view`).classList.add('active');
}

function describeScenario() {
  const scenario = state.config.scenarios.find((item) => item.id === $('#scenario').value);
  $('#scenario-description').textContent = scenario.description;
}

async function startRun() {
  resetRunUI();
  const config = {
    scenario: $('#scenario').value,
    supervisorMode: $('#supervisor-mode').value,
    contextPolicy: $('#context-policy').value,
    budget: Number($('#budget').value),
    granularity: state.granularity,
    enforcement: $('#enforcement').checked,
    speed: 620,
  };
  state.run = await api('/api/runs', { method: 'POST', body: JSON.stringify(config) });
  renderRun(state.run);
}

async function control(action) {
  if (!state.run) return;
  state.run = await api(`/api/runs/${state.run.id}/control`, { method: 'POST', body: JSON.stringify({ action }) });
  state.paused = state.run.status === 'paused';
  renderRun(state.run);
}

function connectStream() {
  const stream = new EventSource('/api/stream');
  for (const type of ['run.started', 'run.updated', 'run.completed']) {
    stream.addEventListener(type, ({ data }) => {
      const message = JSON.parse(data);
      if (!state.run || message.data.id === state.run.id) {
        state.run = message.data;
        renderRun(state.run);
      }
    });
  }
  stream.addEventListener('trajectory.event', async ({ data }) => {
    const message = JSON.parse(data);
    if (!state.run || message.data.event.runId !== state.run.id) {
      if (state.run?.status === 'running') return;
      resetRunUI();
      state.run = await api(`/api/runs/${message.data.event.runId}`);
      renderRun(state.run);
    }
    addTrajectoryEvent(message.data);
  });
}

function renderRun(run) {
  $('#run-label').textContent = run.status.toUpperCase();
  $('#run-title').textContent = run.scenarioName;
  $('#run-id').textContent = `RUN ${run.id}`;
  $('#run-status-dot').className = run.status;
  $('#inject-failure').disabled = run.status !== 'running' || run.config.scenario.includes('injected');
  $('#pause-run').disabled = !['running', 'paused'].includes(run.status);
  $('#pause-run').textContent = run.status === 'paused' ? '▶' : 'Ⅱ';
  state.paused = run.status === 'paused';
  if (run.status === 'terminated') $('#decision-copy').textContent = `${formatNumber(run.tokensAvoided)} projected tokens avoided.`;
}

function addTrajectoryEvent(record) {
  $('#timeline-empty').classList.add('hidden');
  $('#timeline').classList.remove('hidden');
  const { event, supervisor, context } = record;
  const stagnant = supervisor.signals.callsSinceProgress >= 4 || supervisor.signals.testStagnation;
  const progress = event.progress || event.evidence?.length;
  const node = document.createElement('article');
  node.className = `timeline-item ${progress ? 'progress' : ''} ${stagnant ? 'stagnant' : ''}`;
  node.innerHTML = `<div class="tool-icon">${toolIcon(event.tool)}</div><div><div class="event-title">${escapeHtml(event.title)}</div><div class="event-detail">${escapeHtml(event.detail || event.output)}</div>${(event.evidence || []).map((item) => `<span class="evidence-tag">+ ${escapeHtml(item)}</span>`).join('')}</div><div class="event-meta"><b>#${String(event.seq).padStart(2, '0')} · ${event.tool}</b><span>+${formatNumber(event.tokens)} tok</span>${event.test ? `<div class="event-test">${event.test.passing}/${event.test.total} tests</div>` : ''}</div>`;
  $('#timeline').append(node);
  $('#timeline').scrollTop = $('#timeline').scrollHeight;
  renderSupervisor(supervisor);
  renderContext(context);
  updateCost(event);
}

function renderSupervisor(supervisor) {
  $('#score').textContent = supervisor.score;
  const ring = $('#score-ring');
  ring.style.setProperty('--score', supervisor.score);
  ring.style.setProperty('--ring', supervisor.decision === 'continue' ? 'var(--green)' : supervisor.decision === 'intervene' ? 'var(--amber)' : 'var(--red)');
  const decision = $('#decision');
  decision.textContent = supervisor.decision.toUpperCase();
  decision.className = `decision ${supervisor.decision}`;
  $('#decision-copy').textContent = supervisor.reasons[0]?.label || 'Trajectory is producing novel, verified evidence.';
  const show = supervisor.decision !== 'continue';
  $('#intervention').classList.toggle('hidden', !show);
  if (show) {
    $('#intervention-title').textContent = supervisor.decision === 'terminate' ? 'Open the circuit breaker' : 'Steer before stopping';
    $('#intervention-copy').textContent = supervisor.intervention;
    $('#signal-chips').innerHTML = supervisor.reasons.map((reason) => `<span class="signal-chip">${escapeHtml(reason.label)}</span>`).join('');
  }
}

function renderContext(context) {
  $('#context-empty').classList.add('hidden');
  $('#candidate-count').textContent = `${context.candidates} candidates`;
  const percent = Math.min(100, Math.round(context.used / context.budget * 100));
  $('#budget-bar').style.width = `${percent}%`;
  $('#budget-label').textContent = `${percent}%`;
  $('#density').textContent = `${context.density}%`;
  $('#density-bar').style.width = `${context.density}%`;
  $('#context-usage').textContent = `${formatNumber(context.used)} / ${formatNumber(context.budget)} tokens allocated`;
  $('#working-set').innerHTML = context.workingSet.map((item) => `<article class="memory-item"><div class="memory-top"><b>${escapeHtml(item.label)}</b><span>${formatNumber(item.cost)}t · v${item.score}</span></div><div class="memory-path">${escapeHtml(item.path)} · ${item.kind}</div><div class="memory-reason">${escapeHtml(item.reason)}</div><div class="value-bar"><i style="width:${Math.max(4, Math.min(100, item.score))}%"></i></div></article>`).join('');
  state.changes.push(...context.changes);
  state.changes = state.changes.slice(-12);
  $('#change-log').innerHTML = state.changes.length ? [...state.changes].reverse().map((change) => `<div class="change ${change.action}"><b>${change.action === 'admit' ? '+ ADMIT' : '− EVICT'}</b> ${escapeHtml(change.label)} — ${escapeHtml(change.reason)}</div>`).join('') : '<span class="muted">No allocation decisions yet.</span>';
}

function updateCost(event) {
  const currentTokens = Number($('#token-count').dataset.value || 0) + (event.tokens || 0);
  $('#token-count').dataset.value = currentTokens;
  $('#token-count').textContent = formatNumber(currentTokens);
  $('#call-count').textContent = event.seq;
  state.elapsedMs += event.durationMs || 0;
  $('#time-count').textContent = `${Math.round(state.elapsedMs / 100) / 10}s`;
}

function resetRunUI() {
  state.changes = [];
  state.elapsedMs = 0;
  $('#timeline').innerHTML = '';
  $('#timeline').classList.add('hidden');
  $('#timeline-empty').classList.remove('hidden');
  $('#working-set').innerHTML = '';
  $('#context-empty').classList.remove('hidden');
  $('#change-log').innerHTML = '<span class="muted">No allocation decisions yet.</span>';
  $('#intervention').classList.add('hidden');
  $('#token-count').dataset.value = 0;
  $('#token-count').textContent = '0';
  $('#call-count').textContent = '0';
  $('#time-count').textContent = '0s';
  $('#score').textContent = '100';
  $('#score-ring').style.setProperty('--score', 100);
  $('#decision').className = 'decision continue';
  $('#decision').textContent = 'CONTINUE';
  $('#density').textContent = '—';
  $('#density-bar').style.width = 0;
}

async function runReplay() {
  const result = await api('/api/replay', { method: 'POST', body: JSON.stringify({ scenario: $('#replay-scenario').value, supervisorMode: $('#supervisor-mode').value }) });
  $('#replay-results').classList.remove('hidden');
  $('#saved-tokens').textContent = `${formatNumber(result.savings.tokens)} tokens`;
  $('#saved-copy').textContent = `${result.savings.calls} tool calls and ${Math.round(result.savings.durationMs / 100) / 10}s were spent after the circuit would have opened.`;
  $('#supervised-calls').textContent = result.supervised.calls;
  $('#baseline-calls').textContent = result.unrestrained.calls;
  $('#supervised-stats').innerHTML = stats(result.supervised);
  $('#baseline-stats').innerHTML = stats(result.unrestrained);
  chart($('#supervised-chart'), result.supervised.history, result.supervised.terminationSeq);
  chart($('#baseline-chart'), result.unrestrained.history, null);
}

function stats(result) {
  return `<span><b>${formatNumber(result.tokens)}</b>tokens</span><span><b>${Math.round(result.durationMs / 100) / 10}s</b>runtime</span><span><b>${result.terminationSeq || '—'}</b>stop step</span>`;
}

function chart(node, history, terminationSeq) {
  node.innerHTML = history.map((point) => `<i class="${point.seq === terminationSeq ? 'stop' : ''}" style="height:${Math.max(3, point.score)}%" title="Step ${point.seq}: ${point.score}"></i>`).join('');
}

function toolIcon(tool) { return ({ model: 'AI', search: '⌕', read: 'RD', edit: 'Δ', revert: '↶', test: '✓' })[tool] || '•'; }
function formatNumber(value) { return new Intl.NumberFormat('en-US').format(value || 0); }
function escapeHtml(value = '') { return String(value).replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]); }
async function api(path, options) {
  const response = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...options });
  if (!response.ok) throw new Error((await response.json()).error || response.statusText);
  return response.json();
}
