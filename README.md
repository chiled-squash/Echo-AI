# AI Chat Sync Launcher (Chrome Extension)

## Features
- Open Kimi / ChatGPT / Gemini in new tabs with one click.
- When you send a prompt in one supported site, the prompt is broadcast to other enabled sites.
- Sync New Chat / New Conversation button events across supported sites (creating a new session in one site will trigger new session creation in others).
- All settings and runtime state are stored in `chrome.storage.local`.

## Install
1. Open Chrome and go to `chrome://extensions/`.
2. Enable `Developer mode`.
3. Click `Load unpacked` and select this folder.

## Notes
- Sites supported:
  - https://www.kimi.com/
  - https://chatgpt.com/
  - https://gemini.google.com/
- Selectors of chat inputs/buttons can change over time; if one site updates DOM structure, selector updates may be needed in `content.js`.

<img width="616" height="616" alt="image" src="https://github.com/user-attachments/assets/7146a9c9-d73c-4965-89cc-27d033ecd732" />
