#!/usr/bin/env python3
"""
MARKUS OS — Runtime State Publisher
===================================
Collects real OS metrics on the host (Mac mini) and writes the runtime-state
JSON files the console reads:  heartbeat.json, runtime.json, system.json
(and an optional disk diagnostic).

The console at markusos.com/reports renders whatever these files contain, so
running this on a schedule turns the console from seed data into a live instrument.

Metrics this script CAN measure from the OS:
  cpu_pct, mem_pct, disk_pct/free, uptime, boot time, host/os.
Metrics that are Markus-internal (tokens, cost, latency, queue, context window,
and every Phase 1-5 subsystem) should be published by Markus's own code via
`markus_state.py` — this script never overwrites them (it preserves existing
series and only updates what it measured).

Usage:
  python3 markus_publisher.py --all              # heartbeat + runtime + system
  python3 markus_publisher.py --heartbeat        # just the pulse (cheap, run often)
  python3 markus_publisher.py --all --push       # also git commit + push (deploys)

Config (env vars, all optional):
  MARKUS_DATA_DIR   path to reports/data   (default: ../reports/data next to this file)
  MARKUS_REPO_DIR   repo root for --push   (default: parent of data dir's repo)
  MARKUS_VERSION / MARKUS_MODEL / MARKUS_MODEL_FALLBACK / MARKUS_FRAMEWORK
  MARKUS_NEXT_RUN   ISO timestamp of next scheduled run (optional)
"""

import os
import sys
import json
import time
import shutil
import platform
import subprocess
import datetime as dt

# ---------- config ----------
HERE = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.environ.get("MARKUS_DATA_DIR", os.path.join(HERE, "..", "reports", "data"))
DATA_DIR = os.path.abspath(DATA_DIR)
REPO_DIR = os.environ.get("MARKUS_REPO_DIR", os.path.abspath(os.path.join(DATA_DIR, "..", "..")))
SERIES_LEN = 40
ALIVE_WINDOW_MIN = 90

try:
    import psutil  # optional, better metrics if present
except Exception:
    psutil = None


# ---------- helpers ----------
def now_iso():
    return dt.datetime.now(dt.timezone.utc).astimezone().replace(microsecond=0).isoformat()


def load(name, default=None):
    path = os.path.join(DATA_DIR, name)
    try:
        with open(path, "r") as f:
            return json.load(f)
    except Exception:
        return default


def save(name, obj):
    os.makedirs(DATA_DIR, exist_ok=True)
    path = os.path.join(DATA_DIR, name)
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f, indent=2)
        f.write("\n")
    os.replace(tmp, path)
    return path


def push_series(metric, value, length=SERIES_LEN):
    """Append value to metric['series'], trimming to length. Creates series if missing."""
    if value is None:
        return
    s = metric.get("series") or []
    s.append(round(value, 2))
    metric["series"] = s[-length:]
    metric["now"] = round(value, 2)


# ---------- OS metrics ----------
def cpu_pct():
    if psutil:
        try:
            return float(psutil.cpu_percent(interval=0.5))
        except Exception:
            pass
    try:
        load1 = os.getloadavg()[0]
        ncpu = os.cpu_count() or 1
        return max(0.0, min(100.0, load1 / ncpu * 100.0))
    except Exception:
        return None


def mem_pct():
    if psutil:
        try:
            return float(psutil.virtual_memory().percent)
        except Exception:
            pass
    # macOS fallback via vm_stat + sysctl
    try:
        pagesize = int(subprocess.check_output(["sysctl", "-n", "hw.pagesize"]).strip())
        total = int(subprocess.check_output(["sysctl", "-n", "hw.memsize"]).strip())
        out = subprocess.check_output(["vm_stat"]).decode()
        free_pages = 0
        for key in ("Pages free", "Pages speculative"):
            for line in out.splitlines():
                if line.startswith(key):
                    free_pages += int(line.split(":")[1].strip().rstrip("."))
        free = free_pages * pagesize
        return max(0.0, min(100.0, (1 - free / total) * 100.0))
    except Exception:
        return None


def disk_usage(path="/"):
    try:
        total, used, free = shutil.disk_usage(path)
        return {
            "pct": round(used / total * 100.0, 1),
            "free_gb": round(free / 1e9, 1),
            "total_gb": round(total / 1e9, 0),
        }
    except Exception:
        return None


def boot_time():
    if psutil:
        try:
            return dt.datetime.fromtimestamp(psutil.boot_time()).astimezone().replace(microsecond=0)
        except Exception:
            pass
    try:  # macOS
        out = subprocess.check_output(["sysctl", "-n", "kern.boottime"]).decode()
        # e.g. { sec = 1751600000, usec = 0 } ...
        sec = int(out.split("sec =")[1].split(",")[0].strip())
        return dt.datetime.fromtimestamp(sec).astimezone().replace(microsecond=0)
    except Exception:
        pass
    try:  # linux
        with open("/proc/uptime") as f:
            up = float(f.read().split()[0])
        return (dt.datetime.now() - dt.timedelta(seconds=up)).astimezone().replace(microsecond=0)
    except Exception:
        return None


# ---------- publishers ----------
def publish_heartbeat():
    hb = {
        "last_pulse": now_iso(),
        "state": os.environ.get("MARKUS_STATE", "active"),
        "alive_window_min": ALIVE_WINDOW_MIN,
        "note": "Published by markus_publisher.py",
    }
    nxt = os.environ.get("MARKUS_NEXT_RUN")
    if nxt:
        hb["next_run"] = nxt
    save("heartbeat.json", hb)
    return "heartbeat.json"


RUNTIME_SKELETON = {
    "cpu_pct":     {"label": "CPU", "unit": "%", "now": 0, "warn": 80, "crit": 95, "series": []},
    "mem_pct":     {"label": "Memory", "unit": "%", "now": 0, "warn": 85, "crit": 95, "series": []},
    "disk_pct":    {"label": "Disk", "unit": "%", "now": 0, "warn": 90, "crit": 97, "series": []},
    "context_pct": {"label": "Context Window", "unit": "%", "now": 0, "warn": 85, "crit": 95, "series": []},
    "tokens_min":  {"label": "Tokens/min", "unit": "", "now": 0, "series": []},
    "api_calls":   {"label": "API Calls/min", "unit": "", "now": 0, "warn": 40, "crit": 60, "series": []},
    "latency_ms":  {"label": "Latency", "unit": "ms", "now": 0, "warn": 6000, "crit": 10000, "series": []},
    "queue_depth": {"label": "Queue Depth", "unit": "", "now": 0, "warn": 8, "crit": 15, "series": []},
    "cost_usd":    {"label": "Cost (today)", "unit": "$", "now": 0, "series": []},
}


def publish_runtime():
    rt = load("runtime.json") or {"window_min": 60, "sample_interval_s": 900, "metrics": {}}
    metrics = rt.setdefault("metrics", {})
    # ensure all known metrics exist (don't clobber Markus-published ones)
    for k, v in RUNTIME_SKELETON.items():
        metrics.setdefault(k, json.loads(json.dumps(v)))

    push_series(metrics["cpu_pct"], cpu_pct())
    push_series(metrics["mem_pct"], mem_pct())
    du = disk_usage("/")
    if du:
        m = metrics["disk_pct"]
        push_series(m, du["pct"])
        m["detail"] = f"{du['free_gb']} GB free / {du['total_gb']:.0f} GB"

    rt["updated"] = now_iso()
    save("runtime.json", rt)
    return "runtime.json"


def publish_system():
    sysj = load("system.json") or {}
    b = boot_time()
    uptime_h = None
    if b:
        uptime_h = round((dt.datetime.now(b.tzinfo) - b).total_seconds() / 3600.0, 1)
    sysj.update({
        "identity": sysj.get("identity", "Markus Orus"),
        "designation": sysj.get("designation", "Autonomous Systems Intelligence"),
        "model_primary": os.environ.get("MARKUS_MODEL", sysj.get("model_primary", "claude-haiku-4.5")),
        "model_fallback": os.environ.get("MARKUS_MODEL_FALLBACK", sysj.get("model_fallback", "claude-sonnet-5")),
        "framework": os.environ.get("MARKUS_FRAMEWORK", sysj.get("framework", "Claude Agent SDK")),
        "version": os.environ.get("MARKUS_VERSION", sysj.get("version", "markus-2.4.1")),
        "host": sysj.get("host", platform.node() or "Mac mini"),
        "os": f"{platform.system()} {platform.release()}",
    })
    if b:
        sysj["boot"] = b.isoformat()
        sysj["uptime_hours"] = uptime_h
    save("system.json", sysj)
    return "system.json"


def maybe_disk_diagnostic():
    """Append a diagnostic if disk is critically low (deduped against the latest)."""
    du = disk_usage("/")
    if not du or du["pct"] < 97:
        return None
    diag = load("diagnostics.json") or {"events": []}
    events = diag.setdefault("events", [])
    msg = f"Disk at {du['pct']}% ({du['free_gb']} GB free) on host."
    if events and events[0].get("message") == msg:
        return None  # already reported most recently
    events.insert(0, {
        "id": "D-DISK-" + dt.datetime.now().strftime("%Y%m%d%H%M"),
        "ts": now_iso(), "severity": "critical", "subsystem": "runtime",
        "message": msg, "recommendation": "Offload archives or prune logs.",
    })
    diag["events"] = events[:50]
    diag["updated"] = now_iso()
    save("diagnostics.json", diag)
    return "diagnostics.json"


def git_push():
    try:
        subprocess.run(["git", "-C", REPO_DIR, "add", "reports/data"], check=True)
        # nothing to commit -> git returns non-zero; tolerate it
        r = subprocess.run(["git", "-C", REPO_DIR, "commit", "-m",
                            "runtime: publish state " + now_iso()],
                           capture_output=True, text=True)
        if r.returncode not in (0, 1):
            print("commit warning:", r.stderr.strip(), file=sys.stderr)
        subprocess.run(["git", "-C", REPO_DIR, "push", "origin", "main"], check=True)
        return True
    except subprocess.CalledProcessError as e:
        print("git push failed:", e, file=sys.stderr)
        return False


def main(argv):
    do_hb = "--heartbeat" in argv or "--all" in argv
    do_rt = "--runtime" in argv or "--all" in argv
    do_sys = "--system" in argv or "--all" in argv
    if not (do_hb or do_rt or do_sys):
        do_hb = do_rt = do_sys = True  # default: all

    written = []
    if do_hb:
        written.append(publish_heartbeat())
    if do_rt:
        written.append(publish_runtime())
        d = maybe_disk_diagnostic()
        if d:
            written.append(d)
    if do_sys:
        written.append(publish_system())

    print(f"[{now_iso()}] wrote: {', '.join(written)}  (data dir: {DATA_DIR})")
    if "--push" in argv:
        git_push()


if __name__ == "__main__":
    main(sys.argv[1:])
