const OFFSCREEN_URL = "saver.html";
let creatingOffscreen;

function waitForOffscreenReady(timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      reject(new Error("Writer did not become ready in time"));
    }, timeoutMs);
    function listener(msg) {
      if (msg && msg.type === "vidsave-offscreen-ready") {
        clearTimeout(timer);
        chrome.runtime.onMessage.removeListener(listener);
        resolve();
      }
    }
    chrome.runtime.onMessage.addListener(listener);
  });
}

async function ensureOffscreenDocument() {
  const has = await chrome.offscreen.hasDocument?.();
  if (has) return;

  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }

  creatingOffscreen = (async () => {
    const readyPromise = waitForOffscreenReady();
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: ["BLOBS"],
      justification: "Write saved video files to the user's chosen folder via the File System Access API.",
    });
    await readyPromise;
  })();
  await creatingOffscreen;
  creatingOffscreen = null;
}

chrome.runtime.onConnect.addListener(async (contentPort) => {
  if (contentPort.name !== "vidsave-save") return;
  console.log("[VidSave/bg] save requested, ensuring offscreen writer");

  try {
    await ensureOffscreenDocument();
  } catch (e) {
    console.warn("[VidSave/bg] offscreen writer failed to start", e);
    contentPort.postMessage({ type: "error", message: "Could not start writer: " + e.message });
    contentPort.disconnect();
    return;
  }

  console.log("[VidSave/bg] offscreen writer ready, relaying");
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
      const contentType = res.headers.get("content-type") || "";
      const totalSize = Number(res.headers.get("content-length")) || 0;
      port.postMessage({ type: "meta", contentType, totalSize });

      const reader = res.body.getReader();
      let received = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        port.postMessage({
          type: "chunk",
          data: Array.from(value),
          received,
          totalSize,
        });
      }
      port.postMessage({ type: "done" });
    } catch (e) {
      console.warn("[VidSave/bg] fetch failed", e);
      port.postMessage({ type: "error", message: e.message || String(e) });
    }
  });
});
