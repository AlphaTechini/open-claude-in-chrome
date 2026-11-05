#!/usr/bin/env node
//
// file_upload may only read from the user's upload folder. These checks build a
// scratch folder layout and pin that every way out of it is refused: an
// outside file, `..` traversal, a sibling folder sharing the name prefix, a
// symlink pointing out, a relative path, and a directory.
//
// Run: node host/test/upload-guard.test.mjs

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ocic-upload-test-"));
const allowed = path.join(root, "uploads");
const sibling = path.join(root, "uploads-evil");
fs.mkdirSync(path.join(allowed, "nested"), { recursive: true });
fs.mkdirSync(sibling);
fs.writeFileSync(path.join(allowed, "ok.png"), "x");
fs.writeFileSync(path.join(allowed, "nested", "deep.pdf"), "x");
fs.writeFileSync(path.join(root, "secret.key"), "x");
fs.writeFileSync(path.join(sibling, "x.png"), "x");

process.env.OCIC_UPLOAD_DIR = allowed;
const { checkUploadPaths, uploadDir } = await import("../upload-guard.js");

const results = [];
function check(name, fn) {
  try {
    fn();
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
const refused = (paths) => {
  const r = checkUploadPaths(paths);
  assert(!r.ok, `expected refusal for ${JSON.stringify(paths)}`);
  return r.error;
};

console.log("\nfile_upload folder guard\n");

check("OCIC_UPLOAD_DIR picks the folder", () => {
  assert(uploadDir() === path.resolve(allowed), uploadDir());
});

check("files inside the folder, nested too, are accepted and resolved", () => {
  const r = checkUploadPaths([path.join(allowed, "ok.png"), path.join(allowed, "nested", "deep.pdf")]);
  assert(r.ok, r.error);
  assert(r.paths.length === 2 && r.paths.every((p) => path.isAbsolute(p)), JSON.stringify(r.paths));
});

check("a file outside the folder is refused", () => {
  assert(/outside the upload folder/.test(refused([path.join(root, "secret.key")])), "wrong message");
});

check("`..` traversal out of the folder is refused", () => {
  refused([path.join(allowed, "..", "secret.key")]);
});

check("a sibling folder sharing the name prefix is refused", () => {
  refused([path.join(sibling, "x.png")]);
});

check("one bad path refuses the whole call", () => {
  refused([path.join(allowed, "ok.png"), path.join(root, "secret.key")]);
});

check("a relative path is refused", () => {
  assert(/absolute/.test(refused(["ok.png"])), "wrong message");
});

check("a missing file is refused", () => {
  assert(/not found/.test(refused([path.join(allowed, "nope.png")])), "wrong message");
});

check("a directory is refused", () => {
  assert(/Not a file/.test(refused([path.join(allowed, "nested")])), "wrong message");
});

check("non-array input yields no paths, which the extension then rejects", () => {
  const r = checkUploadPaths(undefined);
  assert(r.ok && r.paths.length === 0, "expected an empty list for the extension to reject");
});

// Symlinks need elevation or developer mode on Windows; test them where the
// OS allows it and say so where it does not.
let linked = false;
try {
  fs.symlinkSync(path.join(root, "secret.key"), path.join(allowed, "link.key"), "file");
  linked = true;
} catch {}
if (linked) {
  check("a symlink inside the folder pointing out of it is refused", () => {
    refused([path.join(allowed, "link.key")]);
  });
} else {
  console.log("  SKIP  symlink escape (this OS refused to create a symlink without elevation)");
}

check("a missing upload folder is reported, not treated as open", () => {
  process.env.OCIC_UPLOAD_DIR = path.join(root, "does-not-exist");
  assert(/does not exist/.test(refused([path.join(allowed, "ok.png")])), "wrong message");
  process.env.OCIC_UPLOAD_DIR = allowed;
});

fs.rmSync(root, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
console.log(
  `\n${results.length - failed.length}/${results.length} passed` +
    (failed.length ? `\n\nFailures:\n${failed.map((f) => `  - ${f.name}: ${f.err}`).join("\n")}` : "") +
    "\n"
);
process.exit(failed.length ? 1 : 0);
