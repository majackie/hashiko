// constants
const API_BASE = "/api";
const HASH_PREFIX_LENGTH = 4;
const HASH_SUFFIX_LENGTH = 4;
const ALERT_WINDOW_HOURS = 24;

// currently selected agent (set when entering detail view)
let currentAgentId = null;

const DEFAULT_WATCH_PATHS = ["/boot", "/etc", "/root", "/usr/bin", "/usr/sbin"];

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

    const configBtn = document.createElement("button");
    configBtn.id = "config-btn";
    configBtn.textContent = "⚙️ Watch Paths";
    configBtn.onclick = toggleConfigPanel;
    configBtn.style.display = "none"; // hidden until inside a machine

    const alertBtn = document.createElement("button");
    alertBtn.id = "alert-btn";
    alertBtn.textContent = `🔔 Alerts${alertCount > 0 ? ` (${alertCount})` : ""}`;
    alertBtn.onclick = toggleAlertPanel;

    const logoutBtn = document.createElement("button");
    logoutBtn.id = "logout-btn";
    logoutBtn.textContent = "Logout";
    logoutBtn.onclick = logout;

    container.appendChild(configBtn);
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
        <span>🔔 Alerts (${alerts.length})</span>
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
    const configPanel = document.getElementById("config-panel");
    if (configPanel) configPanel.classList.remove("show");
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
    // collect all path keys that appear across all records
    const pathKeys = [];
    records.forEach(r => {
        Object.keys(r.hashes || {}).forEach(k => {
            if (!pathKeys.includes(k)) pathKeys.push(k);
        });
    });
    pathKeys.sort();

    const table = document.createElement("table");
    const headerCells = pathKeys.map(k => `<th>${k}</th>`).join("");
    table.innerHTML = `
        <thead>
            <tr>
                <th>Timestamp</th>
                ${headerCells}
            </tr>
        </thead>
        <tbody></tbody>
    `;

    const tbody = table.querySelector("tbody");
    records.forEach(r => {
        const changed = r.changed || {};
        const hashes = r.hashes || {};
        const hashCells = pathKeys.map(k => {
            const hash = hashes[k] || "";
            const isChanged = changed[k] === true;
            return `<td class="${isChanged ? "changed" : ""} hash" title="${hash}">${shortHash(hash)}</td>`;
        }).join("");
        tbody.insertAdjacentHTML("beforeend", `
            <tr>
                <td>${r.timestamp}</td>
                ${hashCells}
            </tr>
        `);
    });

    return table;
}

// view management
function showAgentList() {
    currentAgentId = null;
    const configBtn = document.getElementById("config-btn");
    if (configBtn) configBtn.style.display = "none";
    const alertBtn = document.getElementById("alert-btn");
    if (alertBtn) alertBtn.style.display = "";
    // close panels if open
    const configPanel = document.getElementById("config-panel");
    if (configPanel) configPanel.classList.remove("show");
    document.getElementById("view-list").classList.remove("hidden");
    document.getElementById("view-detail").classList.add("hidden");
}

function showAgentDetail(agentId, agentGroups) {
    currentAgentId = agentId;
    const configBtn = document.getElementById("config-btn");
    if (configBtn) configBtn.style.display = "";
    const alertBtn = document.getElementById("alert-btn");
    if (alertBtn) alertBtn.style.display = "none";
    const alertPanel = document.getElementById("alert-panel");
    if (alertPanel) alertPanel.classList.remove("show");
    document.getElementById("view-list").classList.add("hidden");
    const detailView = document.getElementById("view-detail");
    detailView.classList.remove("hidden");
    document.getElementById("detail-title").textContent = `Agent: ${agentId}`;
    const container = document.getElementById("tables-container");
    container.innerHTML = "";
    container.appendChild(createHashTable(agentGroups[agentId]));
}

// agent grid rendering
function renderAgentGrid(agentGroups, alerts, container) {
    const alertsByAgent = {};
    alerts.forEach(a => {
        alertsByAgent[a.agent_id] = (alertsByAgent[a.agent_id] || 0) + 1;
    });

    Object.entries(agentGroups).forEach(([agentId, records]) => {
        const alertCount = alertsByAgent[agentId] || 0;
        const lastRecord = records[records.length - 1];
        const lastSeen = lastRecord ? new Date(lastRecord.timestamp).toLocaleString() : "Unknown";

        const card = document.createElement("div");
        card.className = `agent-card${alertCount > 0 ? " has-alerts" : ""}`;
        card.innerHTML = `
            <div class="agent-card-name">🖥️ ${agentId}</div>
            <div class="agent-card-meta">Last seen: ${lastSeen}</div>
            ${alertCount > 0 ? `<div class="agent-card-badge">${alertCount} alert${alertCount > 1 ? "s" : ""}</div>` : ""}
        `;
        card.onclick = () => showAgentDetail(agentId, agentGroups);
        container.appendChild(card);
    });
}

// config panel
function renderPathList(paths) {
    const list = document.getElementById("config-path-list");
    if (!list) return;
    list.innerHTML = "";
    // defaults first, always shown without remove button
    DEFAULT_WATCH_PATHS.forEach(p => appendPathItem(list, p, false));
    // divider between defaults and custom paths
    const divider = document.createElement("li");
    divider.className = "config-path-divider";
    divider.textContent = "Custom";
    list.appendChild(divider);
    // custom paths after divider
    paths.filter(p => !DEFAULT_WATCH_PATHS.includes(p)).forEach(p => appendPathItem(list, p, true));
}

function appendPathItem(list, path, removable) {
    const li = document.createElement("li");
    li.className = "config-path-item" + (removable ? "" : " config-path-default");
    li.innerHTML = removable
        ? `<span class="config-path-text">${path}</span><button class="remove-path-btn" onclick="removeWatchPath(this)" title="Remove">×</button>`
        : `<span class="config-path-text">${path}</span><span class="config-path-lock" title="Default path">🔒</span>`;
    list.appendChild(li);
}

function addWatchPath() {
    const input = document.getElementById("config-path-input");
    const path = input.value.trim();
    if (!path) return;
    if (DEFAULT_WATCH_PATHS.includes(path)) {
        input.value = "";
        return;
    }
    const list = document.getElementById("config-path-list");
    if (!list) return;
    const existing = Array.from(list.querySelectorAll(".config-path-text")).map(s => s.textContent);
    if (!existing.includes(path)) appendPathItem(list, path, true);
    input.value = "";
}

function removeWatchPath(btn) {
    btn.closest("li").remove();
}

async function loadAgentPaths(agentId) {
    if (!agentId) return;
    try {
        const response = await fetch(`${API_BASE}/admin/config?agent_id=${encodeURIComponent(agentId)}`, { credentials: "include" });
        if (!response.ok) {
            showConfigStatus(`Failed to load paths (${response.status}).`, true);
            return;
        }
        const data = await response.json();
        renderPathList(data.paths || []);
    } catch (e) {
        console.error("Failed to load config:", e);
        showConfigStatus("Failed to load paths. Check connection.", true);
    }
}

async function loadConfigPanel() {
    if (!currentAgentId) return;
    await loadAgentPaths(currentAgentId);
    const label = document.getElementById("config-agent-label");
    if (label) label.textContent = currentAgentId;
}

function showConfigStatus(message, isError) {
    const el = document.getElementById("config-status");
    if (!el) return;
    el.textContent = message;
    el.className = "config-status " + (isError ? "config-status-error" : "config-status-success");
    el.style.display = "block";
    if (!isError) setTimeout(() => { el.style.display = "none"; }, 3000);
}

async function saveConfig() {
    const agentId = currentAgentId;
    if (!agentId) {
        showConfigStatus("No agent selected.", true);
        return;
    }
    const list = document.getElementById("config-path-list");
        const paths = list
            ? [...DEFAULT_WATCH_PATHS, ...Array.from(list.querySelectorAll(".config-path-item:not(.config-path-default) .config-path-text")).map(s => s.textContent)]
            : DEFAULT_WATCH_PATHS;
    if (paths.length === 0) {
        showConfigStatus("Add at least one path.", true);
        return;
    }
    try {
        const response = await fetch(`${API_BASE}/config`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ agent_id: agentId, paths })
        });
        const data = await response.json();
        if (data.success) {
            showConfigStatus("Saved. Changes take effect on the next agent run.", false);
        } else {
            showConfigStatus("Error: " + data.error, true);
        }
    } catch (e) {
        showConfigStatus("Failed to save. Please try again.", true);
    }
}

function createConfigPanel() {
    let panel = document.getElementById("config-panel");
    if (panel) return panel;
    panel = document.createElement("div");
    panel.id = "config-panel";
    panel.innerHTML = `
        <div class="config-header">
            <span>⚙️ Watch Paths</span>
            <button class="close-btn" onclick="toggleConfigPanel()">×</button>
        </div>
        <div class="config-content">
            <ul id="config-path-list"></ul>
            <div class="config-add-row">
                <input type="text" id="config-path-input" placeholder="/path/to/watch"
                    onkeydown="if(event.key==='Enter'){event.preventDefault();addWatchPath();}">
                <button id="config-add-btn" onclick="addWatchPath()">Add</button>
            </div>
            <div class="config-action-row">
                <button id="config-save-btn" onclick="saveConfig()">Save</button>
            </div>
            <div id="config-status" class="config-status" style="display:none;"></div>
        </div>
    `;
    document.body.appendChild(panel);
    return panel;
}

function toggleConfigPanel() {
    const panel = document.getElementById("config-panel");
    const alertPanel = document.getElementById("alert-panel");
    if (alertPanel) alertPanel.classList.remove("show");
    if (panel) {
        panel.classList.toggle("show");
        if (panel.classList.contains("show")) loadConfigPanel();
    }
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
        const agentGroups = groupByAgent(data);

        createHeaderButtons(alerts.length);
        createAlertPanel(alerts);
        createConfigPanel();

        // back button in detail view
        const backBtn = document.createElement("button");
        backBtn.id = "back-btn";
        backBtn.textContent = "Back to Agents";
        backBtn.onclick = showAgentList;
        const detailView = document.getElementById("view-detail");
        detailView.insertBefore(backBtn, detailView.firstChild);

        renderAgentGrid(agentGroups, alerts, document.getElementById("agent-grid"));

        // close panels when clicking outside
        document.addEventListener("click", (e) => {
            // ignore clicks on elements that were just removed from the DOM
            if (!e.target.isConnected) return;
            const configPanel = document.getElementById("config-panel");
            const alertPanel = document.getElementById("alert-panel");
            const configBtn = document.getElementById("config-btn");
            const alertBtn = document.getElementById("alert-btn");
            if (configPanel && configPanel.classList.contains("show")) {
                if (!configPanel.contains(e.target) && !(configBtn && configBtn.contains(e.target))) {
                    configPanel.classList.remove("show");
                }
            }
            if (alertPanel && alertPanel.classList.contains("show")) {
                if (!alertPanel.contains(e.target) && !(alertBtn && alertBtn.contains(e.target))) {
                    alertPanel.classList.remove("show");
                }
            }
        });
    } catch (err) {
        console.error("Error loading data:", err);
    }
}

loadHashData();
