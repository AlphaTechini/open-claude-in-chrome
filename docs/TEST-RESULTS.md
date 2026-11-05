# Step 7: live test results

Live tests of the `audit-and-hardening` branch through the fork's own MCP tools
(`mcp__open-claude-in-chrome__*`). The plan is in [FORK-NOTES.md](FORK-NOTES.md), "Step 7 plan".

## Environment (2026-11-05)

- Chrome 156.0.0.0 on Windows 11 Pro 10.0.22000, profile "Demo", device pixel ratio 1.5.
  The Demo window was maximized and visible in front during the tests.
- Extension `nocfniakmakpddaiojiipcbnknpbdmae`, native host connected on the first call.
- Test pages served by `python -m http.server 8765 --bind 127.0.0.1` from the repo root.
- The internet was down for the first half of the session (shell `curl` and Chrome both
  timed out). The network-dependent tests ran after it came back.

## Results

Final state, after the fixes below were loaded.

| # | Check | Result |
|---|---|---|
| 1 | `tabs_context_mcp` with `createIfEmpty` | Pass. New group with one tab. |
| 1 | `tabs_create_mcp` | Pass. Created unselected, in the group's window. |
| 1 | `set_tab_focus` (no window raise) | Pass. |
| 2 | `navigate` to a local page | Pass, about 140 to 260 ms. |
| 2 | `navigate` while page scripts hang (unpkg offline) | Pass. Returned after 10 s with "(still loading)". |
| 2 | `navigate` back / forward (M2) | Pass, 71 ms and 56 ms. |
| 3 | `read_page` with `filter: interactive` | Pass. |
| 3 | `find` | Pass for text that appears on the element. See minor notes. |
| 3 | `get_page_text` | Pass. Full Wikipedia article (75k characters). |
| 3 | Wikipedia: search, open result, jump to a section | Pass after fix F4. |
| 4 | Click by coordinate, by ref, off-screen ref, covered ref | Pass. Covered ref names `div#overlay`. |
| 4 | Clicks on a background tab | Pass after fix F2. |
| 4 | Click at coordinates read off a scrolled screenshot | Pass after fix F4 (opened the right Wikipedia link). |
| 5 | `screenshot`, selected or background tab, scrolled or not | Pass after fixes F1 and F4. |
| 5 | `type` | Pass. |
| 5 | `key`: Tab, Enter (submits), Ctrl+A, Backspace, Space on a checkbox | Pass after fix F3. |
| 5 | `form_input` on text fields and checkboxes | Pass. |
| 5 | Radio buttons, multi-step wizard, ordered 9-click grid | Pass. All four test-form challenges complete. |
| 5 | `scroll` on the page and on a nested scroll box | Pass. |
| 5 | `scroll_to` with a ref | Pass after fix F4. |
| 6 | `javascript_tool`, `read_console_messages` | Pass. |
| 6 | `read_network_requests` | Pass. Capture starts at the first call on a tab, so the first read is empty; after a page reload it listed the page's requests. See minor notes. |
| 6 | `debug`, `debug_timings` | Pass. Used to pin down F1 to F4. |
| 8 | Recording off by default | Pass. No `~/.config/open-claude-in-chrome/recordings` folder exists, and the debug log has no recorder traffic (it only covered about 3 minutes, after a worker restart). |

### Watched run on go.dev (user observing)

Task: starting from go.dev, find Context and four other Go concepts by clicking through the
site, then (on the user's request mid-run) by using the search bar. All five were found:

1. Context: Docs menu (hover), Standard library, scroll, `context`.
2. Goroutines: Docs menu, Effective Go, contents link by ref.
3. Channels: browser back to the contents, contents link.
4. Error wrapping: Packages, click the search bar, type `errors`, Enter, open the
   standard library result, `scroll_to` the wrapping paragraph.
5. Mutex: `/` shortcut to focus the search bar, type `sync.Mutex`, Enter, open the result.

Hover menus, ref clicks into off-screen content, back navigation, typing, Enter, the `/`
shortcut and screenshots on scrolled pages all behaved. The go.dev cookie banner was left
alone rather than accepted on the user's behalf.

### Visual check (plan item 7, user observed)

- No cursor, glow or overlay was drawn on the page. Pass.
- Chrome's "started debugging this browser" bar does show. An extension cannot hide it;
  only launching Chrome with `--silent-debugger-extension-api` does, and that hides it for
  every extension in the session. The user chose to leave the bar and handle it when
  editing the demo video.

### Network check (plan item 9, user observed)

The user watched the service worker's DevTools Network tab while every tool type ran:
tab create and close, navigation to local pages, go.dev and back, clicks, wheel scroll,
typing, Tab, `form_input`, `read_page`, `find`, `get_page_text`, `javascript_tool`,
`read_console_messages`, and screenshots of a selected and a background tab. The list
stayed empty. Pass.

### Wallet flow (plan item 10)

Not run. The user chose to approve wallet popups by hand while recording instead of a
separate test. What still holds from earlier checks: tools refuse other extensions' pages
and `chrome-extension:` navigation (`test/guards.test.mjs`), and Chrome itself blocks CDP and
scripting inside another extension's popup (AUDIT.md section 8). The MANUAL APPROVAL NEEDED
notice was not observed live.

## Fixes made during step 7

| ID | Commit | Problem | Origin |
|---|---|---|---|
| F1, F2 | `82d7617` | An unselected tab got no frames and no input on Chrome 156 / Windows. Screenshots hit the 20 s CDP timeout, and clicks were dispatched without error but never reached the page, while the tool said "Clicked". The `computer` tool and `takeScreenshot` now select the tab inside its own window first (the window is never raised) and wait for a paint. Chosen by the user over "refuse with an error" and "document only". | Upstream design (issue #28) |
| F3 | `a3c2088` | `key` derived the Windows virtual-key code from the key name's first letter (Backspace sent as B, Enter as E, arrows as A, a lowercase letter as a numpad key), and sent Space as key `"Space"`. Backspace, Ctrl+A, Space on a checkbox and Enter-to-submit did nothing while the tool said "Pressed". | Upstream, present at `6a37c29` |
| F4 | `eb59ed4` | Screenshots used a clip at (0,0), but CDP measures clip x/y from the document origin, so any scrolled page came back as the document top: a blank band the height of the scroll, then the wrong content, with every coordinate off by the scroll offset. Also `scroll_to` with a ref passed the ref's viewport coordinates to `window.scrollTo`, jumping the page back near the top while reporting success. | Upstream |

Before F4 was found, its blank band was logged as a separate "half painted after scroll"
problem, and a nested scroll box that did not scroll was blamed on painting. Both went
away once tabs were selected and the clip was fixed. The nested box scrolled 200 px as
expected on the final build.

After each fix: `node --check extension/background.js` passed and all root suites passed.
The host suites were run after F1/F2 and were not affected by the later changes (no host
files changed).

## Minor notes (not fixed)

- `find` matches text, not intent: "Confirm button" and a three-target query returned
  nothing, while "Confirm" found the button. The tool description says "natural language".
- Two tabs in one window reported different viewports until each was selected. Upstream
  documents that Chrome does not re-layout an unselected tab, and F1/F2 select it now.
- `read_network_requests` enables network capture on its first call for a tab, so that
  call returns nothing and only later traffic is listed. Capture also resets when the
  extension reloads. The tool description does not say this.
- Refs reset when the extension is reloaded, so a ref from before a reload resolves to
  nothing. The tool says so and asks for a fresh `read_page`.
