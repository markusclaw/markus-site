// Markus Reports Log Viewer

// SHA-256 hash for PIN validation
async function hashPIN(pin) {
    const encoder = new TextEncoder();
    const data = encoder.encode(pin);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

const EXPECTED_PIN_HASH = '91b4d142823f7d20c5f08df69122de43f35f057a988d9619f6d3138485c9a203';

// PIN Authentication
document.getElementById('pin-submit').addEventListener('click', authenticatePIN);
document.getElementById('pin-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') authenticatePIN();
});

async function authenticatePIN() {
    const pinInput = document.getElementById('pin-input');
    const errorDiv = document.getElementById('pin-error');
    const pin = pinInput.value;

    if (!pin) {
        errorDiv.textContent = 'Enter PIN';
        return;
    }

    const hash = await hashPIN(pin);
    if (hash === EXPECTED_PIN_HASH) {
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
    }
}

function showDashboard() {
    document.getElementById('pin-gate').classList.add('hidden');
    document.getElementById('dashboard').classList.remove('hidden');
}

// Logout
document.getElementById('logout-btn').addEventListener('click', () => {
    sessionStorage.removeItem('markus-auth');
    location.reload();
});

// Load Reports
let allReports = [];

async function loadReports() {
    const listContainer = document.getElementById('reports-list');
    
    try {
        const manifestResponse = await fetch('./data/manifest.json');
        if (!manifestResponse.ok) throw new Error('Could not load manifest');
        const manifest = await manifestResponse.json();

        const reports = [];
        for (const file of manifest.reports || []) {
            try {
                const response = await fetch(`./data/${file}`);
                if (response.ok) {
                    reports.push(await response.json());
                }
            } catch (e) {
                console.error(`Failed to load ${file}`, e);
            }
        }

        // Sort newest first
        reports.sort((a, b) => new Date(b.date) - new Date(a.date));
        allReports = reports;

        // Render list
        listContainer.innerHTML = '';
        reports.forEach((report, idx) => {
            const item = document.createElement('li');
            item.className = 'report-list-item' + (idx === 0 ? ' active' : '');
            
            const avgScore = calculateAvgScore(report);
            item.innerHTML = `
                <span class="report-date-label">${formatDate(report.date)}</span>
                <span class="report-score">Score: ${avgScore}%</span>
            `;
            
            item.addEventListener('click', () => selectReport(report, item));
            listContainer.appendChild(item);
        });

        // Show first report by default
        if (reports.length > 0) {
            selectReport(reports[0], listContainer.querySelector('.report-list-item'));
        }
    } catch (error) {
        console.error('Error loading reports:', error);
        listContainer.innerHTML = '<li class="loading">Error loading reports</li>';
    }
}

function calculateAvgScore(report) {
    if (!report.north_star) return 0;
    const scores = Object.values(report.north_star).filter(v => typeof v === 'number');
    return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

function formatDate(dateStr) {
    const date = new Date(dateStr + 'T00:00:00');
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function selectReport(report, listItem) {
    // Update active state
    document.querySelectorAll('.report-list-item').forEach(el => el.classList.remove('active'));
    listItem.classList.add('active');

    // Render detail pane
    const detailPane = document.getElementById('reports-detail');
    detailPane.innerHTML = renderReportDetail(report);
}

function renderReportDetail(report) {
    const avgScore = calculateAvgScore(report);
    
    let html = `
        <div class="report-detail">
            <div class="report-header">
                <div class="report-title">${formatDate(report.date)}</div>
                <div class="report-meta">${report.timestamp || ''} | Average Score: ${avgScore}%</div>
            </div>
    `;

    // North Star Scores
    if (report.north_star) {
        html += `
            <div class="section">
                <div class="section-title">North Star Metrics</div>
                <div class="scores-grid">
        `;
        
        const metrics = [
            { key: 'response_quality', label: 'Response Quality' },
            { key: 'cost_efficiency', label: 'Cost Efficiency' },
            { key: 'task_completion', label: 'Task Completion' },
            { key: 'autonomy', label: 'Autonomy' },
            { key: 'speed', label: 'Speed' },
            { key: 'initiative', label: 'Initiative' }
        ];

        for (const m of metrics) {
            const score = report.north_star[m.key] || 0;
            html += `
                <div class="score-item">
                    <div class="score-name">${m.label}</div>
                    <div class="score-value">${score}%</div>
                </div>
            `;
        }
        
        html += `</div></div>`;
    }

    // Top Findings
    if (report.top_findings && report.top_findings.length > 0) {
        html += `<div class="section"><div class="section-title">Findings</div>`;
        for (const finding of report.top_findings) {
            const type = finding.type || 'info';
            html += `
                <div class="finding-item ${type}">
                    <div class="finding-title">${finding.title}</div>
                    <div class="finding-description">${finding.description}</div>
                </div>
            `;
        }
        html += `</div>`;
    }

    // Proposals
    if (report.proposals && report.proposals.length > 0) {
        html += `<div class="section"><div class="section-title">Proposals</div>`;
        for (const proposal of report.proposals) {
            const status = proposal.status || 'pending';
            html += `
                <div class="proposal-item">
                    <div class="proposal-header">
                        <div class="proposal-title">${proposal.title}</div>
                        <span class="proposal-status ${status}">${status}</span>
                    </div>
                    <div class="proposal-description">${proposal.description}</div>
                </div>
            `;
        }
        html += `</div>`;
    }

    // Metadata
    if (report.metadata) {
        html += `
            <div class="section">
                <div class="section-title">Metadata</div>
                <table class="metadata-table">
                    <tr><td>Duration</td><td>${report.metadata.run_duration_seconds}s</td></tr>
                    <tr><td>Modules Executed</td><td>${report.metadata.modules_executed}</td></tr>
                    <tr><td>Files Processed</td><td>${report.metadata.files_processed}</td></tr>
                    <tr><td>Git Commits</td><td>${report.metadata.git_commits}</td></tr>
                    <tr><td>Errors</td><td>${report.metadata.errors}</td></tr>
                    <tr><td>Warnings</td><td>${report.metadata.warnings}</td></tr>
                </table>
            </div>
        `;
    }

    html += `</div>`;
    return html;
}

// Init
window.addEventListener('load', () => {
    checkAuthentication();
});
