---
name: verify
description: Run and verify a LabShelf app for real — the VS Code extension host, the webview/reader UI in headless Chrome, the browser extension, or the terminal TUI — on an isolated copy of the library, and look at the result. Use after UI, import/OCR/pdf.js, extension-host or terminal changes, or when asked to run, launch or screenshot an app.
context: fork
agent: general-purpose
model: sonnet
effort: medium
background: false
---

The recipes live in `documents/apps/`. Pick the one for the change:

| Change | Recipe |
|---|---|
| import, OCR, text layer, pdf.js in the extension host | `documents/apps/vscode.md` → "Extension host run" |
| reader UI, list panel, any VS Code webview | `documents/apps/vscode.md` → "Webview harness" |
| browser pages, popup, Scholar button, capture | `documents/apps/browser.md` → "Headless run" |
| TUI layout, keys, terminal output | `documents/apps/terminal.md` → "Verification" |

Always:
1. Rebuild the app first; a stale bundle shows old behavior.
2. Work on a copy: `cp -R ~/Documents/LabShelfLibrary <scratchpad>/lib`. Point `XDG_CONFIG_HOME`/`XDG_CACHE_HOME` at the scratchpad and use a throwaway `--user-data-dir`. Never touch the real library, config, keychain or Drive.
3. Put harness scripts in the session scratchpad, not in the repo.
4. Launch browsers and VS Code outside the sandbox (they fail inside it). Use Playwright's Chrome for Testing / headless shell; `/Applications/Google Chrome.app` crashes headless on this machine.
5. Exercise the change with a real paper from the copy, not only synthetic fixtures.
6. Read the screenshots or text frames yourself before reporting.

Return: what you exercised, what you saw (pass/fail per check), the absolute paths of the 1–3 screenshots that best show the result (the main model may open them), and anything the recipe could not reach (for example Cloudflare-protected downloads). No harness logs.
