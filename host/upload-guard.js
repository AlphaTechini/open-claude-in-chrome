// Where file_upload is allowed to read from.
//
// file_upload hands real paths straight to DOM.setFileInputFiles, so without a
// boundary a prompt injection on any page could ask the agent to attach an SSH
// key or a wallet keystore to a form on someone else's site. The check lives
// here, in the host, because the extension cannot see the filesystem, and every
// server variant reaches the browser through tool-runtime's callTool.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { configFile } from "./endpoint.js";

export function uploadDir() {
  return path.resolve(
    process.env.OCIC_UPLOAD_DIR ||
      configFile().uploadDir ||
      path.join(os.homedir(), "Downloads", "ocic-uploads")
  );
}

const normalizeCase = (p) => (process.platform === "win32" ? p.toLowerCase() : p);

/**
 * Resolve every requested path and confirm it is a file inside the upload dir.
 * realpath runs first so `..` segments and symlinks cannot walk out of it.
 * Returns { ok: true, paths } with the resolved paths, or { ok: false, error }.
 */
export function checkUploadPaths(paths) {
  const dir = uploadDir();
  let realDir;
  try {
    realDir = fs.realpathSync(dir);
  } catch {
    return {
      ok: false,
      error:
        `file_upload only accepts files inside ${dir}, which does not exist yet. ` +
        `Ask the user to create it and put the file there.`
    };
  }
  const prefix = normalizeCase(realDir.endsWith(path.sep) ? realDir : realDir + path.sep);
  const resolved = [];
  for (const p of Array.isArray(paths) ? paths : []) {
    if (typeof p !== "string" || !path.isAbsolute(p)) {
      return { ok: false, error: `file_upload needs absolute paths; got ${JSON.stringify(p)}.` };
    }
    let real;
    try {
      real = fs.realpathSync(p);
    } catch {
      return { ok: false, error: `File not found: ${p}` };
    }
    if (!normalizeCase(real).startsWith(prefix)) {
      return {
        ok: false,
        error:
          `Refused: ${p} is outside the upload folder ${realDir}. ` +
          `Only files the user has put in that folder can be uploaded. Ask the user to copy it there if it is really needed.`
      };
    }
    if (!fs.statSync(real).isFile()) {
      return { ok: false, error: `Not a file: ${p}` };
    }
    resolved.push(real);
  }
  return { ok: true, paths: resolved };
}
