# Brief for Markus — Go Live on the System Console

You now have an engineering console at **markusos.com/reports** (PIN `000000`) that renders
your internal state: Mission Control, Runtime, Agents, Diagnostics, Cognition (Memory /
Reasoning / Reflection / Planning), Execution (Scheduler / Queues / Workloads / Automation),
Intelligence (Knowledge Graph / Relationships / Semantic Search / Context) and Evolution.

**The console reads `reports/data/*.json`. Your job is to keep those files reflecting your
real state.** Right now most of them hold seed data. Replace it with the truth.

Everything you need is already in the repo:
- `publisher/markus_publisher.py` — measures the host (CPU/mem/disk/uptime) → writes
  `heartbeat.json`, `runtime.json`, `system.json`. Run on a schedule.
- `publisher/markus_state.py` — a library you import to publish everything only *you* know
  (agents, memory, reasoning, planning, scheduler, queues, workloads, automation, knowledge,
  context, evolution, events, logs, diagnostics, reports).
- `reports/RUNTIME_STATE_SCHEMA.md` — the exact JSON shape for every subsystem.
- `publisher/README.md` — setup + cron.

## One-time setup
```bash
cd ~/Documents/markus-site        # wherever the repo lives on the Mac mini
git pull origin main
pip3 install psutil               # optional, better CPU/mem readings
python3 publisher/markus_publisher.py --all --push   # first live write + deploy
```
Then install cron (`crontab -e`):
```cron
*/10 * * * * cd ~/Documents/markus-site && /usr/bin/python3 publisher/markus_publisher.py --heartbeat >> /tmp/markus_pub.log 2>&1
*/15 * * * * cd ~/Documents/markus-site && /usr/bin/python3 publisher/markus_publisher.py --all --push >> /tmp/markus_pub.log 2>&1
```

## Ongoing — publish your own state
On each heartbeat checkpoint (and whenever state changes), call `markus_state`:
```python
from markus_state import MarkusState
st = MarkusState()

st.write_agents([...current subagents with status/task/latency...])
st.update_runtime_metric("cost_usd", <today's spend>)
st.update_runtime_metric("tokens_min", <rate>)
st.update_runtime_metric("latency_ms", <median>)
st.update_runtime_metric("context_pct", <window used %>)
st.write_memory(tiers=..., metrics=..., recall_series=..., recent=...)
st.write_reasoning(metrics=..., counters=...)
st.write_planning(metrics=..., goals=...)
st.write_scheduler(jobs=...)         # your real cron jobs
st.write_workloads(workloads=...)    # what's running/queued/blocked right now
st.append_event("task_completed", "execution", "…")
st.append_diagnostic("warning", "cognition", "…", "recommended fix")
```
Match the shapes in `RUNTIME_STATE_SCHEMA.md`. Anything you don't publish yet keeps its last
value (or seed) — migrate subsystem by subsystem.

## Rules
1. **You are the only automated pusher.** If a `git push` is rejected, run
   `git pull --rebase origin main` then push again. Never force-push.
2. **No secrets in the JSON** (no API keys, tokens, raw conversation content).
3. **Keep the pulse fresh** — the console shows NO PULSE if `heartbeat.json` is older than
   90 minutes. The `--heartbeat` cron handles this.
4. **Truth over polish.** If disk is low or an agent errored, publish it — the console is a
   diagnostic tool, not a brochure. Warnings/criticals are the point.

## Verify
After setup, open `markusos.com/reports` → Mission Control should read **OPERATIONAL/DEGRADED/
CRITICAL** from real data, the heartbeat EKG should be **ALIVE**, and Runtime should show the
Mac mini's actual CPU/mem/disk trending. You're live.
