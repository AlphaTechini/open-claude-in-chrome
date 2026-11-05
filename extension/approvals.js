// Other extensions' pages are off limits to automation, and their popups are
// the user's to answer.
//
// Chrome already refuses chrome.debugger and chrome.scripting on another
// extension's chrome-extension:// page, so no click can land inside a wallet's
// approval window. What it does not do is tell anyone the window is there: the
// popup opens in its own window, outside the MCP group, where screenshots and
// read_page never look. So the agent keeps working while a signature request
// sits unanswered. This module closes both halves: an explicit refusal with a
// message the agent can act on, and a notice on every tool result while such a
// popup is open, so the agent stops and asks the user.

/** True for a chrome-extension:// URL that is not this extension's own. */
export function isForeignExtensionUrl(url, selfBase) {
  if (typeof url !== "string" || !/^chrome-extension:\/\//i.test(url)) return false;
  return !url.toLowerCase().startsWith(String(selfBase).toLowerCase());
}

/**
 * Refusal text when a tool targets a tab showing another extension's page,
 * or null when the tab is fair game.
 */
export function foreignTabRefusal(tab, selfBase) {
  if (!tab) return null;
  const url = [tab.url, tab.pendingUrl].find((u) => isForeignExtensionUrl(u, selfBase));
  if (!url) return null;
  return (
    `Refused: tab ${tab.id} shows another extension's page (${url}). ` +
    `Wallet and extension approvals are manual by design. Stop, ask the user to handle that ` +
    `window themselves, wait for them to say they are done, then continue on the original tab.`
  );
}

/** Refusal text for navigate to an extension URL, or null. */
export function extensionNavigateRefusal(url) {
  if (typeof url !== "string" || !/^chrome-extension:/i.test(url.trim())) return null;
  return (
    `Refused: navigate does not open extension pages (${url}). ` +
    `Wallet and extension windows are for the user to operate.`
  );
}

/**
 * A notice listing open popup windows that show another extension's page
 * (wallet approvals, signature requests), or "" when there are none.
 * Popup-type windows only: an extension page the user keeps open in a normal
 * tab is not waiting on anyone, and flagging it on every call would be noise.
 */
export async function approvalNotice(chromeApi, selfBase) {
  let windows;
  try {
    windows = await chromeApi.windows.getAll({ populate: true, windowTypes: ["popup"] });
  } catch {
    return "";
  }
  const open = [];
  for (const w of windows || []) {
    for (const t of w.tabs || []) {
      const url = [t.url, t.pendingUrl].find((u) => isForeignExtensionUrl(u, selfBase));
      if (url) open.push({ windowId: w.id, title: t.title || "", url });
    }
  }
  if (!open.length) return "";
  const list = open
    .map((p) => `  - window ${p.windowId}: ${p.title ? `"${p.title}" ` : ""}${p.url}`)
    .join("\n");
  return (
    `MANUAL APPROVAL NEEDED: another extension has a popup open, most likely a wallet ` +
    `asking the user to approve or sign something:\n${list}\n` +
    `Do not try to click, type into, or screenshot it; automation cannot reach it. Stop and ` +
    `tell the user exactly what is waiting for them, wait until they say "done", then ` +
    `continue and check that the page picked up the result.`
  );
}
