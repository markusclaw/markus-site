#!/usr/bin/env python3
"""
MARKUS OS — State Helper Library
================================
Import this from Markus's own agent code to publish the *internal* subsystems the
OS publisher can't measure (everything Markus knows about itself). Each function
writes one runtime-state JSON file the console reads. Schemas mirror
reports/RUNTIME_STATE_SCHEMA.md — the console degrades gracefully if a field is missing.

    from markus_state import MarkusState
    st = MarkusState()  # or MarkusState("/path/to/reports/data")

    st.write_agents([
        {"name": "memory-curator", "role": "Memory hygiene", "model": "haiku-4.5",
         "status": "active", "current_task": "dedup", "latency_ms": 820, "mem_mb": 142,
         "queue": 1, "heartbeat_s": 12, "last_active": st.now(), "deps": []},
    ])
    st.append_event("task_completed", "execution", "Refactored report renderer")
    st.append_diagnostic("warning", "cognition", "Autonomy low", "Pre-load memory")

Everything is best-effort JSON with an `updated` timestamp; call whenever state changes
(or on your heartbeat). Pair with markus_publisher.py --push, or push yourself.
"""

import os
import json
import datetime as dt


class MarkusState:
    def __init__(self, data_dir=None):
        if data_dir is None:
            here = os.path.dirname(os.path.abspath(__file__))
            data_dir = os.path.join(here, "..", "reports", "data")
        self.data_dir = os.path.abspath(data_dir)

    # ---- utils ----
    def now(self):
        return dt.datetime.now(dt.timezone.utc).astimezone().replace(microsecond=0).isoformat()

    def _save(self, name, obj):
        obj.setdefault("updated", self.now())
        os.makedirs(self.data_dir, exist_ok=True)
        path = os.path.join(self.data_dir, name)
        tmp = path + ".tmp"
        with open(tmp, "w") as f:
            json.dump(obj, f, indent=2)
            f.write("\n")
        os.replace(tmp, path)
        return path

    def _load(self, name, default):
        try:
            with open(os.path.join(self.data_dir, name)) as f:
                return json.load(f)
        except Exception:
            return default

    # ---- Phase 0/1: agents, events, diagnostics ----
    def write_agents(self, agents):
        return self._save("agents.json", {"agents": list(agents)})

    def append_event(self, type, subsystem, message, ts=None, keep=60):
        ev = self._load("events.json", {"events": []})
        ev["events"].insert(0, {"ts": ts or self.now(), "type": type,
                                "subsystem": subsystem, "message": message})
        ev["events"] = ev["events"][:keep]
        ev["updated"] = self.now()
        return self._save("events.json", ev)

    def append_log(self, level, subsystem, message, ts=None, keep=200):
        lg = self._load("logs.json", {"retention_h": 24, "lines": []})
        lg["lines"].insert(0, {"ts": ts or self.now(), "level": level,
                               "subsystem": subsystem, "message": message})
        lg["lines"] = lg["lines"][:keep]
        return self._save("logs.json", lg)

    def append_diagnostic(self, severity, subsystem, message, recommendation=None,
                          id=None, ts=None, keep=50):
        dg = self._load("diagnostics.json", {"events": []})
        dg["events"].insert(0, {
            "id": id or ("D-" + dt.datetime.now().strftime("%Y%m%d%H%M%S")),
            "ts": ts or self.now(), "severity": severity, "subsystem": subsystem,
            "message": message, "recommendation": recommendation})
        dg["events"] = dg["events"][:keep]
        return self._save("diagnostics.json", dg)

    # ---- Phase 2: cognition ----
    def write_memory(self, tiers, metrics, recall_series=None, recent=None):
        obj = {"tiers": tiers, "metrics": metrics}
        if recall_series is not None:
            obj["recall_series"] = recall_series
        if recent is not None:
            obj["recent"] = recent
        return self._save("memory.json", obj)

    def write_reasoning(self, metrics, counters):
        return self._save("reasoning.json", {"metrics": metrics, "counters": counters})

    def write_reflection(self, calibration, entries):
        return self._save("reflection.json", {"calibration": calibration, "entries": entries})

    def write_planning(self, metrics, goals):
        return self._save("planning.json", {"metrics": metrics, "goals": goals})

    # ---- Phase 3: execution ----
    def write_scheduler(self, jobs):
        return self._save("scheduler.json", {"jobs": jobs})

    def write_queues(self, queues):
        return self._save("queues.json", {"queues": queues})

    def write_workloads(self, workloads):
        return self._save("workloads.json", {"workloads": workloads})

    def write_automation(self, automations):
        return self._save("automation.json", {"automations": automations})

    # ---- Phase 4: intelligence ----
    def write_knowledge(self, nodes, edges):
        return self._save("knowledge.json", {"nodes": nodes, "edges": edges})

    def write_context(self, window, slots):
        return self._save("context.json", {"window": window, "slots": slots})

    # ---- Phase 5: evolution ----
    def write_evolution(self, trends, learning, improvements, optimizations,
                        milestones=None, window_days=14):
        return self._save("evolution.json", {
            "window_days": window_days, "trends": trends, "learning": learning,
            "improvements": improvements, "optimizations": optimizations,
            "milestones": milestones or []})

    # ---- runtime metric (for Markus-internal metrics: tokens, cost, latency…) ----
    def update_runtime_metric(self, key, value, length=40):
        rt = self._load("runtime.json", {"window_min": 60, "metrics": {}})
        m = rt.setdefault("metrics", {}).setdefault(key, {"label": key, "unit": "", "series": []})
        s = m.get("series") or []
        s.append(round(value, 2))
        m["series"] = s[-length:]
        m["now"] = round(value, 2)
        rt["updated"] = self.now()
        return self._save("runtime.json", rt)

    # ---- reports (nightly self-audit) ----
    def write_report(self, date, report, add_to_manifest=True):
        self._save(f"{date}.json", dict(report, date=date))
        if add_to_manifest:
            man = self._load("manifest.json", [])
            if isinstance(man, dict):
                man = man.get("reports", [])
            fname = f"{date}.json"
            if fname not in man:
                man.insert(0, fname)
            self._save_raw("manifest.json", man)
        return f"{date}.json"

    def _save_raw(self, name, obj):
        path = os.path.join(self.data_dir, name)
        with open(path, "w") as f:
            json.dump(obj, f, indent=2)
            f.write("\n")
        return path


if __name__ == "__main__":
    # smoke test into ./_demo_data
    st = MarkusState(os.path.join(os.path.dirname(__file__), "_demo_data"))
    st.write_agents([{"name": "demo", "role": "test", "model": "haiku-4.5",
                      "status": "active", "current_task": "smoke", "latency_ms": 100,
                      "mem_mb": 10, "queue": 0, "heartbeat_s": 1, "last_active": st.now(), "deps": []}])
    st.append_event("heartbeat", "kernel", "demo pulse")
    print("wrote demo state to", st.data_dir)
