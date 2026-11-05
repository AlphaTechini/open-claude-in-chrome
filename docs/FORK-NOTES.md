# Fork notes: audit-and-hardening

Running log for the `audit-and-hardening` branch of `AlphaTechini/open-claude-in-chrome`.
Goal: a safe, reliable replacement for the official Claude in Chrome extension for
recording demo videos (no in-page cursor overlay), usable next to a wallet extension, with
wallet approvals always left to a human.

## Setup facts

- Clone: `C:\Users\rehob\project\open-claude-in-chrome`. Remotes: `origin` = fork,
  `upstream` = noemica-io.
- Upstream HEAD is still `6a37c29` (2026-09-22). Nothing new since the first-pass review.
- OS: Windows 11 Pro 10.0.22000. Install path is Windows via Git Bash (`install.sh`
  `MINGW*` branch, which registers under HKCU).
- Tooling: Node 24.12.0, npm 11.14.1, Git Bash 5.2.37, Python 3.14.2, gh 2.96.0.
- The repo uses npm lockfiles, so npm is used here on purpose (explicit instruction for this
  task).
- MCP server to register: `host/mcp-server.js` only. Do not register the codemode/hybrid
  servers.

## Step status

| Step | Status |
|---|---|
| 1. Fork and set up | Done |
| 2. Code audit | Done: [AUDIT.md](AUDIT.md) |
| 3. Dependency audit | Audit done (AUDIT.md section 11). Upgrades pending |
| 4. Fix | Pending decisions below |
| 5. Automated tests | Baseline recorded below |
| 6. Local install | Not started |
| 7. Live testing | Not started |
| 8. Wrap up | Not started |

## Baseline tests (before any change, commit 6a37c29)

- `test/*.test.mjs`: audit-segments 13/13, handlers all pass, humanize-executor all pass,
  humanize-planners all pass.
- `host`: `npm test` (endpoint, parent-watch 3/3, ownership 12/12) all pass.
- `host/codemode/test-*.js` need a live browser. Not run at baseline.

## Corrections to the original brief

- `navigate` does NOT allow `chrome-extension:` URLs. `1a9d2c7` added it, and `a18d096`
  reverted it 12 minutes later. See AUDIT.md section 8.
- CRLF checkout of `install.sh` is fine under Git Bash 5.2.37 (tested). No fix needed.

## Planned changes

No-behavior-change fixes (will just do):
- Dependency upgrades within declared ranges: `@modelcontextprotocol/sdk` 1.29.0 -> 1.32.2,
  `wrangler` 4.94.0 -> 4.157.0, `@cloudflare/codemode` 0.3.7 -> 0.3.8. No majors needed
  (zod 4 and codemode 0.5 bring nothing this project needs).
- M2: fix the `navigate` load-wait race.
- M6: `storage.local.setAccessLevel(TRUSTED_CONTEXTS)` (no content script reads storage).
- L3: unmark the upload target on the early-return path.
- H1: per-process secret on the codemode callback server (only affects codemode/hybrid).

Judgment calls (asked 2026-11-05, answers recorded below):
- M1: wallet / other-extension guard and approval-popup notice.
- M5: `file_upload` path restriction.
- M7: `install.sh` uses `npm ci --ignore-scripts` and makes the codemode worker opt-in.
- M3, M4, L2: audit gate, recorder password masking, stale-group fallback.

## Decisions

(filled in as answers arrive)

## What's left

See step status table.
