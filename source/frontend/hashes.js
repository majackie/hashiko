// constants
const API_BASE = "http://127.0.0.1:8899/api";
const HASH_PREFIX_LENGTH = 4;
const HASH_SUFFIX_LENGTH = 4;
const ALERT_WINDOW_HOURS = 24;

// authentication
async function checkAuth() {
    try {
        const response = await fetch(`${API_BASE}/auth/status`, { credentials: "include" });
        const data = await response.json();
        if (!data.logged_in) {
            window.location.href = "login.html";
            return false;
        }
        return true;
    } catch (error) {
        console.error("Auth check failed:", error);
        window.location.href = "login.html";
        return false;
    }
}

// logout
async function logout() {
    await fetch(`${API_BASE}/logout`, { method: "POST", credentials: "include" });
    window.location.href = "login.html";
}

// alert processing
function hasChanges(changed) {
    return Object.values(changed || {}).some(val => val === true);
}

function isRecent(timestamp, hoursAgo) {
    const recordTime = new Date(timestamp);
    const cutoffTime = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
    return recordTime >= cutoffTime;
}

function extractAlerts(data) {
    return data
        .filter(record => hasChanges(record.changed) && isRecent(record.timestamp, ALERT_WINDOW_HOURS))
        .map(record => ({
            agent_id: record.agent_id,
            timestamp: record.timestamp,
            event_type: record.event_type,
            changed: record.changed
        }));
}

function getChangedDirectories(changed) {
    return Object.entries(changed)
        .filter(([_, isChanged]) => isChanged)
        .map(([dir]) => dir)
        .join(", ");
}

// ui components
function createHeaderButtons(alertCount) {
    const container = document.createElement("div");
    container.className = "header-buttons";

    const alertBtn = document.createElement("button");
    alertBtn.id = "alert-btn";
    alertBtn.textContent = `🔔 Alerts${alertCount > 0 ? ` (${alertCount})` : ""}`;
    alertBtn.onclick = toggleAlertPanel;

    const logoutBtn = document.createElement("button");
    logoutBtn.id = "logout-btn";
    logoutBtn.textContent = "Logout";
    logoutBtn.onclick = logout;

    container.appendChild(alertBtn);
    container.appendChild(logoutBtn);
    document.body.appendChild(container);
}

function createAlertItem(alert) {
    const item = document.createElement("div");
    item.className = "alert-item";
    item.innerHTML = `
        <div class="alert-title">⚠️ Hash Change Detected</div>
        <div class="alert-detail"><strong>Agent:</strong> ${alert.agent_id}</div>
        <div class="alert-detail"><strong>Time:</strong> ${new Date(alert.timestamp).toLocaleString()}</div>
        <div class="alert-detail"><strong>Changed:</strong> ${getChangedDirectories(alert.changed)}</div>
        <div class="alert-event">Event: ${alert.event_type}</div>
    `;
    return item;
}

function createAlertPanel(alerts) {
    let panel = document.getElementById("alert-panel");
    if (!panel) {
        panel = document.createElement("div");
        panel.id = "alert-panel";
        document.body.appendChild(panel);
    }

    const header = document.createElement("div");
    header.className = "alert-header";
    header.innerHTML = `
        <span>🔔 Recent Alerts (${alerts.length})</span>
        <button class="close-btn" onclick="toggleAlertPanel()">×</button>
    `;

    const content = document.createElement("div");
    content.className = "alert-content";

    if (alerts.length === 0) {
        content.innerHTML = "<div class='no-alerts'>No recent hash changes detected</div>";
    } else {
        alerts.forEach(alert => content.appendChild(createAlertItem(alert)));
    }

    panel.innerHTML = "";
    panel.appendChild(header);
    panel.appendChild(content);
    
    return panel;
}

function toggleAlertPanel() {
    const panel = document.getElementById("alert-panel");
    if (panel) panel.classList.toggle("show");
}

// hash display
function shortHash(hash) {
    if (!hash || hash.length <= 10) return hash || "";
    return `${hash.slice(0, HASH_PREFIX_LENGTH)}....${hash.slice(-HASH_SUFFIX_LENGTH)}`;
}

function groupByAgent(data) {
    return data.reduce((groups, record) => {
        if (!groups[record.agent_id]) groups[record.agent_id] = [];
        groups[record.agent_id].push(record);
        return groups;
    }, {});
}

function createHashTable(records) {
    const table = document.createElement("table");
    table.innerHTML = `
        <thead>
            <tr>
                <th>Timestamp</th>
                <th>Event Type</th>
                <th>/boot</th>
                <th>/usr/bin</th>
                <th>/usr/sbin</th>
                <th>/etc</th>
                <th>/root</th>
            </tr>
        </thead>
        <tbody></tbody>
    `;

    const tbody = table.querySelector("tbody");
    records.forEach(r => {
        const changed = r.changed || {};
        tbody.insertAdjacentHTML("beforeend", `
            <tr>
                <td>${r.timestamp}</td>
                <td>${r.event_type}</td>
                <td class="${changed.boot ? "changed" : ""} hash" title="${r.boot}">${shortHash(r.boot)}</td>
                <td class="${changed.bin ? "changed" : ""} hash" title="${r.bin}">${shortHash(r.bin)}</td>
                <td class="${changed.sbin ? "changed" : ""} hash" title="${r.sbin}">${shortHash(r.sbin)}</td>
                <td class="${changed.etc ? "changed" : ""} hash" title="${r.etc}">${shortHash(r.etc)}</td>
                <td class="${changed.root ? "changed" : ""} hash" title="${r.root}">${shortHash(r.root)}</td>
            </tr>
        `);
    });

    return table;
}

function renderAgentSection(agentId, records, container) {
    const section = document.createElement("div");
    section.className = "agent-section";

    const header = document.createElement("h2");
    header.textContent = `Agent: ${agentId}`;
    
    section.appendChild(header);
    section.appendChild(createHashTable(records));
    container.appendChild(section);
}

// main data loading
async function loadHashData() {
    if (!await checkAuth()) return;

    try {
        const response = await fetch(`${API_BASE}/hashes`, { credentials: "include" });
        if (response.status === 401) {
            window.location.href = "login.html";
            return;
        }

        const data = await response.json();
        const alerts = extractAlerts(data);

        createHeaderButtons(alerts.length);
        createAlertPanel(alerts);

        const container = document.getElementById("tables-container");
        const agentGroups = groupByAgent(data);
        Object.entries(agentGroups).forEach(([agentId, records]) => 
            renderAgentSection(agentId, records, container)
        );
    } catch (err) {
        console.error("Error loading data:", err);
    }
}

loadHashData();
