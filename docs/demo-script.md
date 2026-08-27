# 10-minute live demo script

## Before the session

1. Run `npm test`.
2. Run `npm start` and open `http://127.0.0.1:4318` at 80–90% browser zoom.
3. Keep a second terminal ready in the repository.
4. Do not enable Datadog export unless the venue connection has already been verified.

## 0:00–1:00 — frame the problem

Show **How it works**. The key line is: infrastructure health is not trajectory health. The agent can be responsive, error-free, and still be wasting its future.

## 1:00–3:30 — healthy run becomes unhealthy

1. Return to **Live run**.
2. Select **Healthy recovery**, **Hybrid**, **Dynamic**, **8K**, **Symbol slices**.
3. Launch the run.
4. Point out novel evidence, improving tests, and the working-set admission log.
5. Immediately after “Establish test baseline,” click **Force bad trajectory**.
6. Narrate the falling novelty and rising calls-since-progress.
7. Pause briefly on `INTERVENE`: this is a steerable state, not merely a warning.
8. Let the circuit open. Call out projected tokens avoided.

If the click is late, simply launch another healthy run; runs are isolated and deterministic.

## 3:30–5:00 — counterfactual replay

1. Open **Counterfactual replay**.
2. Choose **Edit / test churn**.
3. Run the counterfactual.
4. Compare calls, tokens, and runtime—not only final success/failure.
5. Name the new metric: **post-progress waste**, the resources spent after the final measurable improvement.

## 5:00–7:30 — context is a runtime cache

1. Return to **Live run**.
2. Select **Persistent bad hypothesis**, **Dynamic**, **4K**, **Whole files**.
3. Launch the run.
4. Point out the high-value but misleading `LegacyBackoff` admission.
5. At contradictory test evidence, show it being evicted while `dispatchJob`, `LeaseClock`, and the failing test are promoted.
6. Repeat with **Append-only** to show stale context surviving because the policy cannot forget.

## 7:30–9:00 — real integration

In the second terminal, run:

```bash
npm run demo
```

The external run appears through the same live stream. Explain that `/api/v1/events` is the adapter boundary; an agent harness posts OTel span-derived events and receives a decision synchronously.

## 9:00–10:00 — close

The two audience questions are:

1. Given the observed trajectory, is one more call worth its cost?
2. Given one more context token, what should we remove to make room?

## Offline fallback

The application, scenarios, fonts, charts, replay, and tests have zero third-party runtime dependencies. If all networking fails, the full simulator remains functional on localhost. If localhost cannot be shown, use the screenshots captured during rehearsal and narrate the same deterministic step numbers.
