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
  events.json         ← chronological event stream
  <YYYY-MM-DD>.json   ← nightly self-audit reports (existing)
  manifest.json       ← ["2026-07-07.json", …] list of report files
```

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

## reports (nightly self-audit — unchanged)
`data/<date>.json` with `scores`, `composite`, `findings`, `proposals`, `modules_run`.
Surfaced under the **Reports** subsystem; north-star metrics trend across all reports.

---

### Phase roadmap (nav reflects this)
- **Phase 0 · Kernel** — Mission Control, Runtime, Agents, Diagnostics ✅ (live)
- **Phase 1 · Observability** — Event Stream, Timeline, Logs, Alerts, Health
- **Phase 2 · Cognition** — Memory, Reasoning, Reflection, Planning
- **Phase 3 · Execution** — Scheduler, Queues, Workloads, Automation
- **Phase 4 · Intelligence** — Knowledge Graph, Relationships, Semantic Search, Context Explorer
- **Phase 5 · Evolution** — Trend Analysis, Learning Metrics, Improvement Engine, Autonomous Optimization

Each phase publishes its own `data/<subsystem>.json` following the same shape (a health/status,
telemetry/series, and a timestamp), so it plugs straight into Mission Control and Diagnostics.
