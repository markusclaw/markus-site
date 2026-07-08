# MARKUS OS — Runtime State Schema

The console (`/reports`) is the **System Console** for MARKUS OS. The **runtime state is the
source of truth**: the console reads the JSON files in `data/` and renders subsystems from them.
Reports are one *output* of the runtime, not the product.

Markus's processes should **publish** these files. Everything is optional and degrades
gracefully — a subsystem simply shows "no data" if its file is absent. Every future subsystem
(Memory, Cognition, Knowledge, etc.) must publish into this same framework so the console stays
coherent.

```
data/
  heartbeat.json      ← liveness pulse (updated frequently)
  system.json         ← identity / build / machines / interfaces
  runtime.json        ← telemetry + time-series (CPU, mem, disk, tokens, cost, latency…)
  agents.json         ← agent roster (services)
  diagnostics.json    ← severity-ranked issues (INFO/WARNING/ERROR/CRITICAL)
  events.json         ← chronological event stream (Event Stream + Timeline)
  logs.json           ← structured log tail (Logs)
  memory.json         ← memory tiers / integrity / recall (Memory)
  reasoning.json      ← cognitive performance metrics (Reasoning)
  reflection.json     ← metacognition & confidence calibration (Reflection)
  planning.json       ← goals & planning metrics (Planning)
  scheduler.json      ← cron/scheduled jobs (Scheduler)
  queues.json         ← work queues: depth/throughput (Queues)
  workloads.json      ← running/queued/blocked workloads, k8s-style (Workloads)
  automation.json     ← automation rules & triggers (Automation)
  knowledge.json      ← entities + edges (Knowledge Graph; Relationships derives)
  context.json        ← context-window slots (Context Explorer)
  evolution.json      ← trends, learning, improvement pipeline, optimizations (Phase 5)
  <YYYY-MM-DD>.json   ← nightly self-audit reports (existing)
  manifest.json       ← ["2026-07-07.json", …] list of report files
```

**Derived views (no file of their own):** *Alerts* is computed from `runtime.json` threshold
breaches + `diagnostics.json` (severity ≥ error). *Health* is a status page computed from the
kernel pulse, each subsystem's `health()`, `agents.json`, and `system.json`
(machines/interfaces). Publish good source data and these light up for free.

The console computes **health** per subsystem from these files (thresholds in `runtime.json`,
severities in `diagnostics.json`, agent statuses in `agents.json`, pulse freshness in
`heartbeat.json`) and aggregates them in Mission Control + the top status strip.

---

## heartbeat.json  (updated on every checkpoint)
```json
{ "last_pulse": "ISO-8601", "state": "active|idle|sleeping",
  "next_run": "ISO-8601", "alive_window_min": 90 }
```
Alive when `now - last_pulse <= alive_window_min`. The EKG animates when alive, flatlines otherwise.

## system.json
```json
{
  "identity": "Markus Orus", "version": "markus-2.4.1", "framework": "Claude Agent SDK",
  "model_primary": "claude-haiku-4.5", "model_fallback": "claude-sonnet-5",
  "host": "Mac mini (M2 · 16 GB)", "os": "macOS 15.5",
  "boot": "ISO-8601", "uptime_hours": 63.7,
  "machines":  [ { "name": "Gaming PC", "role": "local LLM", "status": "online|offline" } ],
  "interfaces":[ { "name": "WhatsApp", "status": "online|planned" } ]
}
```

## runtime.json  (telemetry — drives Runtime + top strip + Mission vitals)
Each metric carries the current value, optional `warn`/`crit` thresholds, and a `series` array
(oldest→newest samples) for the live line charts. Health = worst threshold breach.
```json
{
  "updated": "ISO-8601", "window_min": 60, "sample_interval_s": 90,
  "metrics": {
    "cpu_pct":     { "label":"CPU", "unit":"%", "now":14, "warn":80, "crit":95, "series":[…] },
    "mem_pct":     { "label":"Memory", "unit":"%", "now":68, "warn":85, "crit":95, "series":[…] },
    "disk_pct":    { "label":"Disk", "unit":"%", "now":98, "warn":90, "crit":97, "detail":"4.3 GB free / 245 GB", "series":[…] },
    "context_pct": { "label":"Context Window", "unit":"%", "now":42, "warn":85, "crit":95, "series":[…] },
    "tokens_min":  { "label":"Tokens/min", "unit":"", "now":5400, "series":[…] },
    "api_calls":   { "label":"API Calls/min", "unit":"", "now":6, "warn":40, "crit":60, "series":[…] },
    "latency_ms":  { "label":"Latency", "unit":"ms", "now":3200, "warn":6000, "crit":10000, "series":[…] },
    "queue_depth": { "label":"Queue Depth", "unit":"", "now":2, "warn":8, "crit":15, "series":[…] },
    "cost_usd":    { "label":"Cost (today)", "unit":"$", "now":4.12, "series":[…] }
  }
}
```
Add any new metric by dropping another entry in `metrics` — it auto-renders.

## agents.json  (agents = services)
```json
{ "updated":"ISO-8601", "agents":[
  { "name":"memory-curator", "role":"…", "model":"haiku-4.5",
    "status":"active|idle|standby|error", "current_task":"…",
    "latency_ms":820, "mem_mb":142, "queue":1, "heartbeat_s":12,
    "last_active":"ISO-8601", "deps":["memory-store"] } ] }
```

## diagnostics.json  (severity stream)
```json
{ "updated":"ISO-8601", "events":[
  { "id":"D-1042", "ts":"ISO-8601", "severity":"info|warning|error|critical",
    "subsystem":"runtime", "message":"…", "recommendation":"… (optional)" } ] }
```

## events.json  (event stream — Mission "Recent Events", future Timeline)
```json
{ "updated":"ISO-8601", "events":[
  { "ts":"ISO-8601", "type":"heartbeat|task_completed|agent_spawned|memory_cleanup|proposal|alert|report",
    "subsystem":"kernel", "message":"…" } ] }
```

## logs.json  (structured log tail — Logs subsystem)
```json
{ "updated":"ISO-8601", "retention_h":24, "lines":[
  { "ts":"ISO-8601", "level":"debug|info|warn|error", "subsystem":"runtime", "message":"…" } ] }
```
Newest-first in the viewer; filterable by level. `error` lines drive the Logs health status.

## Phase 2 · Cognition files
```json
// memory.json
{ "updated":"ISO", "tiers":{ "working":{"label":"…","used":42,"capacity":100},
    "long_term":{"label":"…","entries":127,"size_mb":8.6},
    "semantic":{"label":"…","nodes":96,"edges":214} },
  "metrics":{ "entries":127,"size_mb":8.6,"dedup_ratio":0.12,"compression_ratio":2.4,
    "conflicts":1,"orphans":4,"recall_hit_rate":0.86 },
  "recall_series":[0.84,…], "recent":[ {"ts":"ISO","op":"dedup|write|archive|conflict","detail":"…"} ] }

// reasoning.json — each metric: { label, unit, now, series }
{ "updated":"ISO", "metrics":{ "confidence":{…}, "problem_solving":{…}, "decision_latency":{…},
    "chain_length":{…}, "planning_depth":{…} },
  "counters":{ "decisions":38,"clarifications":6,"self_corrections":4,"errors_recovered":2,"hallucinations_prevented":1 } }

// reflection.json
{ "updated":"ISO", "calibration":{ "predicted":0.82,"actual":0.76,"samples":38 },
  "entries":[ {"ts":"ISO","insight":"…","action":"…","outcome":"applied|pending|rejected","confidence":0.8} ] }

// planning.json
{ "updated":"ISO", "metrics":{ "active_plans":3,"avg_depth":3.1,"avg_branching":2.4,
    "step_success_rate":0.82,"replans":2,"blocked_steps":1 },
  "goals":[ {"id":"G-01","title":"…","status":"active|blocked|done","progress":0.35,"steps_done":7,"steps_total":20} ] }
```

## Phase 3 · Execution files
```json
// scheduler.json — jobs[]: {id,name,cron,next_run,last_run,last_status:"success|failed|running|idle",avg_duration_s,enabled}
// queues.json    — queues[]: {name,depth,in_flight,rate_per_min,oldest_age_s,warn}
// workloads.json — workloads[]: {id,name,kind:"task|job|daemon",state:"running|queued|retrying|blocked|completed|failed",agent,started,duration_s,restarts,progress}
// automation.json— automations[]: {id,name,trigger:"cron|event|threshold|webhook",target,enabled,last_fired,fire_count,status:"armed|firing|disabled"}
```

## Phase 4 · Intelligence files
```json
// knowledge.json — a graph; Relationships + Semantic Search derive from it
{ "updated":"ISO",
  "nodes":[ {"id":"markus","label":"Markus Orus","type":"system|person|company|project|idea|machine|interface","weight":10} ],
  "edges":[ {"source":"greg","target":"dms","rel":"owns"} ] }

// context.json — current working-context assembly
{ "updated":"ISO", "window":{"used_tokens":84000,"max_tokens":200000,"pct":42},
  "slots":[ {"kind":"system|memory|goal|conversation|tool","label":"…","tokens":9200,"pinned":true} ] }
```
Semantic Search builds a client-side index across knowledge, memory, reflection, planning,
agents, and diagnostics — no file of its own.

## Phase 5 · Evolution file
```json
// evolution.json
{ "updated":"ISO", "window_days":14,
  "trends":{ "<metric>":{ "label":"…","unit":"%|/10|ms|…","goal":"up|down","series":[…] } },
  "learning":{ "prompts_optimized":12,"lessons_applied":18,"lessons_pending":5,
    "skills_acquired":7,"regressions":1,"self_improvement_rate":0.08,"reasoning_improvement_30d":0.14 },
  "improvements":[ {"id":"imp-…","title":"…","status":"proposed|approved|applied|measured","impact":"…","date":"ISO"} ],
  "optimizations":[ {"ts":"ISO","action":"…","metric":"…","before":6.40,"after":4.12,"unit":"$","auto":true} ],
  "milestones":[ {"date":"ISO","title":"…","kind":"capability|milestone|optimization"} ] }
```
`goal` sets whether an up or down trend counts as improving (drives the direction arrows + colors).

## reports (nightly self-audit — unchanged)
`data/<date>.json` with `scores`, `composite`, `findings`, `proposals`, `modules_run`.
Surfaced under the **Reports** subsystem; north-star metrics trend across all reports.

---

### Phase roadmap (nav reflects this)
- **Phase 0 · Kernel** — Mission Control, Runtime, Agents, Diagnostics ✅ (live)
- **Phase 1 · Observability** — Event Stream, Timeline, Logs, Alerts, Health ✅ (live)
- **Phase 2 · Cognition** — Memory, Reasoning, Reflection, Planning ✅ (live)
- **Phase 3 · Execution** — Scheduler, Queues, Workloads, Automation ✅ (live)
- **Phase 4 · Intelligence** — Knowledge Graph, Relationships, Semantic Search, Context Explorer ✅ (live)
- **Phase 5 · Evolution** — Trend Analysis, Learning Metrics, Improvement Engine, Autonomous Optimization ✅ (live)

**All phases live — MARKUS OS console is feature-complete (25 subsystems).**

Each phase publishes its own `data/<subsystem>.json` following the same shape (a health/status,
telemetry/series, and a timestamp), so it plugs straight into Mission Control and Diagnostics.
