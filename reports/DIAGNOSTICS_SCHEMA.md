# Markus Reports — Diagnostics & Heartbeat Schema

The reports dashboard renders an engineer-grade "internals" console (vitals, system
diagnostics, active agents). All of it is data-driven: the UI reads these files and
degrades gracefully when a field is missing. For live data, Markus's report generator
should emit the blocks below.

Everything is **optional** — panels only render when their data is present.

---

## 1. `data/heartbeat.json`  (liveness / pulse)

Written/touched by Markus on **every heartbeat checkpoint** (not just the 3am run) so the
site can show a live pulse. The dashboard computes "alive" as
`now - last_pulse <= alive_window_min`.

```json
{
  "last_pulse": "2026-07-07T14:44:00-06:00",   // ISO 8601, required
  "state": "active",                            // active | idle | sleeping (optional)
  "next_run": "2026-07-08T03:00:00-06:00",      // ISO 8601 (optional)
  "alive_window_min": 90                        // minutes; default 90 (optional)
}
```

- If `last_pulse` is within `alive_window_min`, the EKG animates and shows **ALIVE**.
- Otherwise it flatlines and shows **NO PULSE**.
- The dashboard re-checks every 15s, so just keep `last_pulse` fresh.

---

## 2. `report.diagnostics`  (per-day telemetry)

Add a `diagnostics` object to each daily report JSON (alongside `scores`, `findings`, etc.).

```json
"diagnostics": {
  "build": {
    "identity": "Markus Orus",
    "model_primary": "claude-haiku-4.5",
    "model_fallback": "claude-sonnet-5",
    "framework": "Claude Agent SDK",
    "version": "markus-2.4.1",
    "host": "Mac mini (M2 · 16 GB)",
    "os": "macOS 15.5",
    "uptime_hours": 63.7,
    "boot": "2026-07-04T23:44:00-06:00"
  },
  "runtime": {
    "cpu_pct": 12,                 // 0-100
    "mem_pct": 68,                 // 0-100
    "disk_free_gb": 4.3,
    "disk_total_gb": 245,
    "median_latency_ms": 3200,
    "endpoints": [
      { "name": "anthropic-api", "url": "api.anthropic.com", "status": "online" },
      { "name": "ollama (gaming-pc)", "url": "10.0.0.2:11434", "status": "offline" }
    ]
  },
  "cost": {
    "spend_usd": 4.12,
    "tokens_in": 812000,
    "tokens_out": 143000,
    "api_calls": 47,
    "routing": { "haiku_pct": 82, "sonnet_pct": 18 }
  },
  "memory": {
    "files": 127,
    "size_mb": 8.6,
    "dedup_removed": 3,
    "contexts_loaded": 5
  },
  "activity": {
    "sessions": 6,
    "tasks_total": 14,
    "tasks_completed": 11,
    "git_commits": 2,
    "errors": 0,
    "warnings": 1
  }
}
```

Notes:
- `endpoints[].status`: `online` → green dot, `offline`/`down` → red, anything else → grey.
- `cpu_pct` / `mem_pct` / disk usage show micro-bars; ≥85% tints amber.
- The **Build & Identity** strip in the top vitals bar reads from `diagnostics.build` of the
  **latest** report.

---

## 3. `report.agents`  (active agent roster)

Array of the subagents/workers Markus ran or is working with during that report window.

```json
"agents": [
  {
    "name": "memory-curator",
    "role": "Memory hygiene & dedup",
    "model": "haiku-4.5",
    "status": "active",              // active/online → green · idle/standby → grey · error → red
    "tasks": 3,
    "last_active": "2026-07-06T02:58:00-06:00"
  }
]
```

The section header shows an `N/total online` count (active/online statuses).

---

## Rendering summary

| Data | Where it shows | Source report |
|---|---|---|
| `heartbeat.json` | Top vitals bar (EKG + ALIVE/NO PULSE) | live file |
| `diagnostics.build` | Top vitals "Build & Identity" strip | latest report |
| `diagnostics.runtime/cost/memory/activity` | "System Diagnostics" panels | selected report |
| `agents[]` | "Active Agents" table | selected report |

Missing blocks are simply skipped — safe to roll out incrementally.
