const SITE_CONFIG = [
  { id: "kimi", name: "Kimi", url: "https://www.kimi.com/" },
  { id: "chatgpt", name: "ChatGPT", url: "https://chatgpt.com/" },
  { id: "gemini", name: "Gemini", url: "https://gemini.google.com/" }
];

const state = {
  settings: {
    syncEnabled: true,
    enabledSites: {
      kimi: true,
      chatgpt: true,
      gemini: true
    }
  },
  openTabs: {
    kimi: [],
    chatgpt: [],
    gemini: []
  },
  runtimeState: {
    lastBroadcastAt: 0,
    lastSourceSiteId: null
  }
};

const siteListEl = document.getElementById("site-list");
const syncEnabledEl = document.getElementById("sync-enabled");
const openButtonEl = document.getElementById("open-sites");
const refreshButtonEl = document.getElementById("refresh");
const statusTextEl = document.getElementById("status-text");
const lastBroadcastEl = document.getElementById("last-broadcast");

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

function getCheckedSites() {
  return SITE_CONFIG
    .filter((site) => {
      const checkbox = document.getElementById(`site-toggle-${site.id}`);
      return checkbox && checkbox.checked;
    })
    .map((site) => site.id);
}

function formatTime(ms) {
  if (!ms) {
    return "never";
  }

  const d = new Date(ms);
  return d.toLocaleTimeString();
}

function renderSites() {
  siteListEl.innerHTML = "";

  for (const site of SITE_CONFIG) {
    const row = document.createElement("label");
    row.className = "site-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = `site-toggle-${site.id}`;
    checkbox.checked = Boolean(state.settings.enabledSites[site.id]);
    checkbox.addEventListener("change", onSiteToggleChanged);

    const name = document.createElement("span");
    name.className = "site-name";
    name.textContent = site.name;

    const count = document.createElement("span");
    count.className = "site-count";
    const n = (state.openTabs[site.id] || []).length;
    count.textContent = `${n} open`;

    row.appendChild(checkbox);
    row.appendChild(name);
    row.appendChild(count);

    siteListEl.appendChild(row);
  }
}

function renderStatus() {
  const enabledSites = SITE_CONFIG.filter((s) => state.settings.enabledSites[s.id]).map((s) => s.name);
  statusTextEl.textContent = `Sync: ${state.settings.syncEnabled ? "ON" : "OFF"} | Sites: ${enabledSites.join(", ") || "none"}`;

  const source = state.runtimeState.lastSourceSiteId || "-";
  lastBroadcastEl.textContent = `Last broadcast: ${formatTime(state.runtimeState.lastBroadcastAt)} | source: ${source}`;
}

async function saveSettings() {
  await sendMessage({
    type: "SET_SETTINGS",
    payload: {
      syncEnabled: state.settings.syncEnabled,
      enabledSites: state.settings.enabledSites
    }
  });
}

async function onSiteToggleChanged(event) {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) {
    return;
  }

  const siteId = input.id.replace("site-toggle-", "");
  if (!siteId) {
    return;
  }

  state.settings.enabledSites[siteId] = input.checked;
  await saveSettings();
  renderStatus();
}

syncEnabledEl.addEventListener("change", async (event) => {
  const input = event.target;
  if (!(input instanceof HTMLInputElement)) {
    return;
  }

  state.settings.syncEnabled = input.checked;
  await saveSettings();
  renderStatus();
});

openButtonEl.addEventListener("click", async () => {
  const siteIds = getCheckedSites();
  await sendMessage({
    type: "OPEN_SITES",
    payload: { siteIds }
  });
  await refresh();
});

refreshButtonEl.addEventListener("click", async () => {
  await refresh();
});

async function refresh() {
  const result = await sendMessage({ type: "GET_STATUS" });
  if (!result || !result.ok) {
    statusTextEl.textContent = "Failed to read extension state.";
    return;
  }

  state.settings = result.settings || state.settings;
  state.openTabs = result.openTabs || state.openTabs;
  state.runtimeState = result.runtimeState || state.runtimeState;

  syncEnabledEl.checked = Boolean(state.settings.syncEnabled);
  renderSites();
  renderStatus();
}

refresh();