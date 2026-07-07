// Markus Reports Log — Self-Enhancement Viewer

// Simple PIN "curtain" (deterrent, not real security)
const EXPECTED_PIN = '000000';

// Material "content_copy" icon
const COPY_ICON = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>';

// Metric keys → display labels (0–10 scale)
const METRICS = [
    { key: 'response_quality', label: 'Response Quality' },
    { key: 'cost_efficiency', label: 'Cost Efficiency' },
    { key: 'task_completion', label: 'Task Completion' },
    { key: 'autonomy', label: 'Autonomy' },
    { key: 'speed', label: 'Speed' },
    { key: 'initiative', label: 'Initiative' }
];

// ---------- PIN ----------
document.getElementById('pin-submit').addEventListener('click', authenticatePIN);
document.getElementById('pin-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') authenticatePIN();
});

function authenticatePIN() {
    const pinInput = document.getElementById('pin-input');
    const errorDiv = document.getElementById('pin-error');
    const pin = pinInput.value;
    if (!pin) { errorDiv.textContent = 'Enter PIN'; return; }
    if (pin === EXPECTED_PIN) {
        sessionStorage.setItem('markus-auth', 'true');
        showDashboard();
        loadReports();
    } else {
        errorDiv.textContent = 'Invalid PIN';
        pinInput.value = '';
        pinInput.focus();
    }
}

function checkAuthentication() {
    if (sessionStorage.getItem('markus-auth') !== 'true') {
        document.getElementById('pin-gate').classList.remove('hidden');
        document.getElementById('dashboard').classList.add('hidden');
        document.getElementById('pin-input').focus();
    } else {
        showDashboard();
        loadReports();
    }
}

function showDashboard() {
    document.getElementById('pin-gate').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');
}

document.getElementById('logout-btn').addEventListener('click', () => {
    sessionStorage.removeItem('markus-auth');
    location.reload();
});

// ---------- Helpers ----------
function escapeHtml(str) {
    return String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatDate(dateStr) {
    const date = new Date((dateStr || '') + 'T00:00:00');
    if (isNaN(date)) return dateStr || '';
    return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateShort(dateStr) {
    const date = new Date((dateStr || '') + 'T00:00:00');
    if (isNaN(date)) return dateStr || '';
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatTimestamp(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    if (isNaN(d)) return ts; // already human-readable
    return d.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
}

// One-decimal number, trimming trailing .0
function fmt1(n) {
    if (typeof n !== 'number' || isNaN(n)) return '—';
    return (Math.round(n * 10) / 10).toString();
}

// Read a metric score (supports {score,...} objects or bare numbers)
function metricScore(scores, key) {
    if (!scores) return null;
    const v = scores[key];
    if (typeof v === 'number') return v;
    if (v && typeof v.score === 'number') return v.score;
    return null;
}

function metricDetails(scores, key) {
    const v = scores && scores[key];
    return v && typeof v === 'object' ? (v.details || '') : '';
}

// Composite on a 0–10 scale
function compositeScore(report) {
    if (!report) return null;
    if (typeof report.composite === 'number') return report.composite;
    if (report.scores) {
        let sum = 0, wsum = 0;
        for (const m of METRICS) {
            const s = metricScore(report.scores, m.key);
            if (s === null) continue;
            const w = (report.scores[m.key] && report.scores[m.key].weight) || 1;
            sum += s * w; wsum += w;
        }
        if (wsum) return sum / wsum;
    }
    return null;
}

function deltaMarkup(delta) {
    if (delta === null || isNaN(delta)) return '<span class="trend flat">—</span>';
    const r = Math.round(delta * 10) / 10;
    if (r > 0) return `<span class="trend up">▲ ${fmt1(r)}</span>`;
    if (r < 0) return `<span class="trend down">▼ ${fmt1(Math.abs(r))}</span>`;
    return '<span class="trend flat">±0</span>';
}

function deltaText(delta) {
    if (delta === null || isNaN(delta)) return 'n/a';
    const r = Math.round(delta * 10) / 10;
    if (r > 0) return `+${fmt1(r)}`;
    if (r < 0) return `-${fmt1(Math.abs(r))}`;
    return '0';
}

// Chronological (oldest→newest) list of a metric's scores across all reports
function metricSeries(key) {
    const chrono = [...allReports].sort((a, b) => new Date(a.date) - new Date(b.date));
    const out = [];
    for (const r of chrono) {
        const s = metricScore(r.scores, key);
        if (s !== null) out.push(s);
    }
    return out;
}

// Inline-SVG sparkline for a series of 0–10 scores (auto-scaled)
function buildSparkline(values) {
    const W = 300, H = 44, m = 6;
    if (!values.length) return '';
    let lo = Math.min(...values), hi = Math.max(...values);
    if (hi - lo < 1) { const mid = (hi + lo) / 2; lo = mid - 0.75; hi = mid + 0.75; }
    else { const pad = (hi - lo) * 0.22; lo -= pad; hi += pad; }
    const rng = (hi - lo) || 1;
    const n = values.length;
    const xAt = (i) => n === 1 ? W : (i / (n - 1)) * W;
    const yAt = (v) => m + (1 - (v - lo) / rng) * (H - 2 * m);

    const arr = n === 1
        ? [[0, yAt(values[0])], [W, yAt(values[0])]]
        : values.map((v, i) => [xAt(i), yAt(v)]);
    const fmt = (p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    const poly = arr.map(fmt).join(' ');
    const areaD = `M0,${H} L${arr.map(fmt).join(' L')} L${W},${H} Z`;
    const last = arr[arr.length - 1];

    return `<svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-hidden="true">
        <path class="spark-area" d="${areaD}"/>
        <polyline class="spark-line" points="${poly}" vector-effect="non-scaling-stroke"/>
        <circle class="spark-dot" cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2.6" vector-effect="non-scaling-stroke"/>
    </svg>`;
}

// info | warning | error → css class; anything else → info
function severityClass(sev) {
    const s = String(sev || 'info').toLowerCase();
    return ['success', 'warning', 'error', 'info'].includes(s) ? s : 'info';
}

// ---------- Load ----------
let allReports = []; // newest first

async function loadReports() {
    const listContainer = document.getElementById('reports-list');
    try {
        const manifestResponse = await fetch('./data/manifest.json');
        if (!manifestResponse.ok) throw new Error('Could not load manifest');
        const manifest = await manifestResponse.json();
        const files = Array.isArray(manifest) ? manifest : (manifest.reports || []);

        const reports = [];
        for (const file of files) {
            try {
                const response = await fetch(`./data/${file}`);
                if (response.ok) reports.push(await response.json());
            } catch (e) {
                console.error(`Failed to load ${file}`, e);
            }
        }

        reports.sort((a, b) => new Date(b.date) - new Date(a.date));
        allReports = reports;

        listContainer.innerHTML = '';
        reports.forEach((report, idx) => {
            const item = document.createElement('li');
            item.className = 'report-list-item' + (idx === 0 ? ' active' : '');
            const comp = compositeScore(report);
            const prior = reports[idx + 1];
            const delta = prior ? (comp - compositeScore(prior)) : null;
            item.innerHTML = `
                <span class="report-date-label">${escapeHtml(formatDateShort(report.date))}</span>
                <span class="report-score"><span class="pct">${fmt1(comp)}</span>/10 ${deltaMarkup(delta)}</span>
            `;
            item.addEventListener('click', () => selectReport(idx, item));
            listContainer.appendChild(item);
        });

        if (reports.length > 0) {
            selectReport(0, listContainer.querySelector('.report-list-item'));
        } else {
            listContainer.innerHTML = '<li class="loading">No reports yet</li>';
        }
    } catch (error) {
        console.error('Error loading reports:', error);
        listContainer.innerHTML = '<li class="loading">Error loading reports</li>';
    }
}

// ---------- Select / Render ----------
function selectReport(idx, listItem) {
    document.querySelectorAll('.report-list-item').forEach(el => el.classList.remove('active'));
    if (listItem) listItem.classList.add('active');

    const report = allReports[idx];
    const prior = allReports[idx + 1] || null;

    const detailPane = document.getElementById('reports-detail');
    detailPane.innerHTML = renderReportDetail(report, prior);

    wireCopy('copy-md-btn', () => buildMarkdown(report, prior));
    wireCopy('copy-json-btn', () => JSON.stringify(report, null, 2));
}

function renderReportDetail(report, prior) {
    const comp = compositeScore(report);
    const priorComp = prior ? compositeScore(prior) : null;
    const compDelta = priorComp === null ? null : comp - priorComp;

    let html = `
        <div class="report-detail">
            <div class="report-header">
                <div>
                    <div class="report-title">${escapeHtml(formatDate(report.date))}</div>
                    <div class="report-meta">${escapeHtml(formatTimestamp(report.timestamp))}${prior ? ' · prior: ' + escapeHtml(prior.date || formatDateShort(prior.date)) : ''}</div>
                </div>
                <div class="rh-side">
                    <div class="header-actions">
                        <span id="copy-md-btn" class="copy-link" role="button" tabindex="0" title="Copy report as Markdown">${COPY_ICON}<span class="lbl">Markdown</span></span>
                        <span id="copy-json-btn" class="copy-link" role="button" tabindex="0" title="Copy raw JSON">${COPY_ICON}<span class="lbl">JSON</span></span>
                    </div>
                    <div class="report-avg">
                        <span class="big">${fmt1(comp)}<span class="denom">/10</span></span>
                        <span class="key">Composite ${deltaMarkup(compDelta)}</span>
                    </div>
                </div>
            </div>
    `;

    // Scores: linear progress bars + trend + detail
    if (report.scores) {
        html += `<div class="section"><div class="section-title">North Star Metrics</div><div class="scores-list">`;
        for (const m of METRICS) {
            const score = metricScore(report.scores, m.key);
            if (score === null) continue;
            const priorScore = prior ? metricScore(prior.scores, m.key) : null;
            const delta = priorScore === null ? null : score - priorScore;
            const details = metricDetails(report.scores, m.key);
            html += `
                <div class="score-item">
                    <div class="score-top">
                        <span class="score-name">${escapeHtml(m.label)}</span>
                        <span class="score-figs"><span class="score-value">${fmt1(score)}</span><span class="score-max">/10</span> ${deltaMarkup(delta)}</span>
                    </div>
                    ${buildSparkline(metricSeries(m.key))}
                    ${details ? `<div class="score-detail">${escapeHtml(details)}</div>` : ''}
                </div>
            `;
        }
        html += `</div></div>`;
    }

    // Findings
    if (report.findings && report.findings.length) {
        html += `<div class="section"><div class="section-title">Findings</div><div class="findings-log">`;
        for (const f of report.findings) {
            const sev = severityClass(f.severity);
            const chipClass = sev === 'warning' ? 'sev-warning' : sev === 'error' ? 'sev-error' : '';
            html += `
                <div class="finding-line">
                    <span class="chip ${chipClass}">${escapeHtml(f.severity || 'info')}</span>
                    <span class="finding-type">${escapeHtml(f.type || 'note')}</span>
                    <span class="finding-message">${escapeHtml(f.message || f.description || '')}</span>
                </div>
            `;
        }
        html += `</div></div>`;
    }

    // Proposals
    if (report.proposals && report.proposals.length) {
        html += `<div class="section"><div class="section-title">Proposals</div><div class="proposals-log">`;
        for (const p of report.proposals) {
            const status = (p.status || 'pending').toLowerCase();
            html += `
                <div class="proposal-item">
                    <div class="proposal-line">
                        <span class="chip">${escapeHtml(status)}</span>
                        <span class="proposal-title">${escapeHtml(p.title || '')}</span>
                        ${p.type ? `<span class="proposal-type">${escapeHtml(p.type)}</span>` : ''}
                        ${p.id ? `<span class="proposal-id">${escapeHtml(p.id)}</span>` : ''}
                    </div>
                    <div class="proposal-summary">${escapeHtml(p.summary || p.description || '')}</div>
                </div>
            `;
        }
        html += `</div></div>`;
    }

    // Modules run
    if (report.modules_run && report.modules_run.length) {
        html += `<div class="section"><div class="section-title">Modules Run</div><div class="modules-line">`;
        html += report.modules_run.map(mod => `<span class="mod">${escapeHtml(mod)}</span>`).join('');
        html += `</div></div>`;
    }

    html += `</div>`;
    return html;
}

// ---------- Markdown export ----------
function buildMarkdown(report, prior) {
    const comp = compositeScore(report);
    const priorComp = prior ? compositeScore(prior) : null;
    const compDelta = priorComp === null ? null : comp - priorComp;

    const lines = [];
    lines.push(`# Markus Self-Enhancement Report — ${formatDateShort(report.date)}`);
    const metaBits = [formatTimestamp(report.timestamp), `Composite ${fmt1(comp)}/10 (${deltaText(compDelta)} vs prior)`].filter(Boolean);
    lines.push(`_${metaBits.join(' · ')}_`);
    lines.push('');

    if (report.scores) {
        lines.push('## North Star Metrics');
        lines.push('');
        lines.push('| Metric | Score | Δ vs prior | Notes |');
        lines.push('| --- | --- | --- | --- |');
        for (const m of METRICS) {
            const score = metricScore(report.scores, m.key);
            if (score === null) continue;
            const priorScore = prior ? metricScore(prior.scores, m.key) : null;
            const delta = priorScore === null ? null : score - priorScore;
            const details = metricDetails(report.scores, m.key).replace(/\|/g, '\\|');
            lines.push(`| ${m.label} | ${fmt1(score)}/10 | ${deltaText(delta)} | ${details} |`);
        }
        lines.push('');
    }

    if (report.findings && report.findings.length) {
        lines.push('## Findings');
        lines.push('');
        for (const f of report.findings) {
            lines.push(`- **[${(f.severity || 'info').toUpperCase()}] ${f.type || 'note'}** — ${f.message || f.description || ''}`);
        }
        lines.push('');
    }

    if (report.proposals && report.proposals.length) {
        lines.push('## Proposals');
        lines.push('');
        for (const p of report.proposals) {
            const tag = [p.type, p.id].filter(Boolean).join(' · ');
            lines.push(`- **${p.title || ''}** _(${p.status || 'pending'}${tag ? ' · ' + tag : ''})_ — ${p.summary || p.description || ''}`);
        }
        lines.push('');
    }

    if (report.modules_run && report.modules_run.length) {
        lines.push('## Modules Run');
        lines.push('');
        lines.push(report.modules_run.map(m => `\`${m}\``).join(', '));
        lines.push('');
    }

    return lines.join('\n').trim() + '\n';
}

function wireCopy(id, getContent) {
    const btn = document.getElementById(id);
    if (!btn) return;
    const act = () => copyOut(btn, getContent());
    btn.addEventListener('click', act);
    btn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); act(); }
    });
}

function copyOut(btn, content) {
    const label = btn.querySelector('.lbl') || btn;
    const original = label.textContent;
    const done = () => { label.textContent = 'Copied!'; setTimeout(() => (label.textContent = original), 1600); };
    const fail = () => { label.textContent = 'Failed'; setTimeout(() => (label.textContent = original), 1600); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(content).then(done).catch(() => fallbackCopy(content, done, fail));
    } else {
        fallbackCopy(content, done, fail);
    }
}

function fallbackCopy(content, done, fail) {
    try {
        const ta = document.createElement('textarea');
        ta.value = content;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        done();
    } catch (e) { fail(); }
}

// ---------- Init ----------
window.addEventListener('load', checkAuthentication);
