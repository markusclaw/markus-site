/* MARKUS OS — System Console
   Runtime state (data/*.json) is the source of truth. Reports are one output. */

const EXPECTED_PIN = '000000';
var DATA = { system: null, runtime: null, agents: null, diagnostics: null, events: null, logs: null, heartbeat: null, memory: null, reasoning: null, reflection: null, planning: null, scheduler: null, queues: null, workloads: null, automation: null, knowledge: null, context: null, reports: [] };
let hbTimer = null, vitals = null, currentRoute = 'mission';

/* ============================ helpers ============================ */
function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function fmt1(n) { return (typeof n === 'number' && !isNaN(n)) ? String(Math.round(n * 10) / 10) : '—'; }
function fmtNum(n) {
    if (typeof n !== 'number' || isNaN(n)) return '—';
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(Math.abs(n) >= 1e7 ? 0 : 1) + 'M';
    if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(Math.abs(n) >= 1e4 ? 0 : 1) + 'K';
    return String(Math.round(n * 100) / 100);
}
function relTime(iso) {
    const d = new Date(iso); if (isNaN(d)) return '—';
    let s = Math.floor((Date.now() - d.getTime()) / 1000); if (s < 0) s = 0;
    if (s < 60) return s + 's ago';
    const m = Math.floor(s / 60); if (m < 60) return m + 'm ago';
    const h = Math.floor(m / 60); if (h < 24) return h + 'h ' + (m % 60) + 'm ago';
    return Math.floor(h / 24) + 'd ago';
}
function clockTime(iso) { const d = new Date(iso); return isNaN(d) ? '—' : d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false }); }
function sevRank(s) { return ({ info: 0, warning: 1, error: 2, critical: 3 })[String(s || '').toLowerCase()] || 0; }
function statusClass(s) {
    s = String(s || '').toLowerCase();
    if (['online', 'active', 'ok', 'nominal', 'operational', 'up'].includes(s)) return 'ok';
    if (['warn', 'warning', 'degraded'].includes(s)) return 'warn';
    if (['offline', 'error', 'down', 'critical', 'crit', 'dead'].includes(s)) return 'bad';
    return 'dim'; // idle, standby, unknown
}
function sdot(s) { return `<span class="sdot ${statusClass(s)}"></span>`; }

/* line chart (telemetry) */
function lineChart(series, opt) {
    opt = opt || {};
    const W = opt.w || 320, H = opt.h || 56, m = 6;
    if (!series || !series.length) return '';
    let lo = Math.min.apply(null, series), hi = Math.max.apply(null, series);
    if (opt.warn != null) hi = Math.max(hi, opt.warn);
    if (opt.crit != null) hi = Math.max(hi, opt.crit);
    if (hi - lo < 1e-6) hi = lo + 1;
    const pad = (hi - lo) * 0.14; lo -= pad; hi += pad; const rng = hi - lo || 1;
    const n = series.length;
    const X = (i) => n === 1 ? W : (i / (n - 1)) * W;
    const Y = (v) => m + (1 - (v - lo) / rng) * (H - 2 * m);
    const pts = series.map((v, i) => [X(i), Y(v)]);
    const poly = pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
    const area = `M0,${H} L` + pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' L') + ` L${W},${H} Z`;
    const last = pts[pts.length - 1];
    let thr = '';
    if (opt.warn != null && opt.warn >= lo && opt.warn <= hi) thr += `<line class="thr warn" x1="0" x2="${W}" y1="${Y(opt.warn).toFixed(1)}" y2="${Y(opt.warn).toFixed(1)}"/>`;
    if (opt.crit != null && opt.crit >= lo && opt.crit <= hi) thr += `<line class="thr crit" x1="0" x2="${W}" y1="${Y(opt.crit).toFixed(1)}" y2="${Y(opt.crit).toFixed(1)}"/>`;
    const cls = opt.state ? ' ' + opt.state : '';
    return `<svg class="lc${cls}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
        <path class="lc-area" d="${area}"/>${thr}
        <polyline class="lc-line" points="${poly}" vector-effect="non-scaling-stroke"/>
        <circle class="lc-dot" cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2.3" vector-effect="non-scaling-stroke"/>
    </svg>`;
}

/* ============================ data ============================ */
async function getJSON(path) { try { const r = await fetch(path); return r.ok ? await r.json() : null; } catch (e) { return null; } }

async function loadAll() {
    const j = getJSON;
    const [system, runtime, agents, diagnostics, events, logs, heartbeat, memory, reasoning, reflection, planning,
        scheduler, queues, workloads, automation, knowledge, context, manifest] = await Promise.all([
        j('./data/system.json'), j('./data/runtime.json'), j('./data/agents.json'), j('./data/diagnostics.json'),
        j('./data/events.json'), j('./data/logs.json'), j('./data/heartbeat.json'), j('./data/memory.json'),
        j('./data/reasoning.json'), j('./data/reflection.json'), j('./data/planning.json'), j('./data/scheduler.json'),
        j('./data/queues.json'), j('./data/workloads.json'), j('./data/automation.json'), j('./data/knowledge.json'),
        j('./data/context.json'), j('./data/manifest.json')
    ]);
    DATA.system = system; DATA.runtime = runtime; DATA.agents = agents;
    DATA.diagnostics = diagnostics; DATA.events = events; DATA.logs = logs; DATA.heartbeat = heartbeat;
    DATA.memory = memory; DATA.reasoning = reasoning; DATA.reflection = reflection; DATA.planning = planning;
    DATA.scheduler = scheduler; DATA.queues = queues; DATA.workloads = workloads; DATA.automation = automation;
    DATA.knowledge = knowledge; DATA.context = context;
    const files = Array.isArray(manifest) ? manifest : (manifest && manifest.reports) || [];
    const reports = [];
    for (const f of files) { const r = await getJSON('./data/' + f); if (r) reports.push(r); }
    reports.sort((a, b) => new Date(b.date) - new Date(a.date));
    DATA.reports = reports;
}

/* ============================ health registry ============================ */
function metricState(m) {
    if (!m) return 'ok';
    if (m.crit != null && m.now >= m.crit) return 'crit';
    if (m.warn != null && m.now >= m.warn) return 'warn';
    return 'ok';
}
function worst(states) { return states.includes('crit') ? 'crit' : states.includes('warn') ? 'warn' : 'ok'; }
const STATUS_LABEL = { ok: 'OPERATIONAL', warn: 'DEGRADED', crit: 'CRITICAL' };

function kernelHealth() {
    const alive = isAlive();
    return { status: alive ? 'ok' : 'crit', detail: alive ? 'Pulse nominal' : 'No pulse' };
}
function runtimeHealth() {
    if (!DATA.runtime) return { status: 'dim', detail: 'no telemetry' };
    const states = Object.values(DATA.runtime.metrics).filter(m => m.warn != null || m.crit != null).map(metricState);
    const w = worst(states);
    const hot = Object.entries(DATA.runtime.metrics).filter(([, m]) => metricState(m) !== 'ok').map(([k]) => k);
    return { status: w, detail: w === 'ok' ? 'All metrics nominal' : hot.join(', ') + ' elevated' };
}
function agentsHealth() {
    if (!DATA.agents) return { status: 'dim', detail: 'no agents' };
    const err = DATA.agents.agents.filter(a => statusClass(a.status) === 'bad');
    const active = DATA.agents.agents.filter(a => statusClass(a.status) === 'ok').length;
    return { status: err.length ? 'warn' : 'ok', detail: err.length ? err.length + ' agent(s) in error' : active + ' active' };
}
function diagnosticsHealth() {
    if (!DATA.diagnostics) return { status: 'dim', detail: 'no diagnostics' };
    const top = DATA.diagnostics.events.reduce((a, e) => Math.max(a, sevRank(e.severity)), 0);
    const s = top >= 3 ? 'crit' : top >= 1 ? 'warn' : 'ok';
    const crit = DATA.diagnostics.events.filter(e => sevRank(e.severity) >= 3).length;
    const warnErr = DATA.diagnostics.events.filter(e => sevRank(e.severity) >= 1).length;
    return { status: s, detail: crit ? crit + ' critical · ' + warnErr + ' open' : warnErr + ' open' };
}
function overallStatus() { return worst([kernelHealth().status, runtimeHealth().status, agentsHealth().status, diagnosticsHealth().status].map(s => s === 'dim' ? 'ok' : s)); }

/* ============================ heartbeat ============================ */
function isAlive() {
    if (!vitals || !vitals.lastPulse) return false;
    return (Date.now() - new Date(vitals.lastPulse).getTime()) / 60000 <= vitals.aliveWindowMin;
}
function ekgWave() {
    const base = 20, cyc = [[0, base], [40, base], [48, 17], [52, base], [60, base], [64, 27], [68, 4], [72, 32], [76, 17], [84, 14], [92, base], [120, base]];
    const cycle = (dx) => cyc.map(p => (p[0] + dx) + ',' + p[1]).join(' ');
    return `<svg class="ekg" viewBox="0 0 240 40" preserveAspectRatio="none" aria-hidden="true"><g class="ekg-scroll">${[0, 120, 240].map(dx => `<polyline points="${cycle(dx)}"/>`).join('')}</g><line class="ekg-flat" x1="0" y1="20" x2="240" y2="20"/></svg>`;
}
function startHeartbeat() {
    const hb = DATA.heartbeat || {};
    vitals = { lastPulse: hb.last_pulse || (DATA.reports[0] && DATA.reports[0].timestamp), aliveWindowMin: hb.alive_window_min || 90, nextRun: hb.next_run, state: hb.state };
    if (hbTimer) clearInterval(hbTimer);
    updateHeartbeat();
    hbTimer = setInterval(updateHeartbeat, 15000);
}
function updateHeartbeat() {
    const hbEl = document.getElementById('hb'), st = document.getElementById('hb-status'), sub = document.getElementById('hb-sub');
    if (!hbEl || !st) return;
    const alive = isAlive();
    hbEl.classList.toggle('alive', alive);
    hbEl.classList.toggle('stale', !alive);
    st.innerHTML = alive ? `${sdot('ok')} ALIVE` : `${sdot('bad')} NO PULSE`;
    if (sub) sub.textContent = vitals && vitals.lastPulse ? 'pulse ' + relTime(vitals.lastPulse) : '';
}

/* ============================ subsystem registry ============================
   One source of truth per subsystem. To bring a phase online, add `on: true`,
   a `render` fn, and (optionally) a `health` fn + `tile` label. Nav, routing,
   and Mission Control health tiles all derive from this list — nothing else
   needs to change. */
const SUBSYSTEMS = [
    { id: 'mission',     label: 'Mission Control', phase: 'Phase 0 · Kernel', tile: 'Kernel', on: true, render: renderMission,     health: kernelHealth },
    { id: 'runtime',     label: 'Runtime',         phase: 'Phase 0 · Kernel', tile: 'Runtime', on: true, render: renderRuntime,     health: runtimeHealth },
    { id: 'agents',      label: 'Agents',          phase: 'Phase 0 · Kernel', tile: 'Agents', on: true, render: renderAgents,      health: agentsHealth },
    { id: 'diagnostics', label: 'Diagnostics',     phase: 'Phase 0 · Kernel', tile: 'Diagnostics', on: true, render: renderDiagnostics, health: diagnosticsHealth },

    { id: 'event-stream', label: 'Event Stream', phase: 'Phase 1 · Observability', on: true, render: renderEventStream, health: eventStreamHealth },
    { id: 'timeline',     label: 'Timeline',     phase: 'Phase 1 · Observability', on: true, render: renderTimeline,    health: eventStreamHealth },
    { id: 'logs',         label: 'Logs',         phase: 'Phase 1 · Observability', on: true, render: renderLogs,        health: logsHealth },
    { id: 'alerts',       label: 'Alerts',       phase: 'Phase 1 · Observability', on: true, render: renderAlerts,      health: alertsHealth },
    { id: 'health',       label: 'Health',       phase: 'Phase 1 · Observability', on: true, render: renderHealth,      health: healthHealth },

    { id: 'memory',     label: 'Memory',     phase: 'Phase 2 · Cognition', on: true, render: renderMemory,     health: memoryHealth },
    { id: 'reasoning',  label: 'Reasoning',  phase: 'Phase 2 · Cognition', on: true, render: renderReasoning,  health: reasoningHealth },
    { id: 'reflection', label: 'Reflection', phase: 'Phase 2 · Cognition', on: true, render: renderReflection, health: reflectionHealth },
    { id: 'planning',   label: 'Planning',   phase: 'Phase 2 · Cognition', on: true, render: renderPlanning,   health: planningHealth },

    { id: 'scheduler',  label: 'Scheduler',  phase: 'Phase 3 · Execution', on: true, render: renderScheduler,  health: schedulerHealth },
    { id: 'queues',     label: 'Queues',     phase: 'Phase 3 · Execution', on: true, render: renderQueues,     health: queuesHealth },
    { id: 'workloads',  label: 'Workloads',  phase: 'Phase 3 · Execution', on: true, render: renderWorkloads,  health: workloadsHealth },
    { id: 'automation', label: 'Automation', phase: 'Phase 3 · Execution', on: true, render: renderAutomation, health: automationHealth },

    { id: 'knowledge-graph',  label: 'Knowledge Graph',  phase: 'Phase 4 · Intelligence', on: true, render: renderKnowledge,     health: knowledgeHealth },
    { id: 'relationships',    label: 'Relationships',    phase: 'Phase 4 · Intelligence', on: true, render: renderRelationships, health: knowledgeHealth },
    { id: 'semantic-search',  label: 'Semantic Search',  phase: 'Phase 4 · Intelligence', on: true, render: renderSemanticSearch, health: semanticHealth },
    { id: 'context-explorer', label: 'Context Explorer', phase: 'Phase 4 · Intelligence', on: true, render: renderContext,       health: contextHealth },

    { id: 'trend-analysis',          label: 'Trend Analysis',          phase: 'Phase 5 · Evolution' },
    { id: 'learning-metrics',        label: 'Learning Metrics',        phase: 'Phase 5 · Evolution' },
    { id: 'improvement-engine',      label: 'Improvement Engine',      phase: 'Phase 5 · Evolution' },
    { id: 'autonomous-optimization', label: 'Autonomous Optimization', phase: 'Phase 5 · Evolution' },

    { id: 'reports', label: 'Reports', phase: 'Outputs', on: true, render: renderReports }
];
function getSub(id) { return SUBSYSTEMS.find(s => s.id === id); }

function renderNav() {
    let h = `<div class="os-brand"><span class="os-logo">◆</span> MARKUS <b>OS</b></div>`;
    let phase = null;
    for (const s of SUBSYSTEMS) {
        if (s.phase !== phase) { if (phase !== null) h += `</div>`; h += `<div class="nav-group"><div class="nav-phase">${esc(s.phase)}</div>`; phase = s.phase; }
        h += `<a class="nav-item${s.on ? '' : ' locked'}${currentRoute === s.id ? ' active' : ''}" href="#/${s.id}">${esc(s.label)}${s.on ? '' : '<span class="lock">planned</span>'}</a>`;
    }
    if (phase !== null) h += `</div>`;
    document.getElementById('nav').innerHTML = h;
}

function renderTopStrip() {
    const sys = DATA.system || {}, rt = DATA.runtime && DATA.runtime.metrics || {};
    const ov = overallStatus();
    const vit = (k) => rt[k] ? `<span class="tv"><span class="tv-k">${rt[k].label.split(' ')[0]}</span><span class="tv-v ${metricState(rt[k])}">${fmt1(rt[k].now)}${rt[k].unit === '%' ? '%' : ''}</span></span>` : '';
    document.getElementById('topstrip').innerHTML = `
        <div class="ts-left">
            <div class="hb" id="hb"><div class="hb-ekg">${ekgWave()}</div>
                <div class="hb-meta"><div class="hb-status" id="hb-status">—</div><div class="hb-sub" id="hb-sub"></div></div>
            </div>
        </div>
        <div class="ts-mid">
            ${vit('cpu_pct')}${vit('mem_pct')}${vit('disk_pct')}${vit('context_pct')}
            <span class="tv"><span class="tv-k">Cost</span><span class="tv-v">$${rt.cost_usd ? fmt1(rt.cost_usd.now) : '—'}</span></span>
        </div>
        <div class="ts-right">
            <span class="sys-status ${ov}">${sdot(ov)} ${STATUS_LABEL[ov]}</span>
            <span class="ts-meta">${esc(sys.version || '')} · uptime ${sys.uptime_hours != null ? fmt1(sys.uptime_hours) + 'h' : '—'}</span>
        </div>`;
    updateHeartbeat();
}

/* ============================ views ============================ */
function viewHeader(title, sub, right) {
    return `<div class="view-head"><div><h1>${esc(title)}</h1>${sub ? `<div class="view-sub">${sub}</div>` : ''}</div>${right ? `<div class="view-right">${right}</div>` : ''}</div>`;
}
function panel(title, body, cls) { return `<section class="panel ${cls || ''}"><div class="panel-h">${esc(title)}</div><div class="panel-b">${body}</div></section>`; }

/* --- Mission Control --- */
function renderMission() {
    const subs = SUBSYSTEMS.filter(s => s.on && s.tile).map(s => ({ id: s.id, label: s.tile, h: s.health() }));
    const ov = overallStatus();
    const tiles = subs.map(s => `<a class="hx-tile ${s.h.status}" href="#/${s.id}"><div class="hx-top">${sdot(s.h.status)}<span class="hx-name">${s.label}</span><span class="hx-badge ${s.h.status}">${STATUS_LABEL[s.h.status] || '—'}</span></div><div class="hx-detail">${esc(s.h.detail)}</div></a>`).join('');

    // attention: open diagnostics warn+
    const att = (DATA.diagnostics ? DATA.diagnostics.events : []).filter(e => sevRank(e.severity) >= 1).sort((a, b) => sevRank(b.severity) - sevRank(a.severity)).slice(0, 5)
        .map(e => `<div class="att-row"><span class="sev ${e.severity}">${esc(e.severity)}</span><span class="att-sub">${esc(e.subsystem)}</span><span class="att-msg">${esc(e.message)}</span></div>`).join('') || '<div class="muted">No open issues.</div>';

    // current activity from active agents
    const acts = (DATA.agents ? DATA.agents.agents : []).filter(a => a.current_task).slice(0, 4)
        .map(a => `<div class="act-row">${sdot(a.status)}<span class="act-agent">${esc(a.name)}</span><span class="act-task">${esc(a.current_task)}</span></div>`).join('') || '<div class="muted">Idle.</div>';

    // changed today (events)
    const evs = (DATA.events ? DATA.events.events : []).slice(0, 6)
        .map(e => `<div class="ev-row"><span class="ev-t">${clockTime(e.ts)}</span><span class="ev-type">${esc(e.type)}</span><span class="ev-msg">${esc(e.message)}</span></div>`).join('');

    // quick vitals sparkcharts
    const rt = DATA.runtime && DATA.runtime.metrics || {};
    const quick = ['cpu_pct', 'mem_pct', 'disk_pct', 'cost_usd'].filter(k => rt[k]).map(k => {
        const m = rt[k], st = metricState(m);
        return `<div class="qv"><div class="qv-h"><span>${esc(m.label)}</span><b class="${st}">${fmt1(m.now)}${m.unit === '%' ? '%' : (k === 'cost_usd' ? '' : '')}</b></div>${lineChart(m.series, { w: 220, h: 40, warn: m.warn, crit: m.crit, state: st })}</div>`;
    }).join('');

    return viewHeader('Mission Control', `System <span class="${ov}">${STATUS_LABEL[ov]}</span> · ${esc((DATA.system && DATA.system.identity) || 'Markus')} · ${DATA.agents ? DATA.agents.agents.filter(a => statusClass(a.status) === 'ok').length : 0} agents active`)
        + `<div class="mc-grid">`
        + panel('Subsystem Health', `<div class="hx-tiles">${tiles}</div>`, 'span2')
        + panel('Live Vitals', `<div class="qv-grid">${quick}</div>`, 'span2')
        + panel('Requires Attention', att)
        + panel('Current Activity', acts)
        + panel('Recent Events', evs, 'span2')
        + `</div>`;
}

/* --- Runtime --- */
function renderRuntime() {
    if (!DATA.runtime) return viewHeader('Runtime') + '<div class="muted pad">No telemetry.</div>';
    const h = runtimeHealth();
    const order = ['cpu_pct', 'mem_pct', 'disk_pct', 'context_pct', 'latency_ms', 'queue_depth', 'tokens_min', 'api_calls', 'cost_usd'];
    const cards = order.filter(k => DATA.runtime.metrics[k]).map(k => {
        const m = DATA.runtime.metrics[k], st = metricState(m);
        const val = k === 'cost_usd' ? '$' + fmt1(m.now) : fmt1(m.now) + (m.unit === '%' ? '%' : (m.unit ? ' ' + m.unit : ''));
        return `<div class="tcard ${st}">
            <div class="tcard-h"><span class="tcard-k">${esc(m.label)}</span><span class="tcard-v ${st}">${val}</span></div>
            ${lineChart(m.series, { w: 320, h: 58, warn: m.warn, crit: m.crit, state: st })}
            <div class="tcard-f">${m.detail ? esc(m.detail) : (m.warn != null ? 'warn ' + m.warn + (m.unit === '%' ? '%' : '') + ' · crit ' + m.crit + (m.unit === '%' ? '%' : '') : 'no threshold')}</div>
        </div>`;
    }).join('');
    return viewHeader('Runtime', `Telemetry · window ${DATA.runtime.window_min || 60}m · <span class="${h.status}">${STATUS_LABEL[h.status]}</span>`, `<span class="ts-meta">updated ${relTime(DATA.runtime.updated)}</span>`)
        + `<div class="tgrid">${cards}</div>`;
}

/* --- Agents --- */
function renderAgents() {
    if (!DATA.agents) return viewHeader('Agents') + '<div class="muted pad">No agents.</div>';
    const list = DATA.agents.agents;
    const rows = list.map(a => {
        const sc = statusClass(a.status);
        return `<div class="svc ${sc}">
            <div class="svc-l">${sdot(a.status)}<div><div class="svc-name">${esc(a.name)}</div><div class="svc-role">${esc(a.role || '')}</div></div></div>
            <div class="svc-task">${a.current_task ? esc(a.current_task) : '<span class="muted">—</span>'}</div>
            <div class="svc-metrics">
                <span title="model">${esc(a.model || '')}</span>
                <span title="latency">${a.latency_ms ? a.latency_ms + 'ms' : '—'}</span>
                <span title="memory">${a.mem_mb != null ? a.mem_mb + 'MB' : '—'}</span>
                <span title="queue">q:${a.queue != null ? a.queue : 0}</span>
                <span title="heartbeat" class="${a.heartbeat_s != null && a.heartbeat_s < 60 ? 'ok' : ''}">♥ ${a.heartbeat_s != null ? a.heartbeat_s + 's' : '—'}</span>
            </div>
            <div class="svc-seen">${a.last_active ? relTime(a.last_active) : ''}${a.deps && a.deps.length ? `<div class="svc-deps">↳ ${a.deps.map(esc).join(', ')}</div>` : ''}</div>
        </div>`;
    }).join('');
    const active = list.filter(a => statusClass(a.status) === 'ok').length;
    const err = list.filter(a => statusClass(a.status) === 'bad').length;
    return viewHeader('Agents', `${list.length} services · ${active} active${err ? ' · <span class="bad">' + err + ' error</span>' : ''}`, `<span class="ts-meta">updated ${relTime(DATA.agents.updated)}</span>`)
        + `<div class="svc-head"><span>Service</span><span>Current Task</span><span>Telemetry</span><span>Last / Deps</span></div>`
        + `<div class="svc-list">${rows}</div>`;
}

/* --- Diagnostics --- */
function renderDiagnostics() {
    if (!DATA.diagnostics) return viewHeader('Diagnostics') + '<div class="muted pad">No diagnostics.</div>';
    const evs = DATA.diagnostics.events.slice().sort((a, b) => sevRank(b.severity) - sevRank(a.severity) || new Date(b.ts) - new Date(a.ts));
    const counts = { info: 0, warning: 0, error: 0, critical: 0 };
    DATA.diagnostics.events.forEach(e => { counts[String(e.severity).toLowerCase()] = (counts[String(e.severity).toLowerCase()] || 0) + 1; });
    const chips = ['critical', 'error', 'warning', 'info'].map(s => `<span class="sev-chip ${s}">${counts[s] || 0} ${s}</span>`).join('');
    const rows = evs.map(e => `
        <div class="diag ${e.severity}">
            <div class="diag-sev"><span class="sev ${e.severity}">${esc(e.severity)}</span></div>
            <div class="diag-body">
                <div class="diag-top"><span class="diag-sub">${esc(e.subsystem)}</span><span class="diag-id">${esc(e.id || '')}</span><span class="diag-ts">${clockTime(e.ts)} · ${relTime(e.ts)}</span></div>
                <div class="diag-msg">${esc(e.message)}</div>
                ${e.recommendation ? `<div class="diag-rec">↳ ${esc(e.recommendation)}</div>` : ''}
            </div>
        </div>`).join('');
    return viewHeader('Diagnostics', chips, `<span class="ts-meta">updated ${relTime(DATA.diagnostics.updated)}</span>`)
        + `<div class="diag-list">${rows}</div>`;
}

/* --- Reports (nightly self-audit output) --- */
const RMETRICS = [['response_quality', 'Response Quality'], ['cost_efficiency', 'Cost Efficiency'], ['task_completion', 'Task Completion'], ['autonomy', 'Autonomy'], ['speed', 'Speed'], ['initiative', 'Initiative']];
function rScore(sc, k) { const v = sc && sc[k]; return typeof v === 'number' ? v : (v && typeof v.score === 'number' ? v.score : null); }
function rComposite(r) { if (!r) return null; if (typeof r.composite === 'number') return r.composite; return null; }
function rSeries(k) { return DATA.reports.slice().sort((a, b) => new Date(a.date) - new Date(b.date)).map(r => rScore(r.scores, k)).filter(v => v != null); }
let reportIdx = 0;
function renderReports() {
    if (!DATA.reports.length) return viewHeader('Reports') + '<div class="muted pad">No reports.</div>';
    const r = DATA.reports[reportIdx] || DATA.reports[0];
    const prior = DATA.reports[reportIdx + 1];
    const pills = DATA.reports.map((rp, i) => `<a class="rpill${i === reportIdx ? ' active' : ''}" href="#/reports/${i}">${esc(rp.date)} · ${fmt1(rComposite(rp))}</a>`).join('');
    const scores = r.scores ? RMETRICS.filter(([k]) => rScore(r.scores, k) != null).map(([k, label]) => {
        const s = rScore(r.scores, k), ps = prior ? rScore(prior.scores, k) : null, d = ps == null ? null : s - ps;
        const details = r.scores[k] && r.scores[k].details;
        return `<div class="rscore"><div class="rscore-h"><span>${esc(label)}</span><span class="rscore-v">${fmt1(s)}/10 ${trend(d)}</span></div>${lineChart(rSeries(k), { w: 320, h: 40 })}${details ? `<div class="rscore-d">${esc(details)}</div>` : ''}</div>`;
    }).join('') : '';
    const findings = (r.findings || []).map(f => `<div class="rfind"><span class="sev ${f.severity || 'info'}">${esc(f.severity || 'info')}</span><span class="rfind-t">${esc(f.type || '')}</span><span class="rfind-m">${esc(f.message || '')}</span></div>`).join('');
    const props = (r.proposals || []).map(p => `<div class="rprop"><div class="rprop-h"><span class="sev-chip">${esc((p.status || 'pending'))}</span><b>${esc(p.title || '')}</b></div><div class="rprop-s">${esc(p.summary || '')}</div></div>`).join('');
    const mods = (r.modules_run || []).map(m => `<span class="chip">${esc(m)}</span>`).join('');
    return viewHeader('Reports', `Nightly self-audit · ${esc(r.date)}`, `<span class="copy-link" id="copy-md">⧉ Markdown</span>`)
        + `<div class="rpills">${pills}</div>`
        + `<div class="mc-grid">`
        + panel('North Star', `<div class="rscores">${scores}</div>`, 'span2')
        + (findings ? panel('Findings', findings, 'span2') : '')
        + (props ? panel('Proposals', props) : '')
        + (mods ? panel('Modules Run', `<div class="chips">${mods}</div>`) : '')
        + `</div>`;
}

function trend(d) {
    if (d == null || isNaN(d)) return '<span class="tr flat">—</span>';
    const r = Math.round(d * 10) / 10;
    if (r > 0) return `<span class="tr up">▲${fmt1(r)}</span>`;
    if (r < 0) return `<span class="tr down">▼${fmt1(Math.abs(r))}</span>`;
    return '<span class="tr flat">±0</span>';
}

/* --- planned subsystem stub --- */
function renderPlanned(id, label) {
    const phase = (getSub(id) && getSub(id).phase) || '';
    return viewHeader(label, `${esc(phase)} · <span class="warn">PLANNED</span>`)
        + `<div class="planned"><div class="planned-icon">◇</div><div class="planned-title">${esc(label)} subsystem is scheduled.</div>
        <div class="planned-sub">This subsystem will publish telemetry, health, logs and history into the same diagnostic framework as the kernel. Not yet online.</div>
        <div class="planned-tag">${esc(phase)}</div></div>`;
}

/* ============================ Phase 1 · Observability ============================ */
function sevForType(t) {
    t = String(t || '').toLowerCase();
    if (['alert', 'error', 'critical'].includes(t)) return 'bad';
    if (['heartbeat', 'task_completed', 'report'].includes(t)) return 'ok';
    return 'dim';
}
function statusPill(h) { return `<span class="sys-status ${h.status}">${sdot(h.status)} ${STATUS_LABEL[h.status] || '—'}</span>`; }

let eventFilter = 'all';
function setEventFilter(t) { eventFilter = t; const v = document.getElementById('view'); if (v) { v.innerHTML = renderEventStream(); v.scrollTop = 0; } }
function eventStreamHealth() { const n = DATA.events ? DATA.events.events.length : 0; return { status: 'ok', detail: n + ' events' }; }
function renderEventStream() {
    const evs = (DATA.events ? DATA.events.events : []).slice().sort((a, b) => new Date(b.ts) - new Date(a.ts));
    const types = Array.from(new Set(evs.map(e => e.type)));
    const chips = ['all'].concat(types).map(t => `<span class="fchip${eventFilter === t ? ' active' : ''}" onclick="setEventFilter('${t}')">${esc(t)}${t === 'all' ? ' · ' + evs.length : ''}</span>`).join('');
    const shown = evs.filter(e => eventFilter === 'all' || e.type === eventFilter);
    const rows = shown.map(e => `<div class="es-row"><span class="es-t">${clockTime(e.ts)}</span><span class="sdot ${sevForType(e.type)}"></span><span class="es-type">${esc(e.type)}</span><span class="es-sub">${esc(e.subsystem)}</span><span class="es-msg">${esc(e.message)}</span><span class="es-rel">${relTime(e.ts)}</span></div>`).join('') || '<div class="muted pad">No events.</div>';
    return viewHeader('Event Stream', 'Live system event feed', statusPill(eventStreamHealth())) + `<div class="fchips">${chips}</div><div class="es-list">${rows}</div>`;
}

function renderTimeline() {
    const evs = (DATA.events ? DATA.events.events : []).slice().sort((a, b) => new Date(b.ts) - new Date(a.ts));
    const rows = evs.map(e => `<div class="tl-node"><div class="tl-time">${clockTime(e.ts)}<span class="tl-rel">${relTime(e.ts)}</span></div><div class="tl-rail"><span class="tl-marker ${sevForType(e.type)}"></span></div><div class="tl-card"><div class="tl-h"><span class="tl-type">${esc(e.type)}</span><span class="tl-sub">${esc(e.subsystem)}</span></div><div class="tl-msg">${esc(e.message)}</div></div></div>`).join('') || '<div class="muted pad">No events.</div>';
    return viewHeader('Timeline', 'Chronological system events', statusPill(eventStreamHealth())) + `<div class="timeline">${rows}</div>`;
}

let logFilter = 'all';
function setLogFilter(l) { logFilter = l; const v = document.getElementById('view'); if (v) { v.innerHTML = renderLogs(); v.scrollTop = 0; } }
function logsHealth() { const lines = DATA.logs ? DATA.logs.lines : []; const e = lines.filter(l => l.level === 'error').length; return { status: e > 0 ? 'warn' : 'ok', detail: lines.length + ' lines' + (e ? ' · ' + e + ' errors' : '') }; }
function renderLogs() {
    const lines = (DATA.logs ? DATA.logs.lines : []).slice().sort((a, b) => new Date(b.ts) - new Date(a.ts));
    const levels = ['all', 'debug', 'info', 'warn', 'error'];
    const cnt = {}; lines.forEach(l => cnt[l.level] = (cnt[l.level] || 0) + 1);
    const chips = levels.map(l => `<span class="fchip${logFilter === l ? ' active' : ''}" onclick="setLogFilter('${l}')">${l}${l === 'all' ? ' · ' + lines.length : (cnt[l] ? ' · ' + cnt[l] : '')}</span>`).join('');
    const shown = lines.filter(l => logFilter === 'all' || l.level === logFilter);
    const rows = shown.map(l => `<div class="log ${esc(l.level)}"><span class="log-t">${clockTime(l.ts)}</span><span class="log-lvl ${esc(l.level)}">${esc(String(l.level).toUpperCase())}</span><span class="log-sub">${esc(l.subsystem)}</span><span class="log-msg">${esc(l.message)}</span></div>`).join('') || '<div class="muted pad">No log lines.</div>';
    return viewHeader('Logs', `retention ${DATA.logs ? DATA.logs.retention_h : 24}h`, statusPill(logsHealth())) + `<div class="fchips">${chips}</div><div class="logview">${rows}</div>`;
}

function computeAlerts() {
    const out = [];
    const rt = (DATA.runtime && DATA.runtime.metrics) || {};
    for (const k in rt) {
        const m = rt[k], st = metricState(m);
        if (st !== 'ok') out.push({ severity: st === 'crit' ? 'critical' : 'warning', rule: `${m.label} ≥ ${st === 'crit' ? m.crit : m.warn}${m.unit === '%' ? '%' : ''}`, subsystem: 'runtime', value: `${fmt1(m.now)}${m.unit === '%' ? '%' : ''}`, since: DATA.runtime && DATA.runtime.updated });
    }
    for (const e of (DATA.diagnostics ? DATA.diagnostics.events : [])) {
        if (sevRank(e.severity) >= 2) out.push({ severity: e.severity, rule: e.message, subsystem: e.subsystem, value: '', since: e.ts, rec: e.recommendation });
    }
    return out.sort((a, b) => sevRank(b.severity) - sevRank(a.severity) || new Date(b.since) - new Date(a.since));
}
function alertsHealth() { const a = computeAlerts(); const top = a.reduce((x, al) => Math.max(x, sevRank(al.severity)), 0); return { status: top >= 3 ? 'crit' : top >= 1 ? 'warn' : 'ok', detail: a.length + ' firing' }; }
function renderAlerts() {
    const a = computeAlerts();
    const c = { critical: 0, error: 0, warning: 0 }; a.forEach(x => c[x.severity] = (c[x.severity] || 0) + 1);
    const chips = ['critical', 'error', 'warning'].map(s => `<span class="sev-chip ${s}">${c[s] || 0} ${s}</span>`).join('');
    const rows = a.map(al => `<div class="alert ${al.severity}"><div class="alert-l"><span class="sev ${al.severity}">${esc(al.severity)}</span></div><div class="alert-body"><div class="alert-top"><span class="alert-rule">${esc(al.rule)}</span><span class="alert-since">firing ${al.since ? relTime(al.since) : ''}</span></div><div class="alert-meta">${esc(al.subsystem)}${al.value ? ' · <b>' + esc(al.value) + '</b>' : ''}</div>${al.rec ? `<div class="alert-rec">↳ ${esc(al.rec)}</div>` : ''}</div></div>`).join('') || '<div class="muted pad">No firing alerts. All clear.</div>';
    return viewHeader('Alerts', a.length ? `${a.length} firing` : 'All clear', chips) + `<div class="alert-list">${rows}</div>`;
}

function computeHealthChecks() {
    const checks = [];
    checks.push({ name: 'Kernel pulse', group: 'Core', status: isAlive() ? 'ok' : 'bad', detail: isAlive() ? 'active' : 'no pulse' });
    for (const s of SUBSYSTEMS.filter(x => x.on && x.tile)) { const h = s.health(); checks.push({ name: s.tile, group: 'Subsystems', status: h.status, detail: h.detail }); }
    for (const a of (DATA.agents ? DATA.agents.agents : [])) { const sc = statusClass(a.status); checks.push({ name: a.name, group: 'Agents', status: sc === 'bad' ? 'bad' : (sc === 'ok' ? 'ok' : 'dim'), detail: a.status }); }
    for (const m of ((DATA.system && DATA.system.machines) || [])) checks.push({ name: m.name, group: 'Machines', status: m.status === 'online' ? 'ok' : 'bad', detail: m.role || m.status });
    for (const i of ((DATA.system && DATA.system.interfaces) || [])) checks.push({ name: i.name, group: 'Interfaces', status: i.status === 'online' ? 'ok' : (i.status === 'planned' ? 'dim' : 'bad'), detail: i.status });
    return checks;
}
function healthHealth() { const ch = computeHealthChecks(); const bad = ch.filter(c => c.status === 'bad').length; const pass = ch.filter(c => c.status === 'ok').length; return { status: bad >= 2 ? 'crit' : bad ? 'warn' : 'ok', detail: pass + '/' + ch.length + ' passing' }; }
function renderHealth() {
    const ch = computeHealthChecks();
    const groups = [], gmap = {};
    ch.forEach(c => { if (!gmap[c.group]) { gmap[c.group] = []; groups.push(c.group); } gmap[c.group].push(c); });
    const pass = ch.filter(c => c.status === 'ok').length, bad = ch.filter(c => c.status === 'bad').length;
    let body = '';
    for (const g of groups) {
        const items = gmap[g].map(c => `<div class="hc"><span class="sdot ${c.status}"></span><span class="hc-name">${esc(c.name)}</span><span class="hc-detail">${esc(c.detail || '')}</span><span class="hc-status ${c.status}">${c.status === 'ok' ? 'UP' : (c.status === 'bad' ? 'DOWN' : c.status === 'warn' ? 'WARN' : '—')}</span></div>`).join('');
        body += panel(g, `<div class="hc-list">${items}</div>`);
    }
    return viewHeader('Health', `${pass}/${ch.length} checks passing${bad ? ' · <span class="bad">' + bad + ' down</span>' : ''}`, statusPill(healthHealth())) + `<div class="mc-grid">${body}</div>`;
}

/* ============================ Phase 2 · Cognition ============================ */
function pct(n) { return (n == null || isNaN(n)) ? '—' : Math.round(n * 100) + '%'; }
function bar(p, cls) { p = Math.max(0, Math.min(100, p || 0)); return `<div class="cap"><div class="cap-fill ${cls || ''}" style="width:${p}%"></div></div>`; }
function stat(label, val, cls) { return `<div class="stat"><span class="stat-k">${esc(label)}</span><span class="stat-v ${cls || ''}">${val == null ? '—' : val}</span></div>`; }

/* --- Memory --- */
function memoryHealth() {
    if (!DATA.memory) return { status: 'dim', detail: 'no data' };
    const m = DATA.memory.metrics || {};
    return { status: m.conflicts > 0 ? 'warn' : 'ok', detail: (m.entries || 0) + ' entries · recall ' + pct(m.recall_hit_rate) };
}
function renderMemory() {
    if (!DATA.memory) return viewHeader('Memory') + '<div class="muted pad">No memory data.</div>';
    const M = DATA.memory, t = M.tiers || {}, m = M.metrics || {};
    const tiers = `<div class="cog-cards">
        <div class="statbox"><div class="sb-k">${esc((t.working || {}).label || 'Working')}</div><div class="sb-v">${(t.working || {}).used || 0}<span class="sb-u">% ctx</span></div>${bar((t.working || {}).used || 0, ((t.working || {}).used >= 85) ? 'hot' : '')}</div>
        <div class="statbox"><div class="sb-k">${esc((t.long_term || {}).label || 'Long-Term')}</div><div class="sb-v">${(t.long_term || {}).entries || 0}<span class="sb-u">entries</span></div><div class="sb-sub">${fmt1((t.long_term || {}).size_mb)} MB</div></div>
        <div class="statbox"><div class="sb-k">${esc((t.semantic || {}).label || 'Semantic')}</div><div class="sb-v">${(t.semantic || {}).nodes || 0}<span class="sb-u">nodes</span></div><div class="sb-sub">${(t.semantic || {}).edges || 0} edges</div></div>
    </div>`;
    const metrics = `<div class="stat-grid">
        ${stat('Entries', m.entries)}${stat('Size', fmt1(m.size_mb) + ' MB')}
        ${stat('Dedup ratio', pct(m.dedup_ratio))}${stat('Compression', fmt1(m.compression_ratio) + '×')}
        ${stat('Conflicts', m.conflicts, m.conflicts > 0 ? 'warn' : '')}${stat('Orphans', m.orphans)}
        ${stat('Recall hit-rate', pct(m.recall_hit_rate))}
    </div>`;
    const recall = M.recall_series ? `<div class="tcard"><div class="tcard-h"><span class="tcard-k">Recall Hit-Rate</span><span class="tcard-v">${pct(m.recall_hit_rate)}</span></div>${lineChart(M.recall_series.map(x => x * 100), { w: 320, h: 58 })}</div>` : '<div class="muted">—</div>';
    const recent = (M.recent || []).map(r => `<div class="op-row"><span class="op-t">${clockTime(r.ts)}</span><span class="op-badge ${r.op === 'conflict' ? 'warn' : ''}">${esc(r.op)}</span><span class="op-d">${esc(r.detail)}</span></div>`).join('') || '<div class="muted">—</div>';
    return viewHeader('Memory', 'Memory subsystem · tiers, integrity, recall', statusPill(memoryHealth()))
        + `<div class="mc-grid">` + panel('Memory Tiers', tiers, 'span2') + panel('Integrity & Metrics', metrics) + panel('Recall Trend', recall) + panel('Recent Memory Ops', recent, 'span2') + `</div>`;
}

/* --- Reasoning --- */
function reasoningHealth() {
    if (!DATA.reasoning) return { status: 'dim', detail: 'no data' };
    const m = DATA.reasoning.metrics || {};
    const conf = m.confidence ? m.confidence.now : 100, succ = m.problem_solving ? m.problem_solving.now : 100;
    return { status: (conf < 60 || succ < 60) ? 'warn' : 'ok', detail: 'confidence ' + conf + '%' };
}
function rMetricVal(m) { if (m.unit === '%') return m.now + '%'; if (m.unit === 'ms') return m.now + 'ms'; return fmt1(m.now) + (m.unit ? ' ' + m.unit : ''); }
function renderReasoning() {
    if (!DATA.reasoning) return viewHeader('Reasoning') + '<div class="muted pad">No reasoning data.</div>';
    const R = DATA.reasoning, order = ['confidence', 'problem_solving', 'decision_latency', 'chain_length', 'planning_depth'];
    const cards = order.filter(k => R.metrics[k]).map(k => {
        const m = R.metrics[k], lo = Math.min.apply(null, m.series), hi = Math.max.apply(null, m.series);
        return `<div class="tcard"><div class="tcard-h"><span class="tcard-k">${esc(m.label)}</span><span class="tcard-v">${rMetricVal(m)}</span></div>${lineChart(m.series, { w: 320, h: 58 })}<div class="tcard-f">min ${fmt1(lo)} · max ${fmt1(hi)}</div></div>`;
    }).join('');
    const c = R.counters || {};
    const counters = `<div class="stat-grid">
        ${stat('Decisions', c.decisions)}${stat('Clarifications', c.clarifications, c.clarifications >= 6 ? 'warn' : '')}
        ${stat('Self-corrections', c.self_corrections)}${stat('Errors recovered', c.errors_recovered)}
        ${stat('Hallucinations prevented', c.hallucinations_prevented)}
    </div>`;
    return viewHeader('Reasoning', 'Cognitive performance metrics', statusPill(reasoningHealth()))
        + `<div class="tgrid">${cards}</div><div style="margin-top:12px">${panel('Cognition Counters', counters)}</div>`;
}

/* --- Reflection --- */
function reflectionHealth() {
    if (!DATA.reflection) return { status: 'dim', detail: 'no data' };
    const c = DATA.reflection.calibration || {}, gap = Math.abs((c.predicted || 0) - (c.actual || 0));
    const pend = (DATA.reflection.entries || []).filter(e => e.outcome === 'pending').length;
    return { status: gap > 0.15 ? 'warn' : 'ok', detail: (DATA.reflection.entries || []).length + ' insights · ' + pend + ' pending' };
}
function renderReflection() {
    if (!DATA.reflection) return viewHeader('Reflection') + '<div class="muted pad">No reflection data.</div>';
    const R = DATA.reflection, cal = R.calibration || {}, gap = (cal.predicted || 0) - (cal.actual || 0);
    const calib = `<div class="calib">
        <div class="calib-row"><span class="calib-k">Predicted confidence</span>${bar((cal.predicted || 0) * 100, '')}<span class="calib-v">${pct(cal.predicted)}</span></div>
        <div class="calib-row"><span class="calib-k">Actual outcome</span>${bar((cal.actual || 0) * 100, 'ok')}<span class="calib-v">${pct(cal.actual)}</span></div>
        <div class="calib-gap">Calibration gap <b class="${Math.abs(gap) > 0.15 ? 'warn' : ''}">${gap >= 0 ? '+' : ''}${Math.round(gap * 100)}%</b> · ${cal.samples || 0} samples ${gap > 0 ? '(overconfident)' : gap < 0 ? '(underconfident)' : ''}</div>
    </div>`;
    const entries = (R.entries || []).map(e => `<div class="refl"><div class="refl-h"><span class="refl-out ${esc(e.outcome)}">${esc(e.outcome)}</span><span class="refl-conf">conf ${pct(e.confidence)}</span><span class="refl-ts">${relTime(e.ts)}</span></div><div class="refl-insight">${esc(e.insight)}</div><div class="refl-action">↳ ${esc(e.action)}</div></div>`).join('') || '<div class="muted">—</div>';
    return viewHeader('Reflection', 'Metacognition · self-assessment & calibration', statusPill(reflectionHealth()))
        + `<div class="mc-grid">` + panel('Confidence Calibration', calib, 'span2') + panel('Reflection Log', entries, 'span2') + `</div>`;
}

/* --- Planning --- */
function planningHealth() {
    if (!DATA.planning) return { status: 'dim', detail: 'no data' };
    const m = DATA.planning.metrics || {};
    return { status: m.blocked_steps > 0 ? 'warn' : 'ok', detail: (m.active_plans || 0) + ' active · ' + (m.blocked_steps || 0) + ' blocked' };
}
function renderPlanning() {
    if (!DATA.planning) return viewHeader('Planning') + '<div class="muted pad">No planning data.</div>';
    const P = DATA.planning, m = P.metrics || {};
    const goals = (P.goals || []).map(g => `<div class="goal ${esc(g.status)}"><div class="goal-h"><span class="goal-status ${esc(g.status)}">${esc(g.status)}</span><span class="goal-title">${esc(g.title)}</span><span class="goal-id">${esc(g.id)}</span></div>${bar((g.progress || 0) * 100, g.status === 'blocked' ? 'warn' : (g.status === 'done' ? 'ok' : ''))}<div class="goal-f">${g.steps_done}/${g.steps_total} steps · ${Math.round((g.progress || 0) * 100)}%</div></div>`).join('') || '<div class="muted">—</div>';
    const metrics = `<div class="stat-grid">
        ${stat('Active plans', m.active_plans)}${stat('Avg depth', fmt1(m.avg_depth))}
        ${stat('Avg branching', fmt1(m.avg_branching))}${stat('Step success', pct(m.step_success_rate))}
        ${stat('Replans', m.replans)}${stat('Blocked steps', m.blocked_steps, m.blocked_steps > 0 ? 'warn' : '')}
    </div>`;
    return viewHeader('Planning', 'Goal decomposition & execution planning', statusPill(planningHealth()))
        + `<div class="mc-grid">` + panel('Goals', goals, 'span2') + panel('Planning Metrics', metrics, 'span2') + `</div>`;
}

/* ============================ Phase 3 · Execution ============================ */
function relFuture(iso) {
    const d = new Date(iso); if (isNaN(d)) return '—';
    let s = Math.floor((d.getTime() - Date.now()) / 1000);
    if (s <= 0) return 'now';
    if (s < 60) return 'in ' + s + 's';
    const m = Math.floor(s / 60); if (m < 60) return 'in ' + m + 'm';
    const h = Math.floor(m / 60); if (h < 24) return 'in ' + h + 'h ' + (m % 60) + 'm';
    return 'in ' + Math.floor(h / 24) + 'd';
}
function fmtDur(s) {
    if (s == null || isNaN(s)) return '—'; s = Math.floor(s);
    if (s < 60) return s + 's';
    const m = Math.floor(s / 60); if (m < 60) return m + 'm ' + (s % 60) + 's';
    const h = Math.floor(m / 60); if (h < 24) return h + 'h ' + (m % 60) + 'm';
    return Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
}

function schedulerHealth() {
    if (!DATA.scheduler) return { status: 'dim', detail: 'no data' };
    const jobs = DATA.scheduler.jobs || [], failed = jobs.filter(j => j.last_status === 'failed').length, en = jobs.filter(j => j.enabled).length;
    return { status: failed ? 'warn' : 'ok', detail: en + ' jobs enabled' + (failed ? ' · ' + failed + ' failed' : '') };
}
function renderScheduler() {
    if (!DATA.scheduler) return viewHeader('Scheduler') + '<div class="muted pad">No scheduler data.</div>';
    const jobs = (DATA.scheduler.jobs || []).slice().sort((a, b) => new Date(a.next_run || 0) - new Date(b.next_run || 0));
    const rows = jobs.map(j => `<div class="job"><div class="job-l">${sdot(j.enabled ? (j.last_status === 'failed' ? 'bad' : 'ok') : 'dim')}<div><div class="job-name">${esc(j.name)}</div><div class="job-cron">${esc(j.cron)}</div></div></div><div class="job-cell">${j.next_run ? relFuture(j.next_run) : '—'}<div class="job-sub">next run</div></div><div class="job-cell"><span class="job-status ${esc(j.last_status)}">${esc(j.last_status)}</span><div class="job-sub">${j.last_run ? relTime(j.last_run) : 'never'}</div></div><div class="job-cell">${j.avg_duration_s ? j.avg_duration_s + 's' : '—'}<div class="job-sub">avg</div></div></div>`).join('');
    return viewHeader('Scheduler', `${jobs.length} jobs`, statusPill(schedulerHealth())) + `<div class="job-head"><span>Job</span><span>Next</span><span>Last</span><span>Avg</span></div><div class="job-list">${rows}</div>`;
}

function queuesHealth() {
    if (!DATA.queues) return { status: 'dim', detail: 'no data' };
    const qs = DATA.queues.queues || [], hot = qs.filter(q => q.depth >= (q.warn || 8)).length, total = qs.reduce((a, q) => a + q.depth, 0);
    return { status: hot ? 'warn' : 'ok', detail: total + ' queued' + (hot ? ' · ' + hot + ' over threshold' : '') };
}
function renderQueues() {
    if (!DATA.queues) return viewHeader('Queues') + '<div class="muted pad">No queue data.</div>';
    const cards = (DATA.queues.queues || []).map(q => {
        const over = q.depth >= (q.warn || 8);
        return `<div class="qcard ${over ? 'warn' : ''}"><div class="qcard-h"><span class="qcard-name">${esc(q.name)}</span><span class="qcard-depth ${over ? 'warn' : ''}">${q.depth}</span></div>${bar(Math.min(100, (q.depth / ((q.warn || 8) * 1.5)) * 100), over ? 'warn' : '')}<div class="qcard-f"><span>in-flight ${q.in_flight}</span><span>${q.rate_per_min}/min</span><span>oldest ${fmtDur(q.oldest_age_s)}</span></div></div>`;
    }).join('');
    return viewHeader('Queues', `${(DATA.queues.queues || []).length} queues`, statusPill(queuesHealth())) + `<div class="qgrid">${cards}</div>`;
}

function wlState(s) { s = String(s || '').toLowerCase(); if (s === 'running') return 'ok'; if (s === 'retrying') return 'warn'; if (['blocked', 'failed'].includes(s)) return 'bad'; return 'dim'; }
function workloadsHealth() {
    if (!DATA.workloads) return { status: 'dim', detail: 'no data' };
    const w = DATA.workloads.workloads || [], bad = w.filter(x => ['blocked', 'failed'].includes(x.state)).length, retry = w.filter(x => x.state === 'retrying').length, run = w.filter(x => x.state === 'running').length;
    return { status: (bad || retry) ? 'warn' : 'ok', detail: run + ' running · ' + (bad + retry) + ' need attention' };
}
function renderWorkloads() {
    if (!DATA.workloads) return viewHeader('Workloads') + '<div class="muted pad">No workloads.</div>';
    const w = DATA.workloads.workloads || [];
    const states = ['running', 'queued', 'retrying', 'blocked', 'completed', 'failed'];
    const counts = {}; w.forEach(x => counts[x.state] = (counts[x.state] || 0) + 1);
    const chips = states.filter(s => counts[s]).map(s => `<span class="wl-chip ${wlState(s)}">${counts[s]} ${s}</span>`).join('');
    const order = { running: 0, retrying: 1, blocked: 2, queued: 3, completed: 4, failed: 5 };
    const rows = w.slice().sort((a, b) => (order[a.state] == null ? 9 : order[a.state]) - (order[b.state] == null ? 9 : order[b.state])).map(x => `<div class="wl ${wlState(x.state)}"><div class="wl-l">${sdot(wlState(x.state))}<div><div class="wl-name">${esc(x.name)}<span class="wl-kind">${esc(x.kind)}</span></div><div class="wl-agent">${esc(x.agent || '')}</div></div></div><div class="wl-state"><span class="wl-badge ${wlState(x.state)}">${esc(x.state)}</span>${x.progress != null ? `<div class="wl-prog">${bar(x.progress * 100, '')}</div>` : ''}</div><div class="wl-meta">${x.duration_s ? fmtDur(x.duration_s) : '—'}${x.restarts ? ' · ↻' + x.restarts : ''}<div class="wl-sub">${x.started ? relTime(x.started) : 'not started'}</div></div></div>`).join('');
    return viewHeader('Workloads', chips, statusPill(workloadsHealth())) + `<div class="wl-head"><span>Workload</span><span>State</span><span>Runtime</span></div><div class="wl-list">${rows}</div>`;
}

function automationHealth() {
    if (!DATA.automation) return { status: 'dim', detail: 'no data' };
    const a = DATA.automation.automations || [], en = a.filter(x => x.enabled).length;
    return { status: 'ok', detail: en + '/' + a.length + ' enabled' };
}
function renderAutomation() {
    if (!DATA.automation) return viewHeader('Automation') + '<div class="muted pad">No automation data.</div>';
    const rows = (DATA.automation.automations || []).map(x => `<div class="auto ${x.enabled ? '' : 'off'}"><div class="auto-l">${sdot(x.enabled ? (x.status === 'firing' ? 'warn' : 'ok') : 'dim')}<div><div class="auto-name">${esc(x.name)}</div><div class="auto-target">→ ${esc(x.target)}</div></div></div><div class="job-cell"><span class="trig-badge">${esc(x.trigger)}</span></div><div class="job-cell">${x.last_fired ? relTime(x.last_fired) : 'never'}<div class="job-sub">${x.fire_count} fires</div></div><div class="job-cell"><span class="auto-status ${esc(x.enabled ? x.status : 'disabled')}">${esc(x.enabled ? x.status : 'disabled')}</span></div></div>`).join('');
    return viewHeader('Automation', `${(DATA.automation.automations || []).length} rules`, statusPill(automationHealth())) + `<div class="auto-head"><span>Rule</span><span>Trigger</span><span>Last Fired</span><span>State</span></div><div class="auto-list">${rows}</div>`;
}

/* ============================ Phase 4 · Intelligence ============================ */
function knowledgeHealth() {
    if (!DATA.knowledge) return { status: 'dim', detail: 'no data' };
    return { status: 'ok', detail: DATA.knowledge.nodes.length + ' nodes · ' + DATA.knowledge.edges.length + ' edges' };
}
function typeClass(t) { return 'kt-' + String(t || 'idea'); }

// deterministic force-directed layout (no randomness → stable each render)
function layoutGraph(nodes, edges, W, H) {
    const n = nodes.length, pos = {};
    nodes.forEach((nd, i) => { const a = (i / n) * Math.PI * 2; pos[nd.id] = { x: W / 2 + Math.cos(a) * W * 0.3, y: H / 2 + Math.sin(a) * H * 0.3, vx: 0, vy: 0 }; });
    const adj = edges.filter(e => pos[e.source] && pos[e.target]);
    const K = Math.sqrt((W * H) / Math.max(1, n));
    for (let it = 0; it < 240; it++) {
        for (let i = 0; i < n; i++) { const pa = pos[nodes[i].id]; for (let j = i + 1; j < n; j++) { const pb = pos[nodes[j].id]; let dx = pa.x - pb.x, dy = pa.y - pb.y, d = Math.sqrt(dx * dx + dy * dy) || 0.01; const f = (K * K) / d * 0.02, ux = dx / d, uy = dy / d; pa.vx += ux * f; pa.vy += uy * f; pb.vx -= ux * f; pb.vy -= uy * f; } }
        for (const e of adj) { const pa = pos[e.source], pb = pos[e.target]; let dx = pa.x - pb.x, dy = pa.y - pb.y, d = Math.sqrt(dx * dx + dy * dy) || 0.01; const f = (d * d) / K * 0.005, ux = dx / d, uy = dy / d; pa.vx -= ux * f; pa.vy -= uy * f; pb.vx += ux * f; pb.vy += uy * f; }
        for (const nd of nodes) { const p = pos[nd.id]; p.vx += (W / 2 - p.x) * 0.005; p.vy += (H / 2 - p.y) * 0.005; p.x += Math.max(-8, Math.min(8, p.vx)); p.y += Math.max(-8, Math.min(8, p.vy)); p.vx *= 0.85; p.vy *= 0.85; }
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const nd of nodes) { const p = pos[nd.id]; minX = Math.min(minX, p.x); minY = Math.min(minY, p.y); maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y); }
    const pad = 46, sx = (W - 2 * pad) / Math.max(1, maxX - minX), sy = (H - 2 * pad) / Math.max(1, maxY - minY);
    for (const nd of nodes) { const p = pos[nd.id]; p.x = pad + (p.x - minX) * sx; p.y = pad + (p.y - minY) * sy; }
    return pos;
}
function renderKnowledge() {
    if (!DATA.knowledge) return viewHeader('Knowledge Graph') + '<div class="muted pad">No graph data.</div>';
    const K = DATA.knowledge, W = 900, H = 520, pos = layoutGraph(K.nodes, K.edges, W, H);
    const edges = K.edges.filter(e => pos[e.source] && pos[e.target]).map(e => { const a = pos[e.source], b = pos[e.target]; return `<line class="kg-edge" x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}"/>`; }).join('');
    const nodes = K.nodes.map(nd => { const p = pos[nd.id], r = 6 + (nd.weight || 4); return `<g class="kg-node ${typeClass(nd.type)}"><circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r}"/><text x="${p.x.toFixed(1)}" y="${(p.y + r + 12).toFixed(1)}" text-anchor="middle">${esc(nd.label)}</text><title>${esc(nd.label)} · ${esc(nd.type)}</title></g>`; }).join('');
    const types = Array.from(new Set(K.nodes.map(n => n.type)));
    const legend = types.map(t => `<span class="kg-leg"><span class="kg-dot ${typeClass(t)}"></span>${esc(t)}</span>`).join('');
    return viewHeader('Knowledge Graph', 'Entities & relationships', statusPill(knowledgeHealth()))
        + `<div class="kg-legend">${legend}</div><div class="kg-wrap"><svg class="kg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${edges}${nodes}</svg></div>`;
}

function renderRelationships() {
    if (!DATA.knowledge) return viewHeader('Relationships') + '<div class="muted pad">No data.</div>';
    const K = DATA.knowledge, byId = {}; K.nodes.forEach(n => byId[n.id] = n);
    const deg = {}; K.edges.forEach(e => { deg[e.source] = (deg[e.source] || 0) + 1; deg[e.target] = (deg[e.target] || 0) + 1; });
    const nodes = K.nodes.slice().sort((a, b) => (deg[b.id] || 0) - (deg[a.id] || 0));
    const rows = nodes.map(nd => {
        const out = K.edges.filter(e => e.source === nd.id).map(e => `<span class="rel-edge">${esc(e.rel)} → <b>${esc((byId[e.target] || {}).label || e.target)}</b></span>`);
        const inc = K.edges.filter(e => e.target === nd.id).map(e => `<span class="rel-edge in"><b>${esc((byId[e.source] || {}).label || e.source)}</b> ${esc(e.rel)} →</span>`);
        const all = out.concat(inc);
        if (!all.length) return '';
        return `<div class="relrow"><div class="rel-node"><span class="kg-dot ${typeClass(nd.type)}"></span><span class="rel-name">${esc(nd.label)}</span><span class="rel-deg">${deg[nd.id] || 0}</span></div><div class="rel-edges">${all.join('')}</div></div>`;
    }).join('');
    return viewHeader('Relationships', `${K.edges.length} relationships · ${K.nodes.length} entities`, statusPill(knowledgeHealth())) + `<div class="rel-list">${rows}</div>`;
}

let semQuery = '';
function setSemanticQuery(q) { semQuery = q; const el = document.getElementById('sem-results'); if (el) el.innerHTML = semanticResults(); }
function buildSemanticIndex() {
    const idx = [];
    (DATA.knowledge ? DATA.knowledge.nodes : []).forEach(n => idx.push({ kind: 'entity', title: n.label, sub: n.type, text: n.label + ' ' + n.type }));
    ((DATA.memory && DATA.memory.recent) || []).forEach(r => idx.push({ kind: 'memory', title: r.detail, sub: r.op, text: r.detail }));
    ((DATA.reflection && DATA.reflection.entries) || []).forEach(e => idx.push({ kind: 'insight', title: e.insight, sub: 'reflection', text: e.insight + ' ' + e.action }));
    ((DATA.planning && DATA.planning.goals) || []).forEach(g => idx.push({ kind: 'goal', title: g.title, sub: g.status, text: g.title }));
    ((DATA.agents && DATA.agents.agents) || []).forEach(a => idx.push({ kind: 'agent', title: a.name, sub: a.role, text: a.name + ' ' + a.role + ' ' + (a.current_task || '') }));
    ((DATA.diagnostics && DATA.diagnostics.events) || []).forEach(e => idx.push({ kind: 'diagnostic', title: e.message, sub: e.subsystem, text: e.message }));
    return idx;
}
function semanticResults() {
    const q = semQuery.trim().toLowerCase(), idx = buildSemanticIndex();
    let res = q ? idx.filter(x => x.text.toLowerCase().includes(q)) : idx;
    res = res.slice(0, 50);
    if (!res.length) return '<div class="muted pad">No matches.</div>';
    return res.map(x => `<div class="sr"><span class="sr-kind ${esc(x.kind)}">${esc(x.kind)}</span><span class="sr-title">${esc(x.title)}</span><span class="sr-sub">${esc(x.sub)}</span></div>`).join('');
}
function semanticHealth() { return { status: 'ok', detail: buildSemanticIndex().length + ' indexed' }; }
function renderSemanticSearch() {
    return viewHeader('Semantic Search', 'Cross-subsystem index', statusPill(semanticHealth()))
        + `<input class="sem-input" id="sem-input" placeholder="Search entities, memory, insights, goals, agents…" oninput="setSemanticQuery(this.value)" value="${esc(semQuery)}">`
        + `<div class="sr-list" id="sem-results">${semanticResults()}</div>`;
}

function contextHealth() {
    if (!DATA.context) return { status: 'dim', detail: 'no data' };
    const w = DATA.context.window || {};
    return { status: w.pct >= 85 ? 'warn' : 'ok', detail: (w.pct || 0) + '% window used' };
}
function renderContext() {
    if (!DATA.context) return viewHeader('Context Explorer') + '<div class="muted pad">No context data.</div>';
    const C = DATA.context, w = C.window || {}, slotsArr = C.slots || [];
    const maxTok = Math.max.apply(null, slotsArr.map(s => s.tokens).concat([1]));
    const slots = slotsArr.slice().sort((a, b) => b.tokens - a.tokens).map(s => `<div class="ctx-slot"><div class="ctx-h"><span class="ctx-kind ${esc(s.kind)}">${esc(s.kind)}</span><span class="ctx-label">${esc(s.label)}${s.pinned ? ' <span class="ctx-pin">pinned</span>' : ''}</span><span class="ctx-tok">${fmtNum(s.tokens)}</span></div>${bar((s.tokens / maxTok) * 100, '')}</div>`).join('');
    const wbar = `<div class="ctx-window"><div class="ctx-win-h"><span>Context Window</span><b>${fmtNum(w.used_tokens)} / ${fmtNum(w.max_tokens)} · ${w.pct}%</b></div>${bar(w.pct, w.pct >= 85 ? 'warn' : '')}</div>`;
    return viewHeader('Context Explorer', 'What is loaded into working context', statusPill(contextHealth()))
        + `<div class="mc-grid">` + panel('Window Utilization', wbar, 'span2') + panel('Loaded Slots (' + slotsArr.length + ')', slots, 'span2') + `</div>`;
}

/* ============================ router ============================ */
function route() {
    const hash = (location.hash || '#/mission').replace(/^#\//, '');
    const parts = hash.split('/');
    let id = parts[0] || 'mission';
    let sub = getSub(id);
    if (!sub) { id = 'mission'; sub = getSub(id); }
    currentRoute = id;
    let html;
    if (sub.on && sub.render) {
        if (id === 'reports') reportIdx = Math.max(0, Math.min(DATA.reports.length - 1, parseInt(parts[1], 10) || 0));
        html = sub.render();
    } else {
        html = renderPlanned(sub.id, sub.label);
    }
    document.getElementById('view').innerHTML = html;
    renderNav();
    if (id === 'reports') { const b = document.getElementById('copy-md'); if (b) b.addEventListener('click', () => copyMarkdown(DATA.reports[reportIdx])); }
    document.getElementById('view').scrollTop = 0;
}

/* ---------- reports copy ---------- */
function copyMarkdown(r) {
    if (!r) return;
    const L = [`# Markus Self-Audit — ${r.date}`, '', `Composite ${fmt1(rComposite(r))}/10`, '', '## North Star'];
    for (const [k, label] of RMETRICS) { const s = rScore(r.scores, k); if (s != null) L.push(`- ${label}: ${fmt1(s)}/10`); }
    if (r.findings) { L.push('', '## Findings'); r.findings.forEach(f => L.push(`- [${(f.severity || 'info').toUpperCase()}] ${f.type}: ${f.message}`)); }
    if (r.proposals) { L.push('', '## Proposals'); r.proposals.forEach(p => L.push(`- ${p.title} (${p.status}): ${p.summary}`)); }
    const text = L.join('\n');
    const el = document.getElementById('copy-md');
    const done = () => { if (el) { el.textContent = '✓ Copied'; setTimeout(() => el.innerHTML = '⧉ Markdown', 1500); } };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done).catch(done); else done();
}

/* ============================ boot / pin ============================ */
async function boot() {
    await loadAll();
    startHeartbeat();
    renderTopStrip();
    if (!location.hash) location.hash = '#/mission';
    route();
    window.addEventListener('hashchange', route);
    // Note: no top-strip re-render interval — it would restart the EKG animation.
    // The heartbeat ticker (startHeartbeat) updates the pulse in place.
}

function showConsole() { document.getElementById('pin-gate').classList.add('hidden'); document.getElementById('console').classList.remove('hidden'); }
function authPIN() {
    const inp = document.getElementById('pin-input'), err = document.getElementById('pin-error');
    if (inp.value === EXPECTED_PIN) { sessionStorage.setItem('markus-auth', 'true'); showConsole(); boot(); }
    else { err.textContent = 'ACCESS DENIED'; inp.value = ''; inp.focus(); }
}
window.addEventListener('load', () => {
    document.getElementById('pin-submit').addEventListener('click', authPIN);
    document.getElementById('pin-input').addEventListener('keypress', e => { if (e.key === 'Enter') authPIN(); });
    const lo = document.getElementById('logout-btn'); if (lo) lo.addEventListener('click', () => { sessionStorage.removeItem('markus-auth'); location.reload(); });
    if (sessionStorage.getItem('markus-auth') === 'true') { showConsole(); boot(); }
    else document.getElementById('pin-input').focus();
});
