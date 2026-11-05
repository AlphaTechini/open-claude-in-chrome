// navigate's load wait, run against the SHIPPED handler with a mocked chrome.*.
// The bug this pins: the onUpdated listener used to be added only after the
// navigation call resolved, so a page that finished first (bfcache back, a
// cached page) or a same-document change that never emits "complete" made
// navigate sit out its full 10s timeout.
import { extractMethod, extractFunction, compile } from "./_extract.mjs";
import * as approvals from "../extension/approvals.js";
let fail = 0;
const ok = (c, m) => { console.log((c ? "  PASS " : "  FAIL ") + m); if (!c) fail++; };

function mkChrome(tab, onNavigate) {
  const listeners = new Set();
  const fire = (info) => { for (const l of [...listeners]) l(tab.id, info); };
  const nav = async (url) => onNavigate({ tab, fire, url });
  return {
    listeners,
    tabs: {
      get: async (id) => ({ ...tab, id }),
      query: async () => [tab],
      update: async (id, o) => nav(o.url),
      goBack: async () => nav("back"),
      goForward: async () => nav("forward"),
      onUpdated: {
        addListener: (l) => listeners.add(l),
        removeListener: (l) => listeners.delete(l)
      }
    }
  };
}

function build(chrome) {
  return compile(
    [extractFunction("startNavigation"), `const H = { ${extractMethod("navigate")} };`].join("\n\n"),
    { chrome, approvals, isInGroup: async () => true, tabGroupId: 55 },
    "H"
  );
}

async function timed(fn) {
  const t0 = Date.now();
  const out = await fn();
  return { out, ms: Date.now() - t0 };
}

console.log("== navigate: load wait ==");

{
  // bfcache-style back: the page is complete before goBack() resolves.
  const tab = { id: 1, url: "https://a.test/2", status: "complete" };
  const chrome = mkChrome(tab, ({ tab, fire }) => {
    tab.status = "loading"; fire({ status: "loading" });
    tab.url = "https://a.test/1"; tab.status = "complete"; fire({ status: "complete" });
  });
  const { out, ms } = await timed(() => build(chrome).navigate({ tabId: 1, url: "back" }));
  ok(ms < 1500, `a load that completes before goBack() resolves returns promptly (${ms}ms)`);
  ok(/Navigated to https:\/\/a\.test\/1\./.test(out.content[0].text), "reports the new URL, not still loading");
  ok(chrome.listeners.size === 0, "the onUpdated listener is removed");
}

{
  // Same-document change: URL moves, status never leaves "complete", no event.
  const tab = { id: 2, url: "https://a.test/page", status: "complete" };
  const chrome = mkChrome(tab, ({ tab }) => { tab.url = "https://a.test/page#section"; });
  const { ms } = await timed(() => build(chrome).navigate({ tabId: 2, url: "https://a.test/page#section" }));
  ok(ms < 1500, `a same-document navigation with no "complete" event returns promptly (${ms}ms)`);
  ok(chrome.listeners.size === 0, "the onUpdated listener is removed");
}

{
  // Ordinary load: still waits for its "complete" event rather than returning
  // on the stale status of the page it is leaving.
  const tab = { id: 3, url: "https://a.test/old", status: "complete" };
  let finish;
  const chrome = mkChrome(tab, ({ tab, fire }) => {
    tab.status = "loading"; tab.url = "https://b.test/"; fire({ status: "loading" });
    finish = () => { tab.status = "complete"; fire({ status: "complete" }); };
  });
  const p = build(chrome).navigate({ tabId: 3, url: "b.test" });
  let settled = false;
  p.then(() => { settled = true; });
  await new Promise((r) => setTimeout(r, 300));
  ok(!settled, "an in-flight load is waited for");
  finish();
  const out = await p;
  ok(/Navigated to https:\/\/b\.test\/\./.test(out.content[0].text), "returns once the load completes, with https:// added");
  ok(chrome.listeners.size === 0, "the onUpdated listener is removed");
}

{
  const tab = { id: 4, url: "https://a.test/", status: "complete" };
  const chrome = mkChrome(tab, () => {});
  const out = await build(chrome).navigate({ tabId: 4, url: "https://exa mple.com:bad/" });
  ok(/^Invalid URL/.test(out.content[0].text), "an unparseable URL still returns the Invalid URL message");
  ok(chrome.listeners.size === 0, "and leaves no listener behind");
}

console.log(fail ? `\n${fail} NAVIGATE TEST(S) FAILED` : "\nALL NAVIGATE TESTS PASSED");
process.exit(fail ? 1 : 0);
