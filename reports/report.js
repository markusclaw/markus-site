// Markus Reports Dashboard - Report Loading & Rendering

// SHA-256 implementation (simplified for client-side PIN hashing)
async function hashPIN(pin) {
    const encoder = new TextEncoder();
    const data = encoder.encode(pin);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Expected PIN hash (SHA-256 of "000000")
const EXPECTED_PIN_HASH = 'c775e1d4f67f1c9dd9a48fae0db2e2e0eb0e09c38ad2eef915e1fcf4ebe1502';

// PIN Gate Logic
document.getElementById('pin-submit').addEventListener('click', authenticatePIN);
document.getElementById('pin-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') authenticatePIN();
});

async function authenticatePIN() {
    const pinInput = document.getElementById('pin-input');
    const errorDiv = document.getElementById('pin-error');
    const pin = pinInput.value;

    if (!pin) {
        errorDiv.textContent = 'Please enter a PIN';
        return;
    }

    const hash = await hashPIN(pin);
    if (hash === EXPECTED_PIN_HASH) {
        sessionStorage.setItem('markus-reports-authenticated', 'true');
        showDashboard();
        loadReports();
    } else {
        errorDiv.textContent = 'Invalid PIN';
        pinInput.value = '';
        pinInput.focus();
    }
}

// Logout
document.getElementById('logout-btn').addEventListener('click', () => {
    sessionStorage.removeItem('markus-reports-authenticated');
    location.reload();
});

// Check if authenticated
function checkAuthentication() {
    if (sessionStorage.getItem('markus-reports-authenticated') !== 'true') {
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

// Load & Render Reports
async function loadReports() {
    const container = document.getElementById('reports-container');
    const loadingDiv = document.getElementById('loading');
    const noReportsDiv = document.getElementById('no-reports');

    try {
        // Load manifest
        const manifestResponse = await fetch('./data/manifest.json');
        if (!manifestResponse.ok) throw new Error('Could not load manifest');
        const manifest = await manifestResponse.json();

        if (!manifest.reports || manifest.reports.length === 0) {
            loadingDiv.classList.add('hidden');
            noReportsDiv.classList.remove('hidden');
            return;
        }

        // Load all report files
        const reports = [];
        for (const reportFile of manifest.reports) {
            try {
                const response = await fetch(`./data/${reportFile}`);
                if (response.ok) {
                    const report = await response.json();
                    reports.push(report);
                }
            } catch (e) {
                console.error(`Failed to load ${reportFile}:`, e);
            }
        }

        // Sort by date (newest first)
        reports.sort((a, b) => new Date(b.date) - new Date(a.date));

        if (reports.length === 0) {
            loadingDiv.classList.add('hidden');
            noReportsDiv.classList.remove('hidden');
            return;
        }

        // Render reports
        container.innerHTML = '';
        reports.forEach(report => {
            container.appendChild(createReportCard(report));
        });

        // Update stats
        updateStats(reports);

        loadingDiv.classList.add('hidden');
    } catch (error) {
        console.error('Error loading reports:', error);
        loadingDiv.textContent = 'Error loading reports';
    }
}

function createReportCard(report) {
    const card = document.createElement('div');
    card.className = 'report-card';

    const header = document.createElement('div');
    header.className = 'report-card-header';
    header.innerHTML = `
        <div>
            <div class="report-date">${formatDate(report.date)}</div>
            <div class="report-timestamp">${report.timestamp || ''}</div>
        </div>
        <div class="report-toggle">▼</div>
    `;

    const content = document.createElement('div');
    content.className = 'report-card-content';
    content.innerHTML = renderReportContent(report);

    card.appendChild(header);
    card.appendChild(content);

    // Toggle expansion
    header.addEventListener('click', () => {
        card.classList.toggle('expanded');
    });

    return card;
}

function renderReportContent(report) {
    let html = '';

    // North Star Scores
    if (report.north_star) {
        html += '<div class="north-star-section">';
        html += '<div class="section-title">North Star Metrics</div>';

        const dimensions = [
            { key: 'response_quality', label: 'Response Quality', color: 'good' },
            { key: 'cost_efficiency', label: 'Cost Efficiency', color: 'good' },
            { key: 'task_completion', label: 'Task Completion', color: 'good' },
            { key: 'autonomy', label: 'Autonomy', color: 'good' },
            { key: 'speed', label: 'Speed', color: 'good' },
            { key: 'initiative', label: 'Initiative', color: 'good' }
        ];

        for (const dim of dimensions) {
            const score = report.north_star[dim.key] || 0;
            const color = scoreToColor(score);
            html += `
                <div class="score-row">
                    <div class="score-label">
                        <span class="score-label-name">${dim.label}</span>
                        <span class="score-label-value">${score}%</span>
                    </div>
                    <div class="score-bar">
                        <div class="score-fill ${color}" style="width: ${score}%"></div>
                    </div>
                </div>
            `;
        }
        html += '</div>';
    }

    // Top Findings
    if (report.top_findings && report.top_findings.length > 0) {
        html += '<div class="findings-section">';
        html += '<div class="section-title">Top Findings</div>';
        for (const finding of report.top_findings) {
            const type = finding.type || 'info';
            html += `
                <div class="finding-item ${type}">
                    <div class="finding-title">${finding.title}</div>
                    <div class="finding-description">${finding.description}</div>
                </div>
            `;
        }
        html += '</div>';
    }

    // Proposals
    if (report.proposals && report.proposals.length > 0) {
        html += '<div class="proposals-section">';
        html += '<div class="section-title">Pending Proposals</div>';
        for (const proposal of report.proposals) {
            const status = proposal.status || 'pending';
            html += `
                <div class="proposal-item">
                    <div class="proposal-header">
                        <span class="proposal-title">${proposal.title}</span>
                        <span class="proposal-status ${status}">${status}</span>
                    </div>
                    <div class="proposal-description">${proposal.description}</div>
                </div>
            `;
        }
        html += '</div>';
    }

    // Raw data (for debugging)
    if (report.metadata) {
        html += '<div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--color-border);">';
        html += '<div class="section-title">Report Details</div>';
        html += `<pre style="font-size: 11px; color: var(--color-text-secondary); overflow-x: auto; padding: 8px; background: rgba(0,0,0,0.2); border-radius: 4px;">${JSON.stringify(report.metadata, null, 2)}</pre>`;
        html += '</div>';
    }

    return html;
}

function scoreToColor(score) {
    if (score >= 90) return 'excellent';
    if (score >= 75) return 'good';
    if (score >= 60) return 'warning';
    return 'critical';
}

function formatDate(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { 
        weekday: 'short', 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric' 
    });
}

function updateStats(reports) {
    document.getElementById('total-reports').textContent = reports.length;

    // Calculate average score
    let totalScore = 0;
    let scoreCount = 0;
    for (const report of reports) {
        if (report.north_star) {
            const scores = Object.values(report.north_star).filter(v => typeof v === 'number');
            totalScore += scores.reduce((a, b) => a + b, 0);
            scoreCount += scores.length;
        }
    }
    const avgScore = scoreCount > 0 ? Math.round(totalScore / scoreCount) : 0;
    document.getElementById('avg-score').textContent = avgScore > 0 ? `${avgScore}%` : '—';
}

// Date filter
document.getElementById('date-filter').addEventListener('change', (e) => {
    const selectedDate = e.target.value;
    const cards = document.querySelectorAll('.report-card');
    cards.forEach(card => {
        if (selectedDate) {
            const cardDate = card.querySelector('.report-date').textContent;
            card.style.display = cardDate.includes(selectedDate) ? '' : 'none';
        } else {
            card.style.display = '';
        }
    });
});

// Initialize on page load
window.addEventListener('load', () => {
    checkAuthentication();
});
