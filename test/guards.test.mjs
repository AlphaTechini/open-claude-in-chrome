// Security guards in extension/background.js, run as SHIPPED source against a
// mocked chrome.* API. Each section pins one boundary the extension must not
// cross on an agent's say-so.
import fs from "node:fs";
import path from "node:path";
import { extractFunction, compile, ROOT } from "./_extract.mjs";
import * as approvals from "../extension/approvals.js";
let fail = 0;
const ok = (c, m) => { console.log((c ? "  PASS " : "  FAIL ") + m); if (!c) fail++; };

console.log("== isInGroup: only tabs currently in the MCP group ==");
{
  const tabs = new Map([
    [1, { id: 1, groupId: 55 }],
    [2, { id: 2, groupId: -1 }], // dragged out of the group
    [3, { id: 3, groupId: 77 }]  // some other group of the user's
  ]);
  const chrome = {
    tabs: {
      get: async (id) => { const t = tabs.get(id); if (!t) throw new Error("No tab"); return t; },
      query: async () => []
    },
    tabGroups: { get: async (id) => ({ id, title: id === 55 ? "MCP" : "Mine" }) }
  };
  const box = compile(
    `let tabGroupId = 55; let tabGroupTabs = new Set([1, 2]);\n${extractFunction("isInGroup")}`,
    { chrome },
    "{ isInGroup, set: () => tabGroupTabs }"
  );
  ok(await box.isInGroup(1), "a tab in the MCP group is allowed");
  ok(!(await box.isInGroup(2)), "a tab dragged out of the group is refused, even though the stale set still lists it");
  ok(!box.set().has(2), "and the stale entry is dropped");
  ok(!(await box.isInGroup(3)), "a tab in another group is refused");
  ok(!(await box.isInGroup(9)), "a tab that does not exist is refused");
}

// handleToolRequest + withApprovalNotice as shipped, over a mocked chrome with
// a configurable set of tabs and popup windows.
const SELF_BASE = "chrome-extension://selfselfselfselfselfselfselfself/";
const WALLET = "chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn";
function mkDispatch({ tabs = {}, popups = [] } = {}) {
  const noted = [];
  const sent = [];
  const handled = [];
  const chrome = {
    tabs: {
      get: async (id) => { if (!tabs[id]) throw new Error("No tab with id: " + id); return { id, ...tabs[id] }; }
    },
    windows: {
      getAll: async (q) => (q && q.windowTypes && q.windowTypes.includes("popup") ? popups : [])
    }
  };
  const deps = {
    chrome, approvals, SELF_BASE,
    audit: { isEnabled: () => true, noteAction: async (a) => { noted.push(a); } },
    isInGroup: async (id) => id === 1,
    toolHandlers: {
      navigate: async (a) => { handled.push(a); return { content: [{ type: "text", text: "ok" }] }; },
      computer: async (a) => { handled.push(a); return { content: [{ type: "text", text: "clicked" }] }; },
      boom: async () => { throw new Error("kaput"); }
    },
    recorder: { deliveredIds: new Set() },
    nativePort: null,
    dbg: () => {}, argSummary: () => "", resultShape: () => "", recordTiming: () => {},
    sendResponse: (id, r) => sent.push({ id, r }), sendError: (id, e) => sent.push({ id, e })
  };
  const handleToolRequest = compile(
    `${extractFunction("handleToolRequest")}\n${extractFunction("withApprovalNotice")}`,
    deps,
    "handleToolRequest"
  );
  return { handleToolRequest, noted, sent, handled };
}

console.log("== another extension's page is never driven ==");
{
  const { handleToolRequest, sent, handled } = mkDispatch({
    tabs: {
      1: { url: "https://dapp.test/" },
      5: { url: `${WALLET}/notification.html` },
      6: { url: "about:blank", pendingUrl: `${WALLET}/home.html` },
      7: { url: `${SELF_BASE}recorder/options.html` }
    }
  });
  await handleToolRequest("h1_1", "computer", { tabId: 5, action: "left_click", coordinate: [10, 10] });
  ok(handled.length === 0, "a click aimed at a wallet's page never reaches the handler");
  ok(/^Refused: tab 5 shows another extension's page/.test(sent[0].r.content[0].text), "and the agent is told why, and to ask the user");
  await handleToolRequest("h1_2", "computer", { tabId: 6, action: "screenshot" });
  ok(handled.length === 0 && /Refused/.test(sent[1].r.content[0].text), "a tab still loading a wallet page (pendingUrl) is refused too");
  await handleToolRequest("h1_3", "computer", { tabId: 7, action: "screenshot" });
  ok(handled.length === 1, "this extension's own pages are not caught by the guard");
  await handleToolRequest("h1_4", "computer", { tabId: 1, action: "left_click", coordinate: [10, 10] });
  ok(handled.length === 2 && sent[3].r.content[0].text === "clicked", "an ordinary dapp tab runs normally");
}
{
  ok(approvals.isForeignExtensionUrl(`${WALLET}/popup.html`, SELF_BASE), "isForeignExtensionUrl: another extension");
  ok(approvals.isForeignExtensionUrl(`CHROME-EXTENSION://${WALLET.slice(19)}/x`, SELF_BASE), "isForeignExtensionUrl: scheme is case-insensitive");
  ok(!approvals.isForeignExtensionUrl(`${SELF_BASE}x.html`, SELF_BASE), "isForeignExtensionUrl: our own pages");
  ok(!approvals.isForeignExtensionUrl("https://chrome-extension.test/", SELF_BASE), "isForeignExtensionUrl: an https look-alike");
  ok(!approvals.isForeignExtensionUrl(undefined, SELF_BASE), "isForeignExtensionUrl: no URL");
}

console.log("== navigate refuses extension URLs ==");
{
  const navigateTo = compile(extractFunction("startNavigation"), {
    approvals, chrome: { tabs: { update: async () => { throw new Error("must not navigate"); } } }
  }, "startNavigation");
  let err = null;
  try { await navigateTo(1, `${WALLET}/home.html`); } catch (e) { err = e; }
  ok(err && err.toolText && /^Refused: navigate does not open extension pages/.test(err.message), "chrome-extension:// is refused with a message");
  err = null;
  try { await navigateTo(1, "  Chrome-Extension://abc/x"); } catch (e) { err = e; }
  ok(err && err.toolText, "including with odd case and leading spaces");
}

console.log("== an open wallet popup is announced on every result ==");
{
  const popups = [
    { id: 900, tabs: [{ id: 50, title: "MetaMask", url: `${WALLET}/notification.html#confirm` }] },
    { id: 901, tabs: [{ id: 51, title: "Our own popup", url: `${SELF_BASE}x.html` }] }
  ];
  const { handleToolRequest, sent } = mkDispatch({ tabs: { 1: { url: "https://dapp.test/" } }, popups });
  await handleToolRequest("h1_1", "computer", { tabId: 1, action: "screenshot" });
  const first = sent[0].r.content[0].text;
  ok(/^MANUAL APPROVAL NEEDED/.test(first), "the notice leads the result");
  ok(first.includes("window 900") && first.includes('"MetaMask"') && first.includes("notification.html"), "it names the window, title and URL");
  ok(!first.includes("window 901"), "a popup of this extension is not announced");
  ok(sent[0].r.content[1].text === "clicked", "the tool's own result follows unchanged");
  await handleToolRequest("h1_2", "boom", {});
  ok(/^boom failed: kaput\n\nMANUAL APPROVAL NEEDED/.test(sent[1].e), "errors carry the notice too");
}
{
  const { handleToolRequest, sent } = mkDispatch({ tabs: { 1: { url: "https://dapp.test/" } }, popups: [] });
  await handleToolRequest("h1_1", "computer", { tabId: 1, action: "screenshot" });
  ok(sent[0].r.content.length === 1 && sent[0].r.content[0].text === "clicked", "with no popup open, results are untouched");
}

console.log("== audit_mode: never records a tab outside the MCP group ==");
{
  const { handleToolRequest, noted, sent } = mkDispatch();
  await handleToolRequest("h1_1", "navigate", { tabId: 1, url: "https://a.test" });
  await handleToolRequest("h1_2", "navigate", { tabId: 42, url: "https://a.test" });
  await handleToolRequest("h1_3", "navigate", { url: "https://a.test" });
  ok(noted[0].tabId === 1, "an action on a group tab is audited against that tab");
  ok(noted[1].tabId === undefined, "an action naming a tab outside the group gives the recorder no tab");
  ok(noted[2].tabId === undefined, "an action with no tab gives the recorder no tab");
  ok(noted.length === 3 && sent.length === 3, "every action is still logged and answered");
}

console.log("== recorder: sensitive field values never reach the trace ==");
{
  const CAPTURE = path.join(ROOT, "extension", "recorder", "capture.js");
  const decl = fs.readFileSync(CAPTURE, "utf8").match(/const SENSITIVE_AUTOCOMPLETE = .*;/)[0];
  const isSensitive = compile(`${decl}\n${extractFunction("isSensitive", CAPTURE)}`, {}, "isSensitive");
  const el = (tagName, type, autocomplete) => ({
    tagName, type, getAttribute: (a) => (a === "autocomplete" ? autocomplete ?? null : null)
  });
  ok(isSensitive(el("INPUT", "password")), "type=password is masked");
  ok(isSensitive(el("INPUT", "PASSWORD")), "type matching is case-insensitive");
  ok(isSensitive(el("INPUT", "text", "one-time-code")), "autocomplete=one-time-code is masked");
  ok(isSensitive(el("INPUT", "text", "section-pay cc-number")), "autocomplete=cc-number (with a section token) is masked");
  ok(isSensitive(el("INPUT", "text", "new-password")), "autocomplete=new-password is masked");
  ok(!isSensitive(el("INPUT", "text", "email")), "an ordinary email field is kept");
  ok(!isSensitive(el("TEXTAREA", "textarea")), "an ordinary textarea is kept");
  ok(!isSensitive(el("INPUT", "search", "off")), "autocomplete=off alone does not mask");
}

console.log(fail ? `\n${fail} GUARD TEST(S) FAILED` : "\nALL GUARD TESTS PASSED");
process.exit(fail ? 1 : 0);
