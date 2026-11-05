# Security and reliability audit

Fork: `AlphaTechini/open-claude-in-chrome`, branch `audit-and-hardening`.
Audited upstream commit: `6a37c29` (upstream `main` has not moved since; no new diff to review).
Audit date: 2026-11-05. Platform used for checks: Windows 11, Node 24.12.0, npm 11.14.1, Git Bash 5.2.37.

Intended use for this fork: drive a real Chrome profile that also has a wallet extension,
through `host/mcp-server.js` only (no codemode/hybrid), for recording demo videos.
Severity below is ranked for that use. Where a finding only applies to an optional
component, the finding says so.

## Summary

| ID | Severity | Area | One line |
|---|---|---|---|
| H1 | High (codemode/hybrid only) | host/codemode | Unauthenticated loopback HTTP endpoint runs any browser tool |
| M1 | Medium | extension | No explicit guard or notice for other extensions' pages (wallet popups) |
| M2 | Medium | extension | `navigate` load-wait race: fast or same-document loads stall 10s |
| M3 | Medium | extension | `audit_mode` injects rrweb into tabs outside the MCP group |
| M4 | Medium | extension | Recorder saves password / OTP field values to disk |
| M5 | Medium | extension | `file_upload` accepts any local path (prompt-injection exfil path) |
| M6 | Medium | extension | OpenAI key in `storage.local` is readable from content-script contexts |
| M7 | Medium | install.sh | Runs `npm install` with lifecycle scripts and installs the codemode toolchain unconditionally |
| M8 | Medium | deps | Advisories in `@modelcontextprotocol/sdk@1.29.0` and the `wrangler@4.94.0` tree |
| L1 | Low | host | Any same-user process can drive the bridge without authentication |
| L2 | Low | extension | `isInGroup` trusts a stale in-memory set for ungrouped tabs |
| L3 | Low | extension | `file_upload` leaves a marker attribute on a non-file-input target |
| L4 | Low | extension | Global `unhandledrejection` handler hides every rejection |
| L5 | Low | extension | Debug buffer and audit log keep the first 60 chars of typed text |
| L6 | Low | manifest | `"windows"` is not a permission; `activeTab` is redundant |
| L7 | Low | host | Native host builds file paths from extension-supplied ids without sanitizing |
| L8 | Low | scratch | `scratch/test-form` loads React/Babel from unpkg without SRI |
| L9 | Low | host | `mcp-server.js` patches SDK internals |
| L10 | Low | repo | Root `package-lock.json` with no `package.json` |
| L11 | Info | extension | Viewport size is read in the page's main world (spoofable) |

Confirmed OK (details in the sections below): no overlay or style injection, outbound network
limited to `api.openai.com` and loopback, content scripts silent while recording is off,
vendored rrweb byte-identical to npm, bridge is a named pipe / unix socket with no TCP listener
in the default server, `navigate` does not accept `chrome-extension:` URLs.

---

## 1. Manifest permissions

Source: [extension/manifest.json](../extension/manifest.json)

| Permission | Used by | Verdict |
|---|---|---|
| `tabs` | tab URLs/titles in `formatTabContext` (background.js:283-303), `isInGroup` (background.js:305-327), recorder URL capture (background.js:3235-3246) | Needed |
| `debugger` | every CDP call: `ensureAttached` (background.js:348-402), `cdp()` (background.js:425-442) | Needed |
| `activeTab` | nothing that `<all_urls>` does not already grant (`captureVisibleTab` at background.js:2725 is covered by the host permission) | Redundant (L6) |
| `scripting` | content-script fallback injection (background.js:624-627), audit injection (audit/index.js:137-145, 223-226) | Needed |
| `nativeMessaging` | `connectNative` (background.js:135) | Needed |
| `tabGroups` | MCP group (background.js:253-281, 3294-3305) | Needed |
| `windows` | `chrome.windows.*` (background.js:275, 2043-2096, 2556) | Not a Chrome permission; `chrome.windows` needs none (L6) |
| `storage` | config, recorder state, OpenAI key (background.js:913-971, 2682-2709, 2767-2769) | Needed |
| `alarms` | keep-alive (background.js:118-123) | Needed |
| `offscreen` | recorder mic + clipboard document (background.js:2756-2765) | Needed for recording only |
| `clipboardWrite` | recording reference copy (background.js:2830-2840, offscreen.js) | Needed for recording only |
| host `<all_urls>` | content scripts on every page (manifest.json:31-52), `captureVisibleTab`, `executeScript` | Needed for "any site" automation |

Not requested: `cookies`, `webRequest`, `downloads`, `history`, `management`,
`externally_connectable`. Pages cannot message the extension directly.

## 2. Outbound paths

Grep over `extension/`, `host/*.js`, `host/codemode/` for `fetch(`, `XMLHttpRequest`,
`WebSocket`, `sendBeacon`, `EventSource`, `importScripts`, `import(`, `eval(`,
`new Function`, string `setTimeout`/`setInterval`, `<script src>`, `<iframe>`, `.src =`.

| Location | Destination | When |
|---|---|---|
| extension/recorder/transcribe.js:12, 84, 123 | `https://api.openai.com/v1/audio/transcriptions` | Only on recording start (key probe) and after a recording stops, only with a user-supplied key |
| extension/background.js:3119 | `chrome-extension://<self>/recorder/SCHEMA_v0.md` | Packaged file, no network |
| host/codemode/common.js:321, 361 | `http://127.0.0.1:<port>` (wrangler worker) | codemode/hybrid servers only |
| host/codemode/worker/worker.js:39 | caller-supplied `callbackUrl` | codemode/hybrid servers only |
| host/endpoint.js:100 | `import("node:net")` | Node builtin, not remote |
| extension/recorder/options.html:240-241, offscreen.html:11 | packaged scripts | No remote script |
| extension/recorder/offscreen.js:248, options.js:481, 570 | `img.src = dataUrl` | Local data URLs |

No `eval`, `new Function`, `importScripts`, string timers, `WebSocket`, `sendBeacon`, or
`EventSource` anywhere in shipped code. Expected picture confirmed.

Agent-supplied code does run in pages by design: `javascript_tool` (background.js:1866-1900)
evaluates arbitrary JS in the page's main world, and `scroll_to` interpolates the
coordinate args into a `Runtime.evaluate` string (background.js:1699-1701). Both are only
reachable for tabs in the MCP group.

Not shipped, but worth knowing when serving them for tests: `scratch/guidance-layers.html:7-9`
and `scratch/refresh-knobs.html:7-9` load Google Fonts, and `scratch/test-form/index.html:6-8`
loads React and Babel from unpkg (L8).

## 3. Content scripts

### content.js (every top frame, `document_idle`)

Source: [extension/content.js](../extension/content.js)

- Runs in the isolated world. Its globals (`window.__unblockedChrome`, content.js:658-667)
  are invisible to the page.
- It only responds to `chrome.runtime.onMessage` from the extension (content.js:586-655). It
  sends nothing on its own.
- DOM writes during normal tool use: `scrollIntoView` when resolving a ref
  (content.js:379, 545), form value setting + synthetic `input`/`change` events
  (content.js:375-424), and a temporary `data-ocic-upload-target` attribute during
  `file_upload`/`upload_image` only (content.js:638, 646-648).
- No element creation, no `style` changes, no overlay. Nothing is drawn.

### recorder/capture.js (every frame, `document_start`)

Source: [extension/recorder/capture.js](../extension/recorder/capture.js)

- At load it sends one internal `recorder_hello` message to the service worker
  (capture.js:36-41). That is extension-internal, not network.
- Every listener returns early unless `recording` is true (capture.js:165, 239, 255, 268,
  302, 338, 363, 371, 379, 395, 413). `recording` is only set by an extension message
  (capture.js:32-34).
- The service worker also drops events while not recording (background.js:3203-3224).
- Its only DOM interference is `preventDefault` on Alt+click, and only while recording is on
  (capture.js:340-345).
- Conclusion: nothing is captured or sent while recording is off, and nothing is drawn.

### humanize/

`extension/humanize/index.js:3` documents it as pure. Grep confirms no `document`, `chrome.`,
or DOM access in `humanize/*.js`. It plans paths only. It never renders a cursor. Humanize is
off by default (background.js:906).

### audit/inject.js (on demand, only when `audit_mode` is `"audit"`)

Injected into the isolated world (audit/index.js:137-145). rrweb `record()` observes the DOM.
It does not modify it. Canvas recording is off (inject.js:67). Off by default
(background.js:906). See M3 for the gating problem.

## 4. Secrets

- The OpenAI key is stored with `chrome.storage.local.set({ openai_api_key })`
  (options.js:58) and read in the service worker (background.js:2767-2769) and options page
  (options.js:13-14).
- It is passed to the offscreen document over `chrome.runtime.sendMessage`
  (background.js:2784-2788, 2924-2931, 2261-2266). Runtime messages do not reach content
  scripts.
- It is held in the offscreen `session` object (offscreen.js:186, 313), but is not part of
  the `trace`, the IndexedDB session record (offscreen.js:474-502), or anything written to
  disk.
- It is never logged. `describeFailure` (transcribe.js:27-39) maps responses to fixed strings.
- Exposure: `storage.local` defaults to readable from content scripts. Pages cannot read it,
  but a compromised renderer could (M6).

## 5. Native host and bridge

Sources: [host/endpoint.js](../host/endpoint.js), [host/native-host.js](../host/native-host.js),
[host/tool-runtime.js](../host/tool-runtime.js)

- Transport: a Windows named pipe `\\.\pipe\open-claude-in-chrome-<user>`
  (endpoint.js:55-57), or a unix socket `$TMPDIR/open-claude-in-chrome-<uid>/bridge.sock` on
  POSIX (endpoint.js:58, 64-73).
- There is no TCP listener in the native host or `mcp-server.js`. The shared TCP port was
  removed in `1ddc25a`.
- POSIX permissions: directory `0700` (endpoint.js:75-81), socket `0600` (endpoint.js:86-91).
- Windows permissions: libuv creates the pipe with default security (`CreateNamedPipe(...,
  NULL)`). Per Microsoft that grants full control to LocalSystem, Administrators, and the
  creator owner, plus read-only access to Everyone and Anonymous
  ([docs](https://learn.microsoft.com/en-us/windows/win32/ipc/named-pipe-security-and-access-rights),
  [node#47086](https://github.com/nodejs/node/issues/47086)). A read-only client cannot send
  `client_hello`, so it is dropped after 500ms (native-host.js:97-102, 122-126) and never
  receives data.
- Protocol: a client sends `{"type":"client_hello"}\n`, then any number of
  `{"type":"tool_request","tool":...,"args":...}` lines (native-host.js:105-127, 171-190).
  There is no authentication. See L1 for what an unauthenticated same-user process can do.
- The host writes only under `~/.config/open-claude-in-chrome/`: `recordings/`, `audits/`,
  `screenshots/`, `tmp/`, `host-exits.log` (native-host.js:248-403, 483-496).
  `parent-watch.js` adds `server-exits.log` (parent-watch.js:36-48).
- The extension can only ask the host to write files. No message type makes the host read
  arbitrary files or spawn processes.
- `parent-watch.js:69-87` runs `powershell Get-CimInstance` with a numeric PID (no injection
  surface) to detect a recycled parent PID on Windows.

## 6. install.sh

Source: [install.sh](../install.sh). Windows path applies here (Git Bash, `uname` = `MINGW*`,
install.sh:37-42).

Runs:
- `npm install` in `host/` if `node_modules` is missing (install.sh:51-55). Lifecycle scripts
  are enabled.
- `npm install` in `host/codemode/worker/` if `node_modules` is missing (install.sh:60-65).
  Lifecycle scripts are enabled. This pulls wrangler, workerd, esbuild, and sharp (M7).
- `cygpath` (install.sh:135-150), `reg.exe add` (install.sh:166).

Writes, Windows:
- `host/native-host-wrapper.bat` (install.sh:142-143). Inside the repo, gitignored.
- `host/com.anthropic.open_claude_in_chrome.json` (install.sh:147-149). Inside the repo,
  gitignored.
- Registry `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.anthropic.open_claude_in_chrome`,
  plus the same key under `Microsoft\Edge` and `BraveSoftware\Brave-Browser`
  (install.sh:155-157). Per-user, no admin.

Writes, macOS/Linux:
- `host/native-host-wrapper.sh` (install.sh:98-105).
- `<browser>/NativeMessagingHosts/com.anthropic.open_claude_in_chrome.json` for each browser
  directory that exists (install.sh:108-120, 178-222).

The manifest's `allowed_origins` is limited to the extension IDs passed on the command line
(install.sh:67-73, 88).

`refresh-mcp.sh` is a dev helper that `pkill -9`s this repo's MCP servers (refresh-mcp.sh:70-73).
It is not part of install.

Line endings: `core.autocrlf=true` checks the `.sh` files out as CRLF. Git Bash 5.2.37 runs a
CRLF script correctly (tested), so this is not a problem on this machine.

## 7. Vendored rrweb

Files in `extension/vendor/`, added in `a48bd53`. Compared against tarballs fetched with
`npm pack` (registry integrity verified by npm), using the committed blob bytes
(`git show HEAD:<path> | sha256sum`), since the working tree has CRLF conversion applied.

| Vendored file | sha256 (committed blob) | Identical to |
|---|---|---|
| rrweb.umd.min.js | `26dcba7a...16cd2ecc` | `rrweb@2.1.1` `dist/rrweb.umd.min.cjs` (byte-identical in 2.1.0) |
| rrweb.min.css | `334d2228...fdee40f9` | `rrweb@2.1.1` `dist/style.min.css` (unchanged since 2.0.0-alpha.18) |
| rrweb-player.umd.min.js | `d522d74c...fa70d6` | `rrweb-player@2.1.1` `dist/rrweb-player.umd.min.cjs` |
| rrweb-player.min.css | `ce5e9629...7e132a` | `rrweb-player@2.1.1` `dist/style.min.css` |

Result: vendored set is `rrweb@2.1.1` + `rrweb-player@2.1.1`, unmodified.
Advisories: none for `rrweb` / `rrweb-snapshot` 2.1.1 (Snyk). CVE-2025-45806 affects
`rrweb-snapshot` before 2.0.0-alpha.18. GHSA-xjgr-f74v-fx5m affects the separate
`@rrweb/rrweb-plugin-canvas-webrtc-record` package, which is not vendored. The latest release
is 2.2.0. Upgrading is optional.

## 8. Other extensions' pages (wallet popups)

What the code allows:
- `navigate` normalizes any URL that is not `http(s):`, `about:`, `chrome:`, or `brave:` by
  prefixing `https://` (background.js:1350-1354). A `chrome-extension://<id>/x` URL becomes
  `https://chrome-extension//<id>/x`, so an agent cannot open a wallet page through
  `navigate`.
- The brief mentions that `1a9d2c7` allowed `chrome-extension:`. That change was reverted 12
  minutes later in `a18d096` ("navigate: allowing chrome-extension: URLs was scope creep"),
  and the revert is in `6a37c29`.
- Every tab-targeting tool is gated by `isInGroup(tabId)` (background.js:1341, 1391, 1775,
  1801, 1823, 1857, 1869, 1949, 1991, 2023, 2191, 2288, 2542). Wallet popups open in their
  own popup window, outside the MCP group, so tool calls against them are refused. The
  exception is M3 (audit) and L2 (stale group set).
- Chrome itself refuses `chrome.debugger.attach` to another extension's `chrome-extension://`
  page, with the error `Cannot access a chrome-extension:// URL of different extension`.
  It also refuses to attach to a normal tab that contains another extension's iframe
  ([report](https://blog.vodou.ai/another-extensions-iframe-can-lock-your-chrome-debugger-agent-out-of-a-tab/),
  [opencli#662](https://github.com/jackwener/opencli/issues/662)). `chrome.scripting` is
  refused the same way. So no CDP click, key, or screenshot can land inside a wallet popup.
- What the code can still do: `javascript_tool` on the dapp tab can call
  `window.ethereum.request(...)`. That only opens the wallet's own approval popup, which still
  needs a human click.

Gaps (M1):
- No explicit guard. Safety rests on Chrome's check plus the group gate, and the error an
  agent sees is a raw CDP message.
- No signal that an approval popup appeared. The agent cannot see the popup window, so it
  cannot tell you to approve it.

## 9. Code not needed for this use

| Path | What it is | Ships in extension? | Touches host at runtime? | Recommendation |
|---|---|---|---|---|
| `benchmark/` (356 MB tracked) | Python research harness and HTML reports for the imitation-learning benchmark | No | No (no references from extension/, host/, install.sh) | Safe to delete in the fork, or leave |
| `REAL/` (1.1 MB) | Vendored `agisdk` Python SDK (Apache-2.0, AGI Inc.) used by the benchmark | No | No | Delete with `benchmark/` |
| `scratch/` | Local test pages: `click-truth`, `test-form`, `humanize-probe`, `audit-ui`, two design notes | No | No | Keep: step 7 live tests use `click-truth` and `test-form` |
| `docs/` | Design write-up HTML + one image | No | No | Keep (also holds this audit) |
| `host/codemode/` | `execute_code` servers + Cloudflare worker run by `wrangler dev` | No | Only if `server-codemode.js` / `server-hybrid.js` is registered with Claude Code. `install.sh` still installs its deps (M7) | Don't register it. Make the worker install opt-in |
| `test-prompt.md` | Prompt used for manual testing | No | No | Leave |

## 10. Findings

### H1. Unauthenticated loopback HTTP endpoint runs any browser tool (codemode/hybrid only)

- `host/codemode/common.js:142-183`: `startCallbackServer` listens on `127.0.0.1:<random>`
  and executes `POST /tool/<name>` with a JSON body as an MCP tool call. There is no token
  and no origin check.
- The callback URL is handed to the worker in `server-codemode.js:63` and
  `server-hybrid.js:130`. `host/codemode/worker/worker.js:70-80` accepts `POST /execute` and
  `/generate`, also without auth.
- Who can reach it: any local process of any user (loopback TCP is not user-scoped). A web
  page can also send a CORS "simple" request (`Content-Type: text/plain`, which the server
  parses as JSON regardless, common.js:153-155) without a preflight. Recent Chrome's Local
  Network Access prompt mitigates the page case, but does not remove it.
- Impact: `javascript_tool` in logged-in tabs, `navigate`, and `file_upload` of any local file
  into a page.
- Not reachable when only `host/mcp-server.js` is registered.
- Fix: a per-process random secret in the callback path, checked by the server.

### M1. No explicit guard or notice for other extensions' pages

See section 8.
- Fix: refuse any tab-targeting tool whose tab URL is another extension's `chrome-extension://`
  page, with a clear message.
- Fix: detect windows/tabs opened by other extensions (`chrome.tabs.onCreated` /
  `chrome.windows.onCreated`, URL `chrome-extension://<not-self>/`) and surface them in tool
  results, so the agent stops and asks for manual approval.

### M2. `navigate` load-wait race

`background.js:1360-1378`: the `onUpdated` listener is registered after
`chrome.tabs.update` / `goBack` / `goForward` resolve.
- A cached or bfcache page can reach `status: "complete"` before the listener exists.
- Same-document navigations (hash, `pushState`) never emit `complete`.
- In those cases `navigate` waits the full 10s, then reports success. Back/forward on a
  bfcache hit is the common trigger.
- Fix: register first, then check `chrome.tabs.get` once after issuing the navigation.

### M3. `audit_mode` records tabs outside the MCP group

`handleToolRequest` calls `audit.noteAction` (background.js:2602-2620) before the handler
runs its `isInGroup` check. `noteAction` calls `ensureStream(tabId)` for any numeric
`tabId` (audit/index.js:273), and `ensureStream` injects rrweb into that tab
(audit/index.js:136-145).
- Effect: with audit mode on, a tool call naming any tab id (for example, one of your
  personal tabs) starts a full DOM recording of it, checkpointed to `~/.config/.../audits`.
  The tool itself is then refused.
- Audit is off by default, but an agent can turn it on with `set_config`
  (background.js:2493-2534).
- Fix: only call `ensureStream` for tabs in the group.

### M4. Recorder saves password and OTP field values

`capture.js:392-401` emits `type` events with `el.value` for every `INPUT`/`TEXTAREA`/`SELECT`
`change`, including `type="password"`. These land in `trace.json` on disk
(native-host.js:264-296). This only happens while recording is on (manual toolbar click).
- Fix: skip the value for password inputs and `autocomplete` one-time-code / credit-card
  fields. Keep the event, record the value as masked.

### M5. `file_upload` accepts any local path

`background.js:2286-2331` passes agent-supplied absolute paths straight to
`DOM.setFileInputFiles`.
- Risk: a prompt injection on any page can ask the agent to attach `~/.ssh/id_*`, a wallet
  keystore, or browser profile files to a form on an attacker's site.
- This matches the official extension's capability, so restricting it is a judgment call.

### M6. OpenAI key readable from content-script contexts

`storage.local` is exposed to content scripts by default
([Chrome docs](https://developer.chrome.com/docs/extensions/reference/api/storage)).
No content script in this extension uses `chrome.storage` (grep: content.js, capture.js,
audit/inject.js).
- Fix: call `chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })` at
  service-worker start (feature-detected).

### M7. install.sh runs lifecycle scripts and installs the codemode toolchain

`install.sh:51-65` runs `npm install` (not `npm ci`, scripts enabled) in `host/` and
unconditionally in `host/codemode/worker/`.
- The worker tree has four packages with install scripts (section 11).
- `npm install` may also re-resolve within semver ranges instead of using the lockfile
  exactly.
- `host/` has no install scripts, so `npm ci --ignore-scripts` is lossless there.

### M8. Dependency advisories

See section 11. `host/` is reached through the stdio transport only, so the SDK's HTTP and
OAuth advisories and the `hono` / `body-parser` / `fast-uri` ones are not exploitable through
`mcp-server.js`. They are fixed by an in-range upgrade anyway.

### L1. Same-user processes can drive the bridge without authentication

Any process running as the same Windows user can open the pipe, send `client_hello`, and
call every tool (native-host.js:85-128, 163-204). That includes `javascript_tool` in logged-in
tabs of the MCP group, `tabs_create_mcp` + `navigate` anywhere, and `file_upload`.
- A same-user process can already do a lot. But this lets it act inside Chrome sessions that
  Chrome's app-bound cookie encryption otherwise keeps from it.
- A token file would not help, since the same user can read it.
- Documented as residual risk. Close Chrome (which stops the host) when not recording.

### L2. `isInGroup` trusts a stale set

`background.js:323`: when a tab's live `groupId` is `-1` (you dragged it out of the MCP group),
the function falls back to the in-memory `tabGroupTabs` set. That set can still contain the
tab. Pulling a tab out of the group should stop automation on it.
- Fix: return `false` and drop the id.

### L3. `file_upload` leaves its marker attribute

`background.js:2308-2310` returns early on a non-file-input target without sending
`unmarkElementForUpload` (`upload_image` does, background.js:2211-2213).

### L4. Global rejection swallowing

`background.js:8-10` calls `preventDefault()` on every unhandled rejection, so real bugs
leave no trace in the service-worker console. Left as is: it exists to keep the worker alive.
Noted for debugging.

### L5. Typed text retained in debug and audit logs

`argSummary` (background.js:1167-1185) keeps the first 60 characters of every string arg,
including `computer.type` text. It goes to the in-memory debug ring (background.js:2592) and,
with audit on, to `audit.json` (audit/index.js:282).

### L6. Manifest noise

`"windows"` (manifest.json:14) is not a Chrome permission; `chrome.windows` needs none.
`"activeTab"` (manifest.json:10) adds nothing next to `<all_urls>`.

### L7. Host trusts extension-supplied ids in paths

`native-host.js:255, 271, 334, 339` join `session_id` / `recording_id` / `name` into paths
without sanitizing. `save_audio` does sanitize (native-host.js:304-306). The extension is the
only writer and generates these ids itself, so this is defense in depth only.

### L8. scratch/test-form loads remote scripts without SRI

`scratch/test-form/index.html:6-8` pulls `react@18`, `react-dom@18`, and
`@babel/standalone` (unversioned) from unpkg.

### L9. SDK internals patched

`mcp-server.js:47-57` wraps `server.server.setRequestHandler` to coerce args before zod runs.
It relies on SDK internals, so it must be re-checked after every SDK upgrade.

### L10. Orphan root lockfile

`package-lock.json` at the root has `"packages": {}` and there is no root `package.json`.
Harmless.

### L11. Main-world viewport read

`takeScreenshot` (background.js:669-677), `read_page` (background.js:1791-1794), and
`resize_window` read `innerWidth` / `devicePixelRatio` via main-world `Runtime.evaluate`, which
a page can override. Impact is limited to a wrong screenshot clip.

### Reliability notes (no fix planned unless a live test shows them)

- `chrome.debugger.onDetach` (background.js:481-483) only clears `attachedTabs`. The next
  call re-attaches, which is correct. If you click "Cancel" on the debugging infobar, the
  next tool call silently re-attaches and the bar comes back.
- Another extension's iframe inside a normal page makes `chrome.debugger.attach` fail for the
  whole tab. Wallets that inject iframes into dapp pages can trigger this. The agent sees
  `Cannot access a chrome-extension:// URL of different extension`.

## 11. Dependencies

Installed with `npm ci --ignore-scripts` in each directory. The root has no `package.json`
(L10).

### host/

| Package | Range | Installed | Latest | Genuine | Used |
|---|---|---|---|---|---|
| @modelcontextprotocol/sdk | ^1.12.1 | 1.29.0 | 1.32.2 | Yes: repo modelcontextprotocol/typescript-sdk, maintainers jspahrsummers, pcarleton, fweinberger, ochafik-ant | mcp-server.js:12-13, codemode servers |
| zod | ^3.23.8 | 3.25.76 | 4.6.7 | Yes: colinhacks/zod, maintainer colinhacks | tool-definitions.js:9, server-codemode.js:16 |
| zod-to-json-schema | ^3.24.0 | 3.25.2 | 3.25.2 | Yes: StefanTerdell/zod-to-json-schema, maintainer stefan-terdell | tool-definitions.js:10, 637 |

- Install scripts in tree: none.
- `npm audit` (before): 5 advisories, all transitive via the SDK's HTTP server stack
  (`@modelcontextprotocol/sdk <=1.31.0` high, `hono <=4.13.10` high, `body-parser 2.0.0-2.3.0`
  high, `fast-uri 3.0.0-3.1.8` high, `@hono/node-server <=2.1.2` moderate).

### host/codemode/worker/

| Package | Range | Installed | Latest | Genuine | Used |
|---|---|---|---|---|---|
| @cloudflare/codemode | ^0.3.7 | 0.3.7 | 0.5.6 | Yes: cloudflare/agents, Cloudflare publisher accounts | worker.js:1 |
| wrangler (dev) | ^4.94.0 | 4.94.0 | 4.157.0 | Yes: cloudflare/workers-sdk, wrangler-publisher | spawned by codemode/common.js |

Install scripts in tree:
- `esbuild@0.27.3` postinstall `node install.js`: checks that the platform binary package
  (`@esbuild/<platform>`) is present. If not, it runs `npm install` for it or downloads it
  from registry.npmjs.org.
- `workerd@1.20260521.1` postinstall `node install.js`: same pattern for
  `@cloudflare/workerd-<platform>`. Fallback URL is
  `https://registry.npmjs.org/<pkg>/-/<pkg>-1.20260521.1.tgz`.
- `sharp@0.34.5` install `node install/check.js || npm run build`: checks for the prebuilt
  `@img/sharp-<platform>` libvips. If missing, it builds from source via node-gyp.
- `fsevents@2.3.3` (optional, macOS only): native build. Not installed on Windows.

`npm audit` (before): 6 advisories. `esbuild 0.27.3-0.28.0` low, via wrangler; `sharp
<=0.35.5-rc.1` high, `undici 7.0.0-7.30.0` high, and `ws 8.0.0-8.20.1` high, via miniflare;
plus `wrangler` and `miniflare` themselves.

Upgrade results are recorded in [FORK-NOTES.md](FORK-NOTES.md).
