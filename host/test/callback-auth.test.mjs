#!/usr/bin/env node
//
// The codemode callback server runs browser tools for whoever POSTs to it, on a
// loopback port any local user (and, via simple requests, any web page) can
// reach. These checks pin the per-process secret: only the URL handed to the
// worker reaches a tool, and every other shape is a bare 404.
//
// Run: node host/test/callback-auth.test.mjs

import { startCallbackServer } from "../codemode/common.js";

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  PASS  ${name}`);
  } catch (err) {
    results.push({ name, ok: false, err: err.message });
    console.log(`  FAIL  ${name} — ${err.message}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const calls = [];
const upstream = {
  async callTool(req) {
    calls.push(req);
    return { content: [{ type: "text", text: "ran " + req.name }] };
  }
};

console.log("\nCodemode callback server auth\n");

const { server, port, url } = await startCallbackServer(upstream);
const post = (u, body = "{}", headers = { "content-type": "application/json" }) =>
  fetch(u, { method: "POST", headers, body });

await check("the handed-out URL carries a long secret, not just the port", () => {
  const secret = new URL(url).pathname.slice(1);
  assert(secret.length >= 32, `secret too short: "${secret}"`);
  assert(new URL(url).port === String(port), "url does not point at the server's port");
});

await check("the real callback URL runs the tool", async () => {
  const res = await post(`${url}/tool/navigate`, JSON.stringify({ tabId: 1, url: "x" }));
  assert(res.status === 200, `status ${res.status}`);
  assert(calls.length === 1 && calls[0].name === "navigate", "tool was not called");
});

await check("the old secret-less path is refused", async () => {
  const before = calls.length;
  const res = await post(`http://127.0.0.1:${port}/tool/javascript_tool`, '{"text":"1"}');
  assert(res.status === 404, `status ${res.status}`);
  assert(calls.length === before, "tool ran without the secret");
});

await check("a wrong secret of the same length is refused", async () => {
  const before = calls.length;
  const secret = new URL(url).pathname.slice(1);
  const wrong = secret.replace(/./g, (c) => (c === "a" ? "b" : "a"));
  const res = await post(`http://127.0.0.1:${port}/${wrong}/tool/javascript_tool`);
  assert(res.status === 404, `status ${res.status}`);
  assert(calls.length === before, "tool ran with a wrong secret");
});

await check("a text/plain simple request without the secret is refused", async () => {
  const before = calls.length;
  const res = await post(`http://127.0.0.1:${port}/tool/navigate`, '{"tabId":1}', {
    "content-type": "text/plain"
  });
  assert(res.status === 404, `status ${res.status}`);
  assert(calls.length === before, "tool ran from a simple request");
});

await check("GET on the real URL is refused", async () => {
  const res = await fetch(`${url}/tool/navigate`);
  assert(res.status === 404, `status ${res.status}`);
});

server.closeAllConnections();
await new Promise((resolve) => server.close(resolve));

const failed = results.filter((r) => !r.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} passed` +
    (failed.length ? `\n\nFailures:\n${failed.map((f) => `  - ${f.name}: ${f.err}`).join("\n")}` : "") +
    "\n"
);
// exitCode rather than exit(): exiting while fetch's keep-alive sockets are
// still closing trips a libuv assertion on Windows.
process.exitCode = failed.length ? 1 : 0;
