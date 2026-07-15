const OFFSCREEN_URL = "saver.html";
let creatingOffscreen;

async function ensureOffscreenDocument() {
  const has = await chrome.offscreen.hasDocument?.();
  if (has) return;

  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }

  creatingOffscreen = chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ["BLOBS"],
    justification: "Write saved video files to the user's chosen folder via the File System Access API.",
  });
  await creatingOffscreen;
  creatingOffscreen = null;
}

chrome.runtime.onConnect.addListener(async (contentPort) => {
  if (contentPort.name !== "vidsave-save") return;

  try {
    await ensureOffscreenDocument();
  } catch (e) {
    contentPort.postMessage({ type: "error", message: "Could not start writer: " + e.message });
    contentPort.disconnect();
    return;
  }

  const offscreenPort = chrome.runtime.connect({ name: "vidsave-offscreen" });

  offscreenPort.onMessage.addListener((msg) => {
    try {
      contentPort.postMessage(msg);
    } catch (e) {
      // content port may already be gone
    }
  });
  contentPort.onMessage.addListener((msg) => {
    try {
      offscreenPort.postMessage(msg);
    } catch (e) {
      // offscreen port may already be gone
    }
  });

  const cleanup = () => {
    try { offscreenPort.disconnect(); } catch (e) {}
  };
  contentPort.onDisconnect.addListener(cleanup);
  offscreenPort.onDisconnect.addListener(() => {
    try { contentPort.disconnect(); } catch (e) {}
  });
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.runtime.openOptionsPage();
  }
});

// Background fetch bypasses page-level CORS/tainting restrictions that
// block content-script fetch() and <video>.captureStream() on
// cross-origin media without permissive CORS headers. Streamed back over
// a port in chunks so large videos don't hit message-size limits.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "vidsave-bg-fetch") return;

  port.onMessage.addListener(async (msg) => {
    if (msg.type !== "fetch") return;
    console.log("[VidSave/bg] fetching", msg.url);
    try {
      const res = await fetch(msg.url, { credentials: "omit" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const buf = await res.arrayBuffer();
      const contentType = res.headers.get("content-type") || "";
      const CHUNK = 4 * 1024 * 1024;
      port.postMessage({ type: "meta", contentType, totalSize: buf.byteLength });
      for (let offset = 0; offset < buf.byteLength; offset += CHUNK) {
        const slice = buf.slice(offset, offset + CHUNK);
        port.postMessage({ type: "chunk", data: Array.from(new Uint8Array(slice)) });
      }
      port.postMessage({ type: "done" });
    } catch (e) {
      console.warn("[VidSave/bg] fetch failed", e);
      port.postMessage({ type: "error", message: e.message || String(e) });
    }
  });
});
