const SITE_CONFIG = {
  kimi: {
    id: "kimi",
    name: "Kimi",
    url: "https://www.kimi.com/",
    host: "www.kimi.com"
  },
  chatgpt: {
    id: "chatgpt",
    name: "ChatGPT",
    url: "https://chatgpt.com/",
    host: "chatgpt.com"
  },
  gemini: {
    id: "gemini",
    name: "Gemini",
    url: "https://gemini.google.com/",
    host: "gemini.google.com"
  }
};

const DEFAULT_SETTINGS = {
  enabledSites: {
    kimi: true,
    chatgpt: true,
    gemini: true
  },
  syncEnabled: true
};

const DEDUP_WINDOW_MS = 8000;
const recentMessageMap = new Map();
const NEW_CHAT_DEDUP_WINDOW_MS = 1000;
let lastNewChatEvent = {
  sourceTabId: null,
  at: 0
};

async function getLocal(keys) {
  return chrome.storage.local.get(keys);
}

async function setLocal(obj) {
  return chrome.storage.local.set(obj);
}

function getSiteIdFromUrl(url) {
  if (!url) {
    return null;
  }

  try {
    const host = new URL(url).host;
    const site = Object.values(SITE_CONFIG).find((item) => item.host === host);
    return site ? site.id : null;
  } catch (_) {
    return null;
  }
}

function normalizeText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function messageKey(text) {
  return normalizeText(text).toLowerCase();
}

function pruneRecentMessages(nowTs) {
  for (const [key, value] of recentMessageMap.entries()) {
    if (nowTs - value.at > DEDUP_WINDOW_MS) {
      recentMessageMap.delete(key);
    }
  }
}

function shouldSkipAsDuplicate({ text, sourceTabId }) {
  const current = Date.now();
  pruneRecentMessages(current);

  const key = messageKey(text);
  if (!key) {
    return true;
  }

  const prev = recentMessageMap.get(key);
  if (!prev) {
    recentMessageMap.set(key, { at: current, sourceTabId });
    return false;
  }

  if (current - prev.at <= DEDUP_WINDOW_MS) {
    return true;
  }

  recentMessageMap.set(key, { at: current, sourceTabId });
  return false;
}

function shouldSkipNewChat({ sourceTabId }) {
  const current = Date.now();
  if (
    lastNewChatEvent.sourceTabId === sourceTabId &&
    current - lastNewChatEvent.at <= NEW_CHAT_DEDUP_WINDOW_MS
  ) {
    return true;
  }
  lastNewChatEvent = { sourceTabId, at: current };
  return false;
}

function createMessageId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

async function ensureDefaults() {
  const data = await getLocal(["settings", "runtimeState"]);
  const settings = data.settings || {};

  const merged = {
    ...DEFAULT_SETTINGS,
    ...settings,
    enabledSites: {
      ...DEFAULT_SETTINGS.enabledSites,
      ...(settings.enabledSites || {})
    }
  };

  const runtimeState = data.runtimeState || {
    lastBroadcastAt: 0,
    lastSourceTabId: null,
    managedTabIds: []
  };

  await setLocal({ settings: merged, runtimeState });
}

async function queryOpenSiteTabs() {
  const tabs = await chrome.tabs.query({});
  const list = {
    kimi: [],
    chatgpt: [],
    gemini: []
  };

  for (const tab of tabs) {
    const siteId = getSiteIdFromUrl(tab.url);
    if (siteId && tab.id !== undefined) {
      list[siteId].push(tab.id);
    }
  }

  return list;
}

async function getStatus() {
  const [data, openTabs] = await Promise.all([
    getLocal(["settings", "runtimeState"]),
    queryOpenSiteTabs()
  ]);

  return {
    settings: data.settings,
    runtimeState: data.runtimeState,
    openTabs
  };
}

async function openSitesInTabs(siteIds) {
  const ids = siteIds.filter((id) => SITE_CONFIG[id]);
  if (ids.length === 0) {
    return { opened: [] };
  }

  const createdTabIds = [];
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    const cfg = SITE_CONFIG[id];
    const tab = await chrome.tabs.create({
      url: cfg.url,
      active: i === 0
    });

    if (typeof tab.id === "number") {
      createdTabIds.push(tab.id);
    }
  }

  const data = await getLocal(["runtimeState"]);
  const prev = data.runtimeState || {};
  await setLocal({
    runtimeState: {
      ...prev,
      managedTabIds: createdTabIds,
      lastOpenedAt: Date.now()
    }
  });

  return { opened: ids };
}

async function broadcastPrompt({ text, sourceTabId, sourceSiteId, messageId }) {
  const data = await getLocal(["settings", "runtimeState"]);
  const settings = data.settings || DEFAULT_SETTINGS;

  if (!settings.syncEnabled || !text || !text.trim()) {
    return { delivered: 0 };
  }

  const tabs = await chrome.tabs.query({});
  let delivered = 0;

  for (const tab of tabs) {
    if (tab.id === undefined || tab.id === sourceTabId) {
      continue;
    }

    const siteId = getSiteIdFromUrl(tab.url);
    if (!siteId) {
      continue;
    }

    const siteEnabled = settings.enabledSites && settings.enabledSites[siteId];
    if (!siteEnabled) {
      continue;
    }

    // Optional: do not echo back to same site if multiple tabs of same provider are open.
    // Remove this condition if you want same-provider tabs to also receive the prompt.
    if (siteId === sourceSiteId) {
      continue;
    }

    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: "INJECT_AND_SEND",
        payload: {
          text,
          messageId
        }
      });
      delivered += 1;
    } catch (_) {
      // Ignore tabs where content script is not ready.
    }
  }

  await setLocal({
    runtimeState: {
      ...(data.runtimeState || {}),
      lastBroadcastAt: Date.now(),
      lastMessageId: messageId,
      lastSourceTabId: sourceTabId,
      lastSourceSiteId: sourceSiteId,
      lastTextPreview: text.slice(0, 120)
    }
  });

  return { delivered };
}

async function broadcastNewChat({ sourceTabId, sourceSiteId }) {
  const data = await getLocal(["settings", "runtimeState"]);
  const settings = data.settings || DEFAULT_SETTINGS;

  if (!settings.syncEnabled) {
    return { delivered: 0 };
  }

  const tabs = await chrome.tabs.query({});
  let delivered = 0;

  for (const tab of tabs) {
    if (tab.id === undefined || tab.id === sourceTabId) {
      continue;
    }

    const siteId = getSiteIdFromUrl(tab.url);
    if (!siteId) {
      continue;
    }

    const siteEnabled = settings.enabledSites && settings.enabledSites[siteId];
    if (!siteEnabled) {
      continue;
    }

    if (siteId === sourceSiteId) {
      continue;
    }

    try {
      await chrome.tabs.sendMessage(tab.id, {
        type: "TRIGGER_NEW_CHAT",
        payload: {}
      });
      delivered += 1;
    } catch (_) {
      // Ignore tabs where content script is not ready.
    }
  }

  await setLocal({
    runtimeState: {
      ...(data.runtimeState || {}),
      lastNewChatBroadcastAt: Date.now(),
      lastNewChatSourceTabId: sourceTabId,
      lastNewChatSourceSiteId: sourceSiteId
    }
  });

  return { delivered };
}

chrome.runtime.onInstalled.addListener(() => {
  ensureDefaults();
});

chrome.runtime.onStartup.addListener(() => {
  ensureDefaults();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    await ensureDefaults();

    if (!message || !message.type) {
      sendResponse({ ok: false, error: "invalid_message" });
      return;
    }

    if (message.type === "GET_STATUS") {
      const status = await getStatus();
      sendResponse({ ok: true, ...status });
      return;
    }

    if (message.type === "SET_SETTINGS") {
      const input = message.payload || {};
      const data = await getLocal(["settings"]);
      const merged = {
        ...DEFAULT_SETTINGS,
        ...(data.settings || {}),
        ...input,
        enabledSites: {
          ...DEFAULT_SETTINGS.enabledSites,
          ...((data.settings || {}).enabledSites || {}),
          ...(input.enabledSites || {})
        }
      };
      await setLocal({ settings: merged });
      sendResponse({ ok: true, settings: merged });
      return;
    }

    if (message.type === "OPEN_SITES") {
      const siteIds = (message.payload && message.payload.siteIds) || [];
      const result = await openSitesInTabs(siteIds);
      sendResponse({ ok: true, ...result });
      return;
    }

    if (message.type === "USER_SENT_MESSAGE") {
      const text = message.payload && message.payload.text;
      const sourceTabId = sender.tab && sender.tab.id;
      const sourceSiteId = getSiteIdFromUrl(sender.tab && sender.tab.url);

      if (typeof sourceTabId !== "number" || !sourceSiteId) {
        sendResponse({ ok: false, error: "invalid_source" });
        return;
      }

      if (shouldSkipAsDuplicate({ text, sourceTabId })) {
        sendResponse({ ok: true, delivered: 0, skipped: "duplicate" });
        return;
      }

      const messageId = createMessageId();
      const result = await broadcastPrompt({ text, sourceTabId, sourceSiteId, messageId });
      sendResponse({ ok: true, ...result });
      return;
    }

    if (message.type === "USER_NEW_CHAT") {
      const sourceTabId = sender.tab && sender.tab.id;
      const sourceSiteId = getSiteIdFromUrl(sender.tab && sender.tab.url);

      if (typeof sourceTabId !== "number" || !sourceSiteId) {
        sendResponse({ ok: false, error: "invalid_source" });
        return;
      }

      if (shouldSkipNewChat({ sourceTabId })) {
        sendResponse({ ok: true, delivered: 0, skipped: "duplicate" });
        return;
      }

      const result = await broadcastNewChat({ sourceTabId, sourceSiteId });
      sendResponse({ ok: true, ...result });
      return;
    }

    sendResponse({ ok: false, error: "unknown_type" });
  })().catch((error) => {
    sendResponse({ ok: false, error: String(error && error.message ? error.message : error) });
  });

  return true;
});
