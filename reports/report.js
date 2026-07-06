/* ── Markus Reports Dashboard — report.js ────────────────────── */
(function () {
  'use strict';

  const PIN_HASH = '91b4d142823f7d20c5f08df69122de43f35f057a988d9619f6d3138485c9a203';
  const SESSION_KEY = 'markus_reports_auth';

  // ── Helpers ───────────────────────────────────────────────
  async function sha256(str) {
    const buf = new TextEncoder().encode(str);
    const hash = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  function scoreColor(score) {
    // score is 0-10
    if (score >= 8) return { color: 'var(--green)', bg: 'var(--green-dim)' };
    if (score >= 5) return { color: 'var(--yellow)', bg: 'var(--yellow-dim)' };
    return { color: 'var(--red)', bg: 'var(--red-dim)' };
  }

  function pct(score) {
    return Math.round((score / 10) * 100);
  }

  function formatDate(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function formatTimestamp(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true
    });
  }

  function metricLabel(key) {
    const labels = {
      response_quality: 'Response Quality',
      cost_efficiency: 'Cost Efficiency',
      task_completion: 'Task Completion',
      autonomy: 'Autonomy',
      speed: 'Speed',
      initiative: 'Initiative'
    };
    return labels[key] || key;
  }

  function severityClass(sev) {
    const map = { info: 'badge-info', warning: 'badge-warning', error: 'badge-error', success: 'badge-success' };
    return map[sev] || 'badge-info';
  }

  function statusClass(status) {
    const map = { pending: 'status-pending', approved: 'status-approved', rejected: 'status-rejected' };
    return map[status] || 'status-pending';
  }

  // ── DOM refs ──────────────────────────────────────────────
  const $pinScreen = document.getElementById('pin-screen');
  const $pinInput = document.getElementById('pin-input');
  const $pinSubmit = document.getElementById('pin-submit');
  const $pinError = document.getElementById('pin-error');
  const $app = document.getElementById('app');
  const $hamburger = document.getElementById('hamburger');
  const $sidebar = document.getElementById('sidebar');
  const $sidebarOverlay = document.getElementById('sidebar-overlay');
  const $sidebarClose = document.getElementById('sidebar-close');
  const $reportList = document.getElementById('report-list');
  const $reportContent = document.getElementById('report-content');
  const $emptyState = document.getElementById('empty-state');
  const $reportView = document.getElementById('report-view');
  const $signOut = document.getElementById('sign-out');

  let reports = [];
  let manifest = [];

  // ── PIN Auth ──────────────────────────────────────────────
  async function checkPin(pin) {
    const hash = await sha256(pin);
    return hash === PIN_HASH;
  }

  async function handlePinSubmit() {
    const pin = $pinInput.value;
    if (await checkPin(pin)) {
      sessionStorage.setItem(SESSION_KEY, '1');
      $pinScreen.classList.add('hidden');
      $app.classList.remove('hidden');
      loadReports();
    } else {
      $pinError.textContent = 'Incorrect code';
      $pinInput.classList.add('shake');
      setTimeout(() => $pinInput.classList.remove('shake'), 400);
      $pinInput.value = '';
      $pinInput.focus();
    }
  }

  $pinSubmit.addEventListener('click', handlePinSubmit);
  $pinInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') handlePinSubmit(); });

  $signOut.addEventListener('click', () => {
    sessionStorage.removeItem(SESSION_KEY);
    $app.classList.add('hidden');
    $pinScreen.classList.remove('hidden');
    $pinInput.value = '';
    $pinError.textContent = '';
    $pinInput.focus();
  });

  // Check session
  if (sessionStorage.getItem(SESSION_KEY) === '1') {
    $pinScreen.classList.add('hidden');
    $app.classList.remove('hidden');
    loadReports();
  } else {
    $pinInput.focus();
  }

  // ── Sidebar Toggle ────────────────────────────────────────
  function openSidebar() {
    $sidebar.classList.add('open');
    $sidebarOverlay.classList.remove('hidden');
  }
  function closeSidebar() {
    $sidebar.classList.remove('open');
    $sidebarOverlay.classList.add('hidden');
  }

  $hamburger.addEventListener('click', openSidebar);
  $sidebarClose.addEventListener('click', closeSidebar);
  $sidebarOverlay.addEventListener('click', closeSidebar);

  // ── Load Reports ──────────────────────────────────────────
  async function loadReports() {
    try {
      const res = await fetch('data/manifest.json?t=' + Date.now());
      manifest = await res.json();
    } catch {
      manifest = [];
    }

    if (!manifest.length) {
      $emptyState.classList.remove('hidden');
      $reportView.classList.add('hidden');
      return;
    }

    // Fetch all reports
    reports = [];
    for (const file of manifest) {
      try {
        const r = await fetch('data/' + file + '?t=' + Date.now());
        const data = await r.json();
        reports.push(data);
      } catch { /* skip broken files */ }
    }

    // Sort newest first
    reports.sort((a, b) => b.date.localeCompare(a.date));

    // Build sidebar
    renderSidebar();

    // Show first report
    if (reports.length) {
      $emptyState.classList.add('hidden');
      showReport(0);
    }
  }

  // ── Render Sidebar ────────────────────────────────────────
  function renderSidebar() {
    $reportList.innerHTML = '';
    reports.forEach((r, i) => {
      const li = document.createElement('li');
      li.innerHTML = `
        <div class="date">${formatDate(r.date)}</div>
        <div class="score">${pct(r.composite)}% composite</div>
      `;
      li.addEventListener('click', () => {
        showReport(i);
        closeSidebar();
      });
      $reportList.appendChild(li);
    });
  }

  // ── Render Report ─────────────────────────────────────────
  function showReport(index) {
    const r = reports[index];

    // Update sidebar active
    const items = $reportList.querySelectorAll('li');
    items.forEach((li, i) => li.classList.toggle('active', i === index));

    const compositeColor = scoreColor(r.composite);

    // Build metrics rows
    const metricsHTML = Object.entries(r.scores).map(([key, data]) => {
      const sc = scoreColor(data.score);
      return `
        <div class="metric-row">
          <span class="metric-name">${metricLabel(key)}</span>
          <div class="metric-bar-track">
            <div class="metric-bar-fill" style="width:${pct(data.score)}%;background:${sc.color}"></div>
          </div>
          <span class="metric-value" style="color:${sc.color}">${data.score}</span>
        </div>
      `;
    }).join('');

    // Build findings
    const findingsHTML = (r.findings && r.findings.length)
      ? r.findings.map(f => `
          <li class="finding-item">
            <span class="finding-badge ${severityClass(f.severity)}">${f.severity}</span>
            <span class="finding-text">${f.message}</span>
          </li>
        `).join('')
      : '<li class="finding-item"><span class="finding-text muted">No findings this run.</span></li>';

    // Build proposals
    const proposalsHTML = (r.proposals && r.proposals.length)
      ? r.proposals.map(p => `
          <li class="proposal-item">
            <div class="proposal-header">
              <span class="proposal-type">${p.type}</span>
              <span class="proposal-title">${p.title}</span>
              <span class="status-badge ${statusClass(p.status)}">${p.status}</span>
            </div>
            ${p.summary ? `<div class="proposal-summary">${p.summary}</div>` : ''}
          </li>
        `).join('')
      : '<li class="proposal-item"><span class="proposal-summary">No proposals this run.</span></li>';

    // Build modules
    const modulesHTML = (r.modules_run && r.modules_run.length)
      ? r.modules_run.map(m => `<span class="module-tag">${m}</span>`).join('')
      : '<span class="module-tag">—</span>';

    $reportView.innerHTML = `
      <div class="report-header">
        <div class="report-date">${formatTimestamp(r.timestamp)}</div>
        <div class="report-composite">
          <span class="composite-score" style="color:${compositeColor.color}">${pct(r.composite)}%</span>
          <span class="composite-label">composite score</span>
        </div>
      </div>

      <div class="section-head">North Star Metrics</div>
      <div class="metrics-table">${metricsHTML}</div>

      <div class="section-head">Findings</div>
      <ul class="findings-list">${findingsHTML}</ul>

      <div class="section-head">Proposals</div>
      <ul class="proposals-list">${proposalsHTML}</ul>

      <div class="section-head">Modules Executed</div>
      <div class="modules-tags">${modulesHTML}</div>
    `;

    $reportView.classList.remove('hidden');
  }
})();
