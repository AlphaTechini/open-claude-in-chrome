# Fork notes: audit-and-hardening

Running log for the `audit-and-hardening` branch of `AlphaTechini/open-claude-in-chrome`.
Goal: a safe, reliable replacement for the official Claude in Chrome extension for
recording demo videos (no in-page cursor overlay), usable next to a wallet extension, with
wallet approvals always left to a human.

## Resume here

If this file is being read after a Claude Code restart ("continue testing from FORK-NOTES.md"):
1. Steps 1-5 are done.
2. Step 6 is done once the user has restarted Chrome and Claude Code. See "Step 6 progress".
3. Step 7 (live testing) is next. The plan is in the "Step 7 plan" section. Results go in
   [TEST-RESULTS.md](TEST-RESULTS.md).
4. The MCP tools for this fork are named `mcp__open-claude-in-chrome__*`. They are different
   from the official extension's `mcp__claude-in-chrome__*` tools. Use only the fork's tools
   for step 7.

## Setup facts

- Clone: `C:\Users\rehob\project\open-claude-in-chrome`. Remotes: `origin` = fork,
  `upstream` = noemica-io.
- Upstream HEAD is still `6a37c29` (2026-09-22). Nothing new since the first-pass review.
- OS: Windows 11 Pro 10.0.22000. Install path is Windows via Git Bash (`install.sh`
  `MINGW*` branch, which registers under HKCU).
- Tooling: Node 24.12.0, pnpm 11.25.0, Git Bash 5.2.37, Python 3.14.2, gh 2.96.0.
- MCP server to register: `host/mcp-server.js` only. Do not register the codemode/hybrid
  servers.
- `file_upload` only accepts files in `C:\Users\rehob\Downloads\ocic-uploads`. That folder
  does not exist yet. Create it only if a test needs `file_upload`.

## Step status

| Step | Status |
|---|---|
| 1. Fork and set up | Done |
| 2. Code audit | Done: [AUDIT.md](AUDIT.md) |
| 3. Dependency audit | Done: AUDIT.md section 11 |
| 4. Fix | Done: see the fix status table in AUDIT.md |
| 5. Automated tests | Done: all pass (below) |
| 6. Local install | Done except the user's restarts |
| 7. Live testing | Not started |
| 8. Wrap up | Not started. Push to `origin` only, no upstream PR |

## Corrections to the original brief

- `navigate` did NOT allow `chrome-extension:` URLs at `6a37c29`. `1a9d2c7` added it, and
  `a18d096` reverted it 12 minutes later. This branch now refuses such URLs explicitly.
- CRLF checkout of `install.sh` is fine under Git Bash 5.2.37 (tested). No fix needed.

## Decisions (2026-11-05)

- M1: guard plus popup notice. Tools on another extension's page are refused, and every
  result leads with MANUAL APPROVAL NEEDED while another extension has a popup window open.
- M5: `file_upload` folder allowlist. Default `~/Downloads/ocic-uploads`, overridable by
  `OCIC_UPLOAD_DIR` or `uploadDir` in `~/.config/open-claude-in-chrome/config.json`.
- M7: pnpm instead of npm, using `pnpm import` lockfiles. The npm lockfiles are deleted, and
  the codemode worker installs only with `--with-codemode`.
- M3, M4, L2, L6: applied.
- zod 3 -> 4 (GHSA-mrhx-c7xc-m3w5): deferred as accepted risk. Exposure analysis is in
  AUDIT.md section 11.
- The npm-created `host/node_modules` and `host/codemode/worker/node_modules` were deleted
  with approval and reinstalled by pnpm.

## Commits on this branch

| Commit | What |
|---|---|
| `3d668ca` | docs: audit + fork notes |
| `e71f256` | H1 codemode callback secret |
| `7a1dd50` | M2 navigate load-wait race |
| `2aac173` | M6 storage.local access level |
| `e72df01` | L3 upload marker cleanup |
| `08f90b3` | L2 stale group fallback |
| `4736113` | M3 audit gate |
| `22d39b5` | M4 recorder masking |
| `b01d19a` | L6 manifest permissions |
| `8a36198` | M5 file_upload folder allowlist |
| `1b422f2` | M1 other-extension guard + approval notice |
| `ea2f7b0` | pnpm lockfiles |
| `66bc4fa` | M7 install.sh pnpm + opt-in codemode |
| `a69de2e` | host deps upgrade |
| `3ea186d` | worker deps upgrade |

## Tests

Baseline at `6a37c29`: all root suites and `host` `npm test` passed. There were no
pre-existing failures.

After the fixes (final tree):
- Root (`for t in test/*.test.mjs; do node "$t"; done`): audit-segments 13/13, guards (new)
  all pass, handlers all pass, humanize-executor all pass, humanize-planners all pass,
  navigate (new) all pass.
- Host (`pnpm --dir host test`): endpoint 7/7, parent-watch 3/3, ownership 12/12,
  callback-auth (new) 6/6, upload-guard (new) 12/12.
- Smoke: `mcp-server.js` over stdio with SDK 1.32.2 lists all 26 tools, and `file_upload`
  with an outside path is refused by the host guard.
- Worker: wrangler 4.157.0 `wrangler dev` boots and `/generate` answers.
- Not run: `host/codemode/test-*.js`. They need a live browser and the codemode servers,
  which this fork does not use.

## Step 6 progress

- [x] User created a Chrome profile "Demo" and disabled the official Claude in Chrome
      extension in it (user-reported; verify visually in step 7).
- [x] User loaded `extension/` unpacked in Demo. Extension ID: `nocfniakmakpddaiojiipcbnknpbdmae`.
- [x] `./install.sh nocfniakmakpddaiojiipcbnknpbdmae` run (2026-11-05). It wrote
      `host/native-host-wrapper.bat` and `host/com.anthropic.open_claude_in_chrome.json`
      (both gitignored). `allowed_origins` has only that ID. It registered
      `HKCU\Software\{Google\Chrome,Microsoft\Edge,BraveSoftware\Brave-Browser}\NativeMessagingHosts\com.anthropic.open_claude_in_chrome`.
- [x] `claude mcp add open-claude-in-chrome -- node C:\Users\rehob\project\open-claude-in-chrome\host\mcp-server.js`
      Re-registered at user scope on 2026-11-05 (`claude mcp add -s user ...`), so it loads in
      every Claude Code session from any folder, which the recording session needs.
      `claude mcp get` reports Connected.
- [x] Chrome fully restarted. The native host runs for the extension ID and owns
      `\\.\pipe\open-claude-in-chrome-rehob`.
- [ ] User restarted Claude Code (any folder) so the `mcp__open-claude-in-chrome__*` tools load.

First thing in step 7: call `mcp__open-claude-in-chrome__tabs_context_mcp` with
`createIfEmpty: true`. If it says the extension is not connected:
1. Check that Chrome was fully restarted.
2. Check that the extension is enabled in the Demo profile.
3. Check `~/.config/open-claude-in-chrome/host-exits.log`.

## Step 7 plan

Serve test pages with `python -m http.server 8765 --bind 127.0.0.1` from the repo root.
Pages: `http://127.0.0.1:8765/scratch/test-form/`, `/scratch/click-truth/`. test-form pulls
React/Babel from unpkg (AUDIT L8), so it needs the network.

1. Tabs: `tabs_context_mcp` (createIfEmpty), `tabs_create_mcp`, `tabs_close_mcp`, switching
   via tabId and `set_tab_focus`.
2. `navigate`, back/forward, reload (`key` F5 or `navigate` to the same URL), load waiting.
   Check that back/forward now return quickly (M2).
3. `read_page`, `find`, `get_page_text` on test-form and Wikipedia (search a term, open the
   result, scroll to a section).
4. Click by ref and by coordinate on click-truth. Confirm the landing point matches.
5. `type`, `key` shortcuts, `form_input`, select dropdowns, `scroll`, screenshots.
6. `read_console_messages`, `javascript_tool`.
7. Visual check by the user: no orange cursor or overlay, and whether the "started
   debugging this browser" bar appears. If it does, relaunch Demo with
   `--silent-debugger-extension-api` and retest.
8. Recording off by default: confirm nothing is captured (no files under
   `~/.config/open-claude-in-chrome/recordings` and no `behavior_event` traffic).
9. Network check: the user opens the service worker DevTools (chrome://extensions > Inspect
   views) and watches the Network tab during a few actions. Expect no outbound calls.
10. Wallet flow on a testnet dapp: Connect Wallet, then sign a message. At each popup, STOP
    and say "approve the wallet popup, then say done". Confirm the MANUAL APPROVAL NEEDED
    notice appeared, that the extension never touched the popup, and that the page picked up
    the result. No transactions unless the user confirms testnet funds on the exact network.
