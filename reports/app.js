/* MARKUS OS — System Console
   Runtime state (data/*.json) is the source of truth. Reports are one output. */

const EXPECTED_PIN = '000000';
var DATA = { system: null, runtime: null, agents: null, diagnostics: null, events: null, heartbeat: null, reports: [] };
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
    const [system, runtime, agents, diagnostics, events, heartbeat, manifest] = await Promise.all([
        getJSON('./data/system.json'), getJSON('./data/runtime.json'), getJSON('./data/agents.json'),
        getJSON('./data/diagnostics.json'), getJSON('./data/events.json'), getJSON('./data/heartbeat.json'),
        getJSON('./data/manifest.json')
    ]);
    DATA.system = system; DATA.runtime = runtime; DATA.agents = agents;
    DATA.diagnostics = diagnostics; DATA.events = events; DATA.heartbeat = heartbeat;
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

    { id: 'event-stream', label: 'Event Stream', phase: 'Phase 1 · Observability' },
    { id: 'timeline',     label: 'Timeline',     phase: 'Phase 1 · Observability' },
    { id: 'logs',         label: 'Logs',         phase: 'Phase 1 · Observability' },
    { id: 'alerts',       label: 'Alerts',       phase: 'Phase 1 · Observability' },
    { id: 'health',       label: 'Health',       phase: 'Phase 1 · Observability' },

    { id: 'memory',     label: 'Memory',     phase: 'Phase 2 · Cognition' },
    { id: 'reasoning',  label: 'Reasoning',  phase: 'Phase 2 · Cognition' },
    { id: 'reflection', label: 'Reflection', phase: 'Phase 2 · Cognition' },
    { id: 'planning',   label: 'Planning',   phase: 'Phase 2 · Cognition' },

    { id: 'scheduler',  label: 'Scheduler',  phase: 'Phase 3 · Execution' },
    { id: 'queues',     label: 'Queues',     phase: 'Phase 3 · Execution' },
    { id: 'workloads',  label: 'Workloads',  phase: 'Phase 3 · Execution' },
    { id: 'automation', label: 'Automation', phase: 'Phase 3 · Execution' },

    { id: 'knowledge-graph',  label: 'Knowledge Graph',  phase: 'Phase 4 · Intelligence' },
    { id: 'relationships',    label: 'Relationships',    phase: 'Phase 4 · Intelligence' },
    { id: 'semantic-search',  label: 'Semantic Search',  phase: 'Phase 4 · Intelligence' },
    { id: 'context-explorer', label: 'Context Explorer', phase: 'Phase 4 · Intelligence' },

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
    const subs = SUBSYSTEMS.filter(s => s.on && s.health).map(s => ({ id: s.id, label: s.tile || s.label, h: s.health() }));
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
