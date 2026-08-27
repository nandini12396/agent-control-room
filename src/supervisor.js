import { fingerprint } from './fingerprint.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class FlightSupervisor {
  constructor({ mode = 'hybrid', windowSize = 8, interveneAt = 58, terminateAt = 32 } = {}) {
    this.mode = mode;
    this.windowSize = windowSize;
    this.interveneAt = interveneAt;
    this.terminateAt = terminateAt;
    this.events = [];
    this.lastProgressSeq = 0;
    this.bestTests = 0;
    this.totalTokens = 0;
    this.tokensAtProgress = 0;
    this.decision = 'continue';
    this.history = [];
  }

  observe(rawEvent) {
    const event = {
      ...rawEvent,
      fingerprint: rawEvent.fingerprint || fingerprint([rawEvent.tool, rawEvent.input, rawEvent.output]),
    };
    this.events.push(event);
    this.totalTokens += event.tokens || 0;

    const passing = event.test?.passing ?? 0;
    const progress = Boolean(event.progress) || passing > this.bestTests || (event.evidence?.length ?? 0) > 0;
    if (progress) {
      this.lastProgressSeq = event.seq;
      this.tokensAtProgress = this.totalTokens;
      this.bestTests = Math.max(this.bestTests, passing);
    }

    const window = this.events.slice(-this.windowSize);
    const fingerprints = window.map((item) => item.fingerprint);
    const unique = new Set(fingerprints).size;
    const repeatRatio = window.length ? 1 - unique / window.length : 0;
    const novelty = window.length ? unique / window.length : 1;
    const unresolvedTests = window.filter((item) => item.tool === 'test' && item.test && item.test.passing < item.test.total);
    const testStagnation = unresolvedTests.length >= 2 && new Set(unresolvedTests.map((item) => item.test.passing)).size === 1;
    const churnEvents = window.filter((item) => item.tool === 'edit' || item.tool === 'revert');
    const churnFiles = new Set(churnEvents.map((item) => item.file).filter(Boolean));
    const editChurn = churnEvents.length >= 3 && churnFiles.size <= 1;
    const contradiction = window.some((item) => item.contradiction);
    const callsSinceProgress = Math.max(0, event.seq - this.lastProgressSeq);
    const tokensSinceProgress = this.totalTokens - this.tokensAtProgress;
    const sameToolRun = trailingRun(window.map((item) => item.tool));

    const penalties = {
      repetition: Math.round(repeatRatio * 28),
      noProgress: clamp(callsSinceProgress * 4, 0, 28),
      tokenBurn: clamp(Math.floor(tokensSinceProgress / 550) * 3, 0, 18),
      testStagnation: testStagnation ? 16 : 0,
      editChurn: editChurn ? 18 : 0,
      contradiction: contradiction ? 9 : 0,
      toolLoop: sameToolRun >= 4 ? 12 : 0,
    };
    const credits = clamp((event.progress ? 12 : 0) + ((event.evidence?.length || 0) * 5), 0, 20);
    const heuristicScore = clamp(100 - Object.values(penalties).reduce((sum, value) => sum + value, 0) + credits, 0, 100);
    const judgeScore = trajectoryJudge({ novelty, callsSinceProgress, testStagnation, editChurn, contradiction, repeatRatio });
    const score = this.mode === 'heuristic'
      ? heuristicScore
      : this.mode === 'judge'
        ? judgeScore
        : Math.round(heuristicScore * 0.62 + judgeScore * 0.38);

    let decision = score <= this.terminateAt && event.seq >= 8
      ? 'terminate'
      : score <= this.interveneAt && event.seq >= 5
        ? 'intervene'
        : 'continue';
    if (this.decision === 'terminate') decision = 'terminate';
    this.decision = decision;

    const reasons = rankReasons(penalties, event, callsSinceProgress);
    const snapshot = {
      score,
      heuristicScore,
      judgeScore,
      decision,
      reasons,
      signals: {
        novelty: round(novelty),
        repeatRatio: round(repeatRatio),
        callsSinceProgress,
        tokensSinceProgress,
        testStagnation,
        editChurn,
        contradiction,
      },
      intervention: interventionFor(reasons, event),
    };
    this.history.push({ seq: event.seq, ...snapshot });
    return snapshot;
  }
}

function trailingRun(values) {
  if (!values.length) return 0;
  const last = values.at(-1);
  let count = 0;
  for (let index = values.length - 1; index >= 0 && values[index] === last; index -= 1) count += 1;
  return count;
}

function trajectoryJudge({ novelty, callsSinceProgress, testStagnation, editChurn, contradiction, repeatRatio }) {
  let recoveryLikelihood = 92;
  recoveryLikelihood -= callsSinceProgress * 5;
  recoveryLikelihood -= repeatRatio * 24;
  recoveryLikelihood += novelty * 8;
  if (testStagnation) recoveryLikelihood -= 17;
  if (editChurn) recoveryLikelihood -= 19;
  if (contradiction) recoveryLikelihood -= 8;
  return clamp(Math.round(recoveryLikelihood), 0, 100);
}

function rankReasons(penalties, event, callsSinceProgress) {
  const labels = {
    repetition: 'Equivalent results are repeating',
    noProgress: `${callsSinceProgress} calls since measurable progress`,
    tokenBurn: 'Tokens are being spent without new evidence',
    testStagnation: 'The same test failure remains unresolved',
    editChurn: 'One file is cycling through edit/revert',
    contradiction: 'Execution evidence contradicts the active hypothesis',
    toolLoop: `The ${event.tool} tool is in a tight loop`,
  };
  return Object.entries(penalties)
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key, severity]) => ({ key, label: labels[key], severity }));
}

function interventionFor(reasons, event) {
  const keys = new Set(reasons.map((reason) => reason.key));
  if (keys.has('testStagnation')) return 'Summarize the failing assertion, discard the current hypothesis, and inspect its nearest caller.';
  if (keys.has('editChurn')) return `Freeze ${event.file || 'the edited file'} and search for a missing dependency or caller.`;
  if (keys.has('repetition') || keys.has('toolLoop')) return 'Block duplicate tool inputs and require a new source of evidence before continuing.';
  return 'Checkpoint the current evidence and state one falsifiable next step.';
}

function round(value) {
  return Math.round(value * 100) / 100;
}
