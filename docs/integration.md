# Agent harness integration

## Event contract

`POST /api/v1/events` accepts one JSON object. Only `runId` and `tool` are strongly recommended; missing fields receive safe defaults.

| Field | Type | Meaning |
|---|---|---|
| `runId` | string | stable trajectory or trace ID |
| `spanId` | string | optional source span ID |
| `seq` | number | monotonic tool/model sequence |
| `tool` | string | `model`, `search`, `read`, `edit`, `revert`, `test`, or custom |
| `input`, `output` | string | normalized into an equivalence fingerprint |
| `tokens` | number | input plus output tokens for the step |
| `durationMs` | number | step wall-clock duration |
| `file` | string | primary repository path touched |
| `test` | object | `{ passing, total }` |
| `progress` | boolean | explicit harness progress signal |
| `evidence` | string[] | newly learned, verifiable facts |
| `contradiction` | boolean | execution contradicts active direction |
| `candidates` | object[] | context candidates discovered this step |
| `promote` | string[] | candidate IDs promoted by evidence |
| `contradicts` | string[] | candidate IDs devalued by evidence |

## Context candidate contract

```json
{
  "id": "dispatch-job",
  "label": "dispatchJob()",
  "path": "src/scheduler/dispatch.ts",
  "kind": "symbol",
  "cost": 840,
  "value": 72,
  "relevant": true,
  "reason": "caller in failing stack"
}
```

`cost` is the estimated serialized token count. `value` is a 0–100 prior that can combine lexical similarity, embeddings, dependency distance, repository topology, recency, and test evidence.

## Circuit-breaker integration

Treat the response as advisory first:

1. log `decision`, `score`, and `intervention` beside the original span;
2. measure false-positive interventions on historical runs;
3. enable steering at the `intervene` threshold;
4. enforce `terminate` only after calibrating against trajectories that recovered naturally.

The prototype uses two thresholds: intervention at 58 and termination at 32, with a minimum number of observed calls.

## OTel adapter sketch

An OpenTelemetry span processor can map completed spans into the event contract. Keep raw traces in the observability backend; send only features needed for online control to this service. That keeps the control path small and avoids turning the prototype into another trace store.

Recommended attributes:

```text
agent.run_id
gen_ai.tool.name
gen_ai.usage.input_tokens
gen_ai.usage.output_tokens
code.filepath
test.passing
test.total
agent.evidence.count
agent.hypothesis.id
```

For sensitive repositories, hash tool inputs and outputs inside the harness and provide the hash as `fingerprint`; the supervisor does not need source contents to detect exact or equivalent repetition.
