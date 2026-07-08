# MARKUS OS — Runtime State Publisher

Turns the console at **markusos.com/reports** from seed data into a live instrument.
The console reads `reports/data/*.json`; these scripts write them from real state.

Two pieces:

| Script | Who runs it | Writes |
|---|---|---|
| `markus_publisher.py` | cron on the Mac mini | `heartbeat.json`, `runtime.json` (CPU/mem/disk), `system.json`, disk `diagnostics.json` |
| `markus_state.py` | Markus's own agent code | everything Markus knows about itself: `agents`, `memory`, `reasoning`, `planning`, `scheduler`, `queues`, `workloads`, `automation`, `knowledge`, `context`, `evolution`, `events`, `logs`, reports |

The OS can only measure CPU/mem/disk/uptime. Tokens, cost, latency, and every Phase 1–5
subsystem are things only Markus knows — those come from `markus_state.py`, called from
Markus's code. The publisher never overwrites Markus-published metrics (it preserves series).

---

## Setup

```bash
# optional but recommended for accurate CPU/mem:
pip3 install psutil
```

No other dependencies — pure standard library otherwise (falls back to load average / vm_stat).

### Config (env vars, all optional)
- `MARKUS_DATA_DIR` — path to `reports/data` (default: `../reports/data` next to the script)
- `MARKUS_REPO_DIR` — repo root for `--push` (default: inferred)
- `MARKUS_VERSION`, `MARKUS_MODEL`, `MARKUS_MODEL_FALLBACK`, `MARKUS_FRAMEWORK`
- `MARKUS_NEXT_RUN` — ISO timestamp shown as "next run"

---

## Run

```bash
python3 publisher/markus_publisher.py --all           # heartbeat + runtime + system
python3 publisher/markus_publisher.py --heartbeat     # just the pulse (cheap)
python3 publisher/markus_publisher.py --all --push    # also git commit + push → deploys
```

`--push` runs `git add reports/data && git commit && git push origin main`, which triggers a
Cloudflare Pages redeploy — so the live console updates within a minute.

### Cron (Mac mini — `crontab -e`)
```cron
# fresh pulse every 10 min so the heartbeat stays ALIVE
*/10 * * * * cd /Users/grego/Documents/markus-site && /usr/bin/python3 publisher/markus_publisher.py --heartbeat >> /tmp/markus_pub.log 2>&1

# full telemetry + deploy every 15 min
*/15 * * * * cd /Users/grego/Documents/markus-site && /usr/bin/python3 publisher/markus_publisher.py --all --push >> /tmp/markus_pub.log 2>&1
```

---

## Publishing internal subsystems from Markus's code

```python
from markus_state import MarkusState
st = MarkusState()  # defaults to ../reports/data

st.write_agents([
    {"name": "memory-curator", "role": "Memory hygiene", "model": "haiku-4.5",
     "status": "active", "current_task": "dedup", "latency_ms": 820, "mem_mb": 142,
     "queue": 1, "heartbeat_s": 12, "last_active": st.now(), "deps": []},
])

# Markus-internal runtime metrics the OS can't see:
st.update_runtime_metric("cost_usd", 4.12)
st.update_runtime_metric("latency_ms", 3200)
st.update_runtime_metric("context_pct", 42)

st.append_event("task_completed", "execution", "Refactored report renderer")
st.append_diagnostic("warning", "cognition", "Autonomy low", "Pre-load memory at session start")
```

Full method list mirrors `reports/RUNTIME_STATE_SCHEMA.md`:
`write_memory / write_reasoning / write_reflection / write_planning / write_scheduler /
write_queues / write_workloads / write_automation / write_knowledge / write_context /
write_evolution / write_report / append_event / append_log / append_diagnostic`.

Call them whenever state changes (or on your heartbeat), then let the cron `--push` job deploy —
or push yourself.

---

## Notes
- **Deploy loop:** write files → `git push` → Cloudflare rebuilds → live console. No server needed.
- **Concurrency:** if Markus and you both push, a push can be rejected; pull/rebase or use the
  save-and-overlay pattern. Keeping the publisher as the only automated pusher avoids most conflicts.
- **Exposure:** this `publisher/` folder is in the site repo, so the `.py` files are reachable at
  `markusos.com/publisher/`. They contain no secrets (all config via env). If you'd rather they not
  be public, move this folder out of the repo and point `MARKUS_DATA_DIR` at `reports/data` — the
  scripts work from anywhere.
