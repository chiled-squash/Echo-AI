# AI Chat Sync Launcher (Chrome Extension)

## Features
- Open Kimi / ChatGPT / Gemini in new tabs with one click.
- When you send a prompt in one supported site, the prompt is broadcast to other enabled sites.
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
