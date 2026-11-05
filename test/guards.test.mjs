// Security guards in extension/background.js, run as SHIPPED source against a
// mocked chrome.* API. Each section pins one boundary the extension must not
// cross on an agent's say-so.
import { extractFunction, compile } from "./_extract.mjs";
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

console.log("== audit_mode: never records a tab outside the MCP group ==");
{
  const noted = [];
  const sent = [];
  const deps = {
    audit: { isEnabled: () => true, noteAction: async (a) => { noted.push(a); } },
    isInGroup: async (id) => id === 1,
    toolHandlers: { navigate: async () => ({ content: [{ type: "text", text: "ok" }] }) },
    recorder: { deliveredIds: new Set() },
    nativePort: null,
    dbg: () => {}, argSummary: () => "", resultShape: () => "", recordTiming: () => {},
    sendResponse: (id, r) => sent.push({ id, r }), sendError: (id, e) => sent.push({ id, e })
  };
  const handleToolRequest = compile(extractFunction("handleToolRequest"), deps, "handleToolRequest");
  await handleToolRequest("h1_1", "navigate", { tabId: 1, url: "https://a.test" });
  await handleToolRequest("h1_2", "navigate", { tabId: 42, url: "https://a.test" });
  await handleToolRequest("h1_3", "navigate", { url: "https://a.test" });
  ok(noted[0].tabId === 1, "an action on a group tab is audited against that tab");
  ok(noted[1].tabId === undefined, "an action naming a tab outside the group gives the recorder no tab");
  ok(noted[2].tabId === undefined, "an action with no tab gives the recorder no tab");
  ok(noted.length === 3 && sent.length === 3, "every action is still logged and answered");
}

console.log(fail ? `\n${fail} GUARD TEST(S) FAILED` : "\nALL GUARD TESTS PASSED");
process.exit(fail ? 1 : 0);
