const SELECTORS = {
  "www.kimi.com": {
    input: [
      ".chat-input-editor[contenteditable='true']"
    ],
    send: [
      ".send-button-container:not(.disabled)",
      ".send-button-container"
    ],
    newChat: [
      "a.new-chat-btn[href='/']"
    ]
  },
  "chatgpt.com": {
    input: [
      "#prompt-textarea.ProseMirror[contenteditable='true']",
      "#prompt-textarea[contenteditable='true']"
    ],
    send: [
      "#composer-submit-button",
      "button[data-testid='send-button']"
    ],
    newChat: [
      "a[data-testid='create-new-chat-button']",
      "button[data-testid='create-new-chat-button']"
    ]
  },
  "gemini.google.com": {
    input: [
      ".ql-editor[contenteditable='true'][role='textbox']",
      "rich-textarea .ql-editor[contenteditable='true']"
    ],
    send: [
      ".send-button-container.visible button.send-button.submit",
      "button.send-button.submit",
      "button.send-button[aria-label*='send' i]",
      "button[aria-label*='Send']",
      "button[aria-label*='发送']",
      "button.send-button"
    ],
    newChat: [
      "a[aria-label='发起新对话']",
      "a[data-test-id='expanded-button'][aria-label*='新对话']",
      "a[data-test-id='expanded-button'][href='/app']"
    ]
  }
};

const host = window.location.host;
const cfg = SELECTORS[host];

let ignoreUserEventUntil = 0;
let lastUserCapture = {
  text: "",
  at: 0
};
let lastInjected = {
  text: "",
  messageId: "",
  at: 0
};
let lastUserNewChatClickAt = 0;

function now() {
  return Date.now();
}

function normalizeText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function findFirst(selectors) {
  if (!selectors || selectors.length === 0) {
    return null;
  }

  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el) {
      return el;
    }
  }

  return null;
}

function getInputElement() {
  if (!cfg) {
    return null;
  }
  return findFirst(cfg.input);
}

function isElementClickable(el) {
  if (!(el instanceof HTMLElement)) {
    return false;
  }
  if (el instanceof HTMLButtonElement && el.disabled) {
    return false;
  }
  if (el.getAttribute("aria-disabled") === "true") {
    return false;
  }
  if (el.classList.contains("disabled")) {
    return false;
  }
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function getSendButton() {
  if (!cfg) {
    return null;
  }
  for (const selector of cfg.send || []) {
    const list = document.querySelectorAll(selector);
    for (const raw of list) {
      const button = raw instanceof HTMLButtonElement ? raw : raw.closest("button");
      if (!button) {
        continue;
      }
      if (button.disabled) {
        continue;
      }
      if (button.getAttribute("aria-disabled") === "true") {
        continue;
      }
      if (button.classList.contains("disabled")) {
        continue;
      }
      const rect = button.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        continue;
      }
      return button;
    }
  }
  return null;
}

function toClickableElement(el) {
  if (!(el instanceof Element)) {
    return null;
  }
  const clickable = el.closest("button, a, [role='button']") || el;
  return clickable instanceof HTMLElement ? clickable : null;
}

function getNewChatButton() {
  if (!cfg) {
    return null;
  }
  for (const selector of cfg.newChat || []) {
    const list = document.querySelectorAll(selector);
    for (const raw of list) {
      const clickable = toClickableElement(raw);
      if (clickable && isElementClickable(clickable)) {
        return clickable;
      }
    }
  }
  return null;
}

function getInputText(el) {
  if (!el) {
    return "";
  }

  return (el.innerText || "").replace(/\u00a0/g, " ").trim();
}

function setContentEditableText(el, text) {
  if (!el) {
    return;
  }

  el.focus();

  const selection = window.getSelection();
  if (selection) {
    const range = document.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  document.execCommand("insertText", false, text);

  if (getInputText(el) !== text) {
    el.innerHTML = "";
    const lines = text.split("\n");
    const frag = document.createDocumentFragment();
    for (let i = 0; i < lines.length; i += 1) {
      frag.appendChild(document.createTextNode(lines[i]));
      if (i !== lines.length - 1) {
        frag.appendChild(document.createElement("br"));
      }
    }
    el.appendChild(frag);
  }

  el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true }));
}

function triggerSend() {
  const sendBtn = getSendButton();
  if (sendBtn) {
    sendBtn.click();
    return true;
  }

  const input = getInputElement();
  if (input) {
    input.dispatchEvent(new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true
    }));
    input.dispatchEvent(new KeyboardEvent("keyup", {
      key: "Enter",
      code: "Enter",
      bubbles: true,
      cancelable: true
    }));
    return true;
  }

  return false;
}

function shouldIgnoreUserEvent() {
  return now() < ignoreUserEventUntil;
}

function isRecentlyInjectedText(text) {
  const current = now();
  if (!lastInjected.text || current - lastInjected.at > 12000) {
    return false;
  }
  return normalizeText(lastInjected.text) === normalizeText(text);
}

function maybeCaptureAndBroadcast() {
  if (!cfg || shouldIgnoreUserEvent()) {
    return;
  }

  const input = getInputElement();
  const text = getInputText(input);
  if (!text) {
    return;
  }

  if (isRecentlyInjectedText(text)) {
    return;
  }

  const current = now();
  if (lastUserCapture.text === text && current - lastUserCapture.at < 1200) {
    return;
  }

  lastUserCapture = {
    text,
    at: current
  };

  chrome.runtime.sendMessage({
    type: "USER_SENT_MESSAGE",
    payload: { text }
  });
}

function maybeCaptureAndBroadcastNewChat(event) {
  if (!cfg || !cfg.newChat || shouldIgnoreUserEvent()) {
    return;
  }
  if (!(event.target instanceof Element)) {
    return;
  }

  let clickedNewChat = false;
  for (const selector of cfg.newChat) {
    const matched = event.target.closest(selector);
    if (!matched) {
      continue;
    }
    const clickable = toClickableElement(matched);
    if (clickable && isElementClickable(clickable)) {
      clickedNewChat = true;
      break;
    }
  }

  if (!clickedNewChat) {
    return;
  }

  const current = now();
  if (current - lastUserNewChatClickAt < 1000) {
    return;
  }
  lastUserNewChatClickAt = current;

  chrome.runtime.sendMessage({
    type: "USER_NEW_CHAT",
    payload: {}
  });
}

function setupUserSendListeners() {
  if (!cfg) {
    return;
  }

  document.addEventListener("keydown", (event) => {
    if (!event.isTrusted) {
      return;
    }

    if (shouldIgnoreUserEvent()) {
      return;
    }

    if (event.isComposing) {
      return;
    }

    if (event.key !== "Enter") {
      return;
    }

    if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) {
      return;
    }

    const input = getInputElement();
    if (!input) {
      return;
    }

    if (event.target !== input && !input.contains(event.target)) {
      return;
    }

    maybeCaptureAndBroadcast();
  }, true);

  document.addEventListener("click", (event) => {
    if (!event.isTrusted) {
      return;
    }

    if (shouldIgnoreUserEvent()) {
      return;
    }

    const sendBtn = getSendButton();
    if (!sendBtn) {
      return;
    }

    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    if (target === sendBtn || sendBtn.contains(target)) {
      maybeCaptureAndBroadcast();
    }
  }, true);
}

function setupUserNewChatListeners() {
  if (!cfg || !cfg.newChat || cfg.newChat.length === 0) {
    return;
  }

  document.addEventListener("click", (event) => {
    if (!event.isTrusted) {
      return;
    }
    maybeCaptureAndBroadcastNewChat(event);
  }, true);
}

async function injectAndSend(text, messageId) {
  if (!cfg) {
    return { ok: false, reason: "unsupported_host" };
  }

  const input = getInputElement();
  if (!input) {
    return { ok: false, reason: "input_not_found" };
  }

  lastInjected = {
    text,
    messageId: String(messageId || ""),
    at: now()
  };
  ignoreUserEventUntil = now() + 3500;
  setContentEditableText(input, text);

  await new Promise((resolve) => setTimeout(resolve, 80));
  const waitUntil = now() + 1500;
  while (!getSendButton() && now() < waitUntil) {
    await new Promise((resolve) => setTimeout(resolve, 60));
  }

  const sent = triggerSend();
  return { ok: sent, reason: sent ? "sent" : "send_not_found" };
}

function triggerNewChat() {
  const newChatBtn = getNewChatButton();
  if (newChatBtn) {
    newChatBtn.click();
    return { ok: true, reason: "clicked" };
  }

  if (host === "www.kimi.com") {
    if (window.location.pathname !== "/") {
      window.location.assign("/");
      return { ok: true, reason: "navigate_root" };
    }
    return { ok: false, reason: "new_chat_not_found" };
  }
  if (host === "chatgpt.com") {
    if (window.location.pathname !== "/") {
      window.location.assign("/");
      return { ok: true, reason: "navigate_root" };
    }
    return { ok: false, reason: "new_chat_not_found" };
  }
  if (host === "gemini.google.com") {
    if (window.location.pathname !== "/app") {
      window.location.assign("/app");
      return { ok: true, reason: "navigate_root" };
    }
    return { ok: false, reason: "new_chat_not_found" };
  }

  return { ok: false, reason: "unsupported_host" };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) {
    return;
  }

  if (message.type === "TRIGGER_NEW_CHAT") {
    sendResponse(triggerNewChat());
    return;
  }

  if (message.type !== "INJECT_AND_SEND") {
    return;
  }

  const text = message.payload && message.payload.text;
  const messageId = message.payload && message.payload.messageId;
  injectAndSend(String(text || ""), String(messageId || ""))
    .then((result) => sendResponse(result))
    .catch((error) => sendResponse({ ok: false, reason: String(error && error.message ? error.message : error) }));

  return true;
});

setupUserSendListeners();
setupUserNewChatListeners();
