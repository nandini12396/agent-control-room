const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export class ContextBudgetManager {
  constructor({ budget = 8000, policy = 'dynamic', granularity = 'symbol' } = {}) {
    this.budget = Number(budget);
    this.policy = policy;
    this.granularity = granularity;
    this.items = new Map();
    this.workingSet = [];
    this.changes = [];
  }

  update(event, candidates = []) {
    this.changes = [];
    for (const candidate of candidates) this.#upsert(candidate, event);
    for (const item of this.items.values()) this.#rescore(item, event);

    const before = new Set(this.workingSet.map((item) => item.id));
    const ranked = [...this.items.values()].sort((a, b) => b.score / b.cost - a.score / a.cost);
    const selected = this.policy === 'append'
      ? this.#appendOnly(ranked)
      : this.#pack(ranked);
    const after = new Set(selected.map((item) => item.id));

    for (const item of selected) {
      if (!before.has(item.id)) this.changes.push({ action: 'admit', id: item.id, label: item.label, reason: item.reason });
    }
    for (const item of this.workingSet) {
      if (!after.has(item.id)) this.changes.push({ action: 'evict', id: item.id, label: item.label, reason: evictionReason(item, event) });
    }

    this.workingSet = selected;
    const used = selected.reduce((sum, item) => sum + item.cost, 0);
    const relevant = selected.filter((item) => item.relevant).reduce((sum, item) => sum + item.cost, 0);
    return {
      budget: this.budget,
      used,
      density: used ? Math.round((relevant / used) * 100) : 0,
      workingSet: selected.map(publicItem),
      changes: this.changes,
      candidates: this.items.size,
    };
  }

  #upsert(candidate, event) {
    const existing = this.items.get(candidate.id);
    const granularityMultiplier = this.granularity === 'file' ? 2.8 : 1;
    const next = {
      ...existing,
      ...candidate,
      cost: Math.round(candidate.cost * granularityMultiplier),
      firstSeen: existing?.firstSeen ?? event.seq,
      lastSeen: event.seq,
      hits: (existing?.hits ?? 0) + 1,
      score: existing?.score ?? candidate.value,
      reason: candidate.reason || 'retrieval match',
    };
    this.items.set(candidate.id, next);
  }

  #rescore(item, event) {
    if (this.policy === 'append') return;
    const age = event.seq - item.lastSeen;
    let score = item.value - age * 1.4 + Math.min(item.hits * 2, 8);
    if (event.promote?.includes(item.id)) {
      score += 42;
      item.reason = `promoted by ${event.tool} evidence`;
      item.relevant = true;
    }
    if (event.contradicts?.includes(item.id)) {
      score -= this.policy === 'dynamic' ? 70 : 10;
      item.reason = 'contradicted by execution feedback';
      item.relevant = false;
    }
    if (event.file && item.path === event.file) score += 13;
    if (item.pinned) score += 100;
    item.score = clamp(Math.round(score), -100, 200);
  }

  #pack(ranked) {
    const selected = [];
    let used = 0;
    for (const item of ranked) {
      if (item.score <= 0 || used + item.cost > this.budget) continue;
      selected.push(item);
      used += item.cost;
    }
    return selected;
  }

  #appendOnly(ranked) {
    const selected = [...this.workingSet];
    let used = selected.reduce((sum, item) => sum + item.cost, 0);
    for (const item of ranked) {
      if (selected.some((selectedItem) => selectedItem.id === item.id)) continue;
      if (used + item.cost > this.budget) continue;
      selected.push(item);
      used += item.cost;
    }
    return selected;
  }
}

function evictionReason(item, event) {
  if (event.contradicts?.includes(item.id)) return 'evicted: contradicted by new test evidence';
  return item.score <= 0 ? 'evicted: value decayed below zero' : 'evicted: higher-value evidence needed the budget';
}

function publicItem(item) {
  return {
    id: item.id,
    label: item.label,
    path: item.path,
    kind: item.kind,
    cost: item.cost,
    score: item.score,
    relevant: item.relevant,
    reason: item.reason,
  };
}
