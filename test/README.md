# Tests

Plain Node, no framework, no dependencies. Run them all:

```bash
for t in test/*.test.mjs; do node "$t" || break; done
```

| File | Covers |
|---|---|
| `humanize-planners.test.mjs` | The pure planners in `extension/humanize/`. Asserts the invariants that make humanization safe: a click always lands exactly on its target (including 8×8px targets), typed text reassembles byte-identically (incl. unicode/emoji), scroll deltas sum to exactly the requested amount, key hold stays below the OS typematic initial delay, and a deliberate long hold renders the real auto-repeat sequence. |
| `humanize-executor.test.mjs` | The plan→CDP seam: runs the shipped `dispatchPlan` against a mock CDP layer and asserts the exact calls, their order (`keydown → insertText → keyup` per character), and per-tab cursor continuity. This is the layer that caught the missing shifted-digit key mappings. |
| `handlers.test.mjs` | Tool handlers against a mocked `chrome.*` API: that creating a tab never selects it or raises a window (#28), that `set_tab_focus` is quiet unless `focus_window` is set (#35), and the layered default/per-tab config with its storage scoping. |
| `navigate.test.mjs` | `navigate`'s load wait against a mocked `chrome.tabs`: a load that finishes before `goBack()`/`update()` resolves and a same-document change with no `complete` event both return promptly instead of sitting out the 10s timeout, a normal load is still waited for, and the `onUpdated` listener is always removed. |
| `guards.test.mjs` | Security boundaries in `background.js`: only tabs currently in the MCP group are drivable (a tab dragged out of the group is refused even if a stale in-memory set still lists it), and `audit_mode` never starts a recording in a tab outside the group. |

`_extract.mjs` pulls the functions under test out of `extension/background.js` by
brace-matching. That indirection is deliberate: `background.js` is a service
worker with no exports whose top level touches `chrome.*` immediately, so this
lets the tests exercise the shipped source instead of a copy that could drift.
