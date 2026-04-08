// constants
const API_BASE = "/api";
const HASH_PREFIX_LENGTH = 4;
const HASH_SUFFIX_LENGTH = 4;
const ALERT_WINDOW_HOURS = 24;

// currently selected agent (set when entering detail view)
let currentAgentId = null;

// module-level data (set after initial load, used for re-renders)
let allData = [];
let allAgentGroups = {};

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

// --- acknowledged alerts (localStorage) ---

function getAcknowledgedAlerts() {
    try {
        return new Set(JSON.parse(localStorage.getItem("acknowledged_alerts") || "[]"));
    } catch {
        return new Set();
    }
}

function acknowledgeAlert(id) {
    const set = getAcknowledgedAlerts();
    set.add(String(id));
    localStorage.setItem("acknowledged_alerts", JSON.stringify([...set]));
}

// --- alert processing ---

function hasChanges(changed) {
    return Object.values(changed || {}).some(val => val === true);
}

function isRecent(timestamp, hoursAgo) {
    const recordTime = new Date(timestamp);
    const cutoffTime = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
    return recordTime >= cutoffTime;
}

function extractAlerts(data) {
    const acknowledged = getAcknowledgedAlerts();
    return data
        .filter(r => hasChanges(r.changed) && isRecent(r.timestamp, ALERT_WINDOW_HOURS) && !acknowledged.has(String(r.id)))
        .map(r => ({
            id: r.id,
            agent_id: r.agent_id,
            timestamp: r.timestamp,
            changed: r.changed
        }));
}

function getChangedDirectories(changed) {
    const paths = Object.entries(changed)
        .filter(([_, isChanged]) => isChanged)
        .map(([dir]) => dir)
        .sort();
    if (paths.length <= 3) return paths.join(", ");
    return `${paths.slice(0, 3).join(", ")} ... and ${paths.length - 3} more`;
}

// --- agent last-seen status ---

function getAgentStatus(lastTimestamp) {
    const hoursSince = (Date.now() - new Date(lastTimestamp)) / 3_600_000;
    if (hoursSince < 24) return "active";
    if (hoursSince < 72) return "stale";
    return "inactive";
}

// --- ui components ---

function updateHeaderAlertCount(count) {
    const alertBtn = document.getElementById("alert-btn");
    if (alertBtn) alertBtn.textContent = `Alerts${count > 0 ? ` (${count})` : ""}`;
}

function createHeaderButtons(alertCount) {
    const container = document.createElement("div");
    container.className = "header-buttons";

    const configBtn = document.createElement("button");
    configBtn.id = "config-btn";
    configBtn.textContent = "Watch Paths";
    configBtn.onclick = toggleConfigPanel;
    configBtn.style.display = "none";

    const alertBtn = document.createElement("button");
    alertBtn.id = "alert-btn";
    alertBtn.textContent = `Alerts${alertCount > 0 ? ` (${alertCount})` : ""}`;
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
    item.dataset.alertId = String(alert.id);
    item.innerHTML = `
        <div class="alert-item-body">
            <div class="alert-title">Hash Change Detected</div>
            <div class="alert-detail"><strong>Agent:</strong> ${alert.agent_id}</div>
            <div class="alert-detail"><strong>Time:</strong> ${new Date(alert.timestamp).toLocaleString()}</div>
            <div class="alert-detail"><strong>Changed:</strong> ${getChangedDirectories(alert.changed)}</div>
        </div>
        <button class="alert-dismiss-btn" title="Dismiss">Dismiss</button>
    `;
    item.querySelector(".alert-dismiss-btn").onclick = () => dismissAlert(alert.id);
    return item;
}

function createAlertPanel(alerts) {
    let panel = document.getElementById("alert-panel");
    if (!panel) {
        panel = document.createElement("div");
        panel.id = "alert-panel";
        document.body.appendChild(panel);
    }
    renderAlertPanel(alerts);
    return panel;
}

function renderAlertPanel(alerts) {
    const panel = document.getElementById("alert-panel");
    if (!panel) return;

    const header = document.createElement("div");
    header.className = "alert-header";
    header.innerHTML = `
        <span>Alerts (${alerts.length})</span>
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
}

function dismissAlert(id) {
    acknowledgeAlert(id);
    const alerts = extractAlerts(allData);
    renderAlertPanel(alerts);
    updateHeaderAlertCount(alerts.length);
    // update agent card badges
    const grid = document.getElementById("agent-grid");
    if (grid) {
        grid.innerHTML = "";
        renderAgentGrid(allAgentGroups, alerts, grid);
    }
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

// --- baseline reset ---

function showBaselineConfirm(btn, agentId, recordId) {
    const original = btn.outerHTML;
    btn.replaceWith(createBaselineConfirmEl(agentId, recordId, original));
}

function createBaselineConfirmEl(agentId, recordId, originalBtnHtml) {
    const wrap = document.createElement("span");
    wrap.className = "timeline-baseline-confirm";
    wrap.innerHTML = `
        <span class="timeline-baseline-confirm-label">Reset baseline?</span>
        <button class="timeline-baseline-yes">Yes</button>
        <button class="timeline-baseline-no">No</button>
    `;
    wrap.querySelector(".timeline-baseline-yes").onclick = () => doResetBaseline(wrap, agentId, recordId);
    wrap.querySelector(".timeline-baseline-no").onclick = () => {
        const temp = document.createElement("span");
        temp.innerHTML = originalBtnHtml;
        const newBtn = temp.firstChild;
        newBtn.onclick = () => showBaselineConfirm(newBtn, agentId, recordId);
        wrap.replaceWith(newBtn);
    };
    return wrap;
}

async function doResetBaseline(confirmEl, agentId, recordId) {
    const statusEl = document.createElement("span");
    statusEl.className = "timeline-baseline-status";
    statusEl.textContent = "Resetting…";
    confirmEl.replaceWith(statusEl);
    try {
        const response = await fetch(`${API_BASE}/baseline`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ agent_id: agentId, record_id: recordId })
        });
        const data = await response.json();
        if (data.success) {
            statusEl.textContent = "Baseline reset.";
            const hashResponse = await fetch(`${API_BASE}/hashes`, { credentials: "include" });
            allData = await hashResponse.json();
            allAgentGroups = groupByAgent(allData);
            const container = document.getElementById("tables-container");
            if (container) {
                container.innerHTML = "";
                container.appendChild(createHashTable(allAgentGroups[agentId]));
            }
        } else {
            statusEl.textContent = "Error: " + data.error;
            statusEl.classList.add("timeline-baseline-error");
        }
    } catch (e) {
        console.error("Baseline reset failed:", e);
        statusEl.textContent = "Failed. Check connection.";
        statusEl.classList.add("timeline-baseline-error");
    }
}

// --- timeline ---

function createHashTable(records) {
    const container = document.createElement("div");
    container.className = "hash-timeline";

    records.forEach((r, idx) => {
        const changed = r.changed || {};
        const hashes = r.hashes || {};
        const changedPaths = Object.entries(changed)
            .filter(([_, v]) => v)
            .map(([k]) => k)
            .sort();
        const totalFiles = Object.keys(hashes).length;
        const isBaseline = idx === records.length - 1;

        const row = document.createElement("div");
        row.className = `timeline-row${changedPaths.length > 0 ? " timeline-row-changed" : ""}`;

        let statusHtml;
        if (changedPaths.length > 0) {
            statusHtml = `<span class="timeline-changed">${changedPaths.length} changed</span>`;
        } else if (isBaseline) {
            statusHtml = `<span class="timeline-ok">baseline</span>`;
        } else {
            statusHtml = `<span class="timeline-ok">clean</span>`;
        }

        const summary = document.createElement("div");
        summary.className = "timeline-summary";
        summary.innerHTML = `
            <span class="timeline-timestamp">${new Date(r.timestamp).toLocaleString()}</span>
            <span class="timeline-files">${totalFiles} file${totalFiles !== 1 ? "s" : ""}</span>
            ${statusHtml}
            ${changedPaths.length > 0 ? `<button class="timeline-expand-btn">Details</button>` : ""}
        `;

        row.appendChild(summary);

        if (changedPaths.length > 0) {
            const details = document.createElement("div");
            details.className = "timeline-details hidden";
            const prevHashes = idx + 1 < records.length ? (records[idx + 1].hashes || {}) : {};
            changedPaths.forEach(path => {
                const fileRow = document.createElement("div");
                fileRow.className = "timeline-file";
                const inCurrent = path in hashes;
                const inPrev = path in prevHashes;
                const label = !inCurrent ? "[DELETED]" : !inPrev ? "[ADDED]" : "[MODIFIED]";
                fileRow.innerHTML = `
                    <span class="timeline-file-icon">${label}</span>
                    <span class="timeline-file-path">${path}</span>
                `;
                details.appendChild(fileRow);
            });

            // set baseline button inside the details panel
            if (!isBaseline) {
                const baselineBtn = document.createElement("button");
                baselineBtn.className = "timeline-baseline-btn";
                baselineBtn.textContent = "Set baseline";
                baselineBtn.onclick = () => showBaselineConfirm(baselineBtn, r.agent_id, r.id);
                details.appendChild(baselineBtn);
            }

            const expandBtn = summary.querySelector(".timeline-expand-btn");
            expandBtn.onclick = () => {
                details.classList.toggle("hidden");
                expandBtn.textContent = details.classList.contains("hidden") ? "Details" : "Hide";
            };

            row.appendChild(details);
        }

        container.appendChild(row);
    });

    return container;
}

// view management
function showAgentList() {
    currentAgentId = null;
    const configBtn = document.getElementById("config-btn");
    if (configBtn) configBtn.style.display = "none";
    const alertBtn = document.getElementById("alert-btn");
    if (alertBtn) alertBtn.style.display = "";
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
    history.pushState({ view: "detail", agentId }, "");
}

// --- agent delete ---

function showAgentDeleteConfirm(btn, agentId, card) {
    const row = btn.closest(".agent-card-delete-row");
    row.innerHTML = "";

    const label = document.createElement("span");
    label.className = "agent-delete-confirm-label";
    label.textContent = `Delete agent?`;

    const yesBtn = document.createElement("button");
    yesBtn.className = "agent-delete-yes";
    yesBtn.textContent = "Yes";
    yesBtn.onclick = (e) => { e.stopPropagation(); doDeleteAgent(row, agentId, card); };

    const noBtn = document.createElement("button");
    noBtn.className = "agent-delete-no";
    noBtn.textContent = "No";
    noBtn.onclick = (e) => {
        e.stopPropagation();
        row.innerHTML = "";
        const newBtn = document.createElement("button");
        newBtn.className = "agent-delete-btn";
        newBtn.textContent = "Delete";
        newBtn.onclick = (ev) => { ev.stopPropagation(); showAgentDeleteConfirm(newBtn, agentId, card); };
        row.appendChild(newBtn);
    };

    row.appendChild(label);
    row.appendChild(yesBtn);
    row.appendChild(noBtn);
}

async function doDeleteAgent(row, agentId, card) {
    row.innerHTML = `<span class="agent-delete-status">Deleting…</span>`;
    try {
        const response = await fetch(`${API_BASE}/agents/${encodeURIComponent(agentId)}`, {
            method: "DELETE",
            credentials: "include"
        });
        const data = await response.json();
        if (data.success) {
            card.remove();
            allData = allData.filter(r => r.agent_id !== agentId);
            delete allAgentGroups[agentId];
        } else {
            row.innerHTML = `<span class="agent-delete-status agent-delete-error">Error: ${data.error}</span>`;
        }
    } catch (e) {
        console.error("Delete agent failed:", e);
        row.innerHTML = `<span class="agent-delete-status agent-delete-error">Failed. Check connection.</span>`;
    }
}

// agent grid rendering
function renderAgentGrid(agentGroups, alerts, container) {
    const alertsByAgent = {};
    alerts.forEach(a => {
        alertsByAgent[a.agent_id] = (alertsByAgent[a.agent_id] || 0) + 1;
    });

    Object.entries(agentGroups).forEach(([agentId, records]) => {
        const alertCount = alertsByAgent[agentId] || 0;
        const lastRecord = records.reduce((a, b) =>
            new Date(a.timestamp) >= new Date(b.timestamp) ? a : b);
        const lastSeen = lastRecord ? new Date(lastRecord.timestamp).toLocaleString() : "Unknown";
        const status = lastRecord ? getAgentStatus(lastRecord.timestamp) : "inactive";

        const card = document.createElement("div");
        card.className = `agent-card${alertCount > 0 ? " has-alerts" : ""}`;
        card.innerHTML = `
            <div class="agent-card-name">${agentId}</div>
            <div class="agent-card-meta">
                <span class="agent-status-dot agent-status-${status}" title="${status}"></span>
                Last seen: ${lastSeen}
            </div>
            ${alertCount > 0 ? `<div class="agent-card-badge">${alertCount} alert${alertCount > 1 ? "s" : ""}</div>` : ""}
            <div class="agent-card-delete-row"></div>
        `;
        card.onclick = () => showAgentDetail(agentId, agentGroups);

        const deleteRow = card.querySelector(".agent-card-delete-row");
        const deleteBtn = document.createElement("button");
        deleteBtn.className = "agent-delete-btn";
        deleteBtn.textContent = "Delete";
        deleteBtn.onclick = (e) => {
            e.stopPropagation();
            showAgentDeleteConfirm(deleteBtn, agentId, card);
        };
        deleteRow.appendChild(deleteBtn);

        container.appendChild(card);
    });
}

// config panel
function renderPathList(paths) {
    const list = document.getElementById("config-path-list");
    if (!list) return;
    list.innerHTML = "";
    DEFAULT_WATCH_PATHS.forEach(p => appendPathItem(list, p, false));
    const divider = document.createElement("li");
    divider.className = "config-path-divider";
    divider.textContent = "Custom";
    list.appendChild(divider);
    paths.filter(p => !DEFAULT_WATCH_PATHS.includes(p)).forEach(p => appendPathItem(list, p, true));
}

function appendPathItem(list, path, removable) {
    const li = document.createElement("li");
    li.className = "config-path-item" + (removable ? "" : " config-path-default");
    li.innerHTML = removable
        ? `<span class="config-path-text">${path}</span><button class="remove-path-btn" onclick="removeWatchPath(this)" title="Remove">×</button>`
        : `<span class="config-path-text">${path}</span><span class="config-path-lock" title="Default path">locked</span>`;
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
        const sizeInput = document.getElementById("config-max-size-input");
        if (sizeInput) sizeInput.value = data.max_file_size_mb || 100;
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
    const sizeInput = document.getElementById("config-max-size-input");
    const max_file_size_mb = sizeInput ? Math.max(0, parseInt(sizeInput.value, 10) || 0) : 0;
    try {
        const response = await fetch(`${API_BASE}/config`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "include",
            body: JSON.stringify({ agent_id: agentId, paths, max_file_size_mb })
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
            <span>Watch Paths</span>
            <button class="close-btn" onclick="toggleConfigPanel()">×</button>
        </div>
        <div class="config-content">
            <ul id="config-path-list"></ul>
            <div class="config-add-row">
                <input type="text" id="config-path-input" placeholder="/path/to/watch"
                    onkeydown="if(event.key==='Enter'){event.preventDefault();addWatchPath();}">
                <button id="config-add-btn" onclick="addWatchPath()">Add</button>
            </div>
            <div class="config-size-row">
                <label for="config-max-size-input">Skip files larger than</label>
                <input type="number" id="config-max-size-input" min="1" value="100">
                <span class="config-size-unit">MB</span>
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

        allData = await response.json();
        allAgentGroups = groupByAgent(allData);
        const alerts = extractAlerts(allData);

        createHeaderButtons(alerts.length);
        createAlertPanel(alerts);
        createConfigPanel();

        const backBtn = document.createElement("button");
        backBtn.id = "back-btn";
        backBtn.textContent = "Back to Agents";
        backBtn.onclick = showAgentList;
        const detailView = document.getElementById("view-detail");
        detailView.insertBefore(backBtn, detailView.firstChild);

        renderAgentGrid(allAgentGroups, alerts, document.getElementById("agent-grid"));

        window.addEventListener("popstate", (e) => {
            if (e.state?.view === "detail") {
                showAgentDetail(e.state.agentId, allAgentGroups);
            } else {
                showAgentList();
            }
        });

        document.addEventListener("click", (e) => {
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

// replace the login history entry so browser back doesn't return to login
history.replaceState({ view: "list" }, "");

loadHashData();
