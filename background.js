const WRITER_URL = "saver.html";

function waitForWriterReady(tabId, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.runtime.onMessage.removeListener(listener);
      reject(new Error("Writer tab did not become ready in time"));
    }, timeoutMs);
    function listener(msg, sender) {
      if (msg && msg.type === "vidsave-writer-ready" && sender.tab && sender.tab.id === tabId) {
        clearTimeout(timer);
        chrome.runtime.onMessage.removeListener(listener);
        resolve();
      }
    }
    chrome.runtime.onMessage.addListener(listener);
  });
}

chrome.runtime.onConnect.addListener(async (contentPort) => {
  if (contentPort.name !== "vidsave-save") return;
  console.log("[VidSave/bg] save requested, opening writer tab");

  let writerTab;
  try {
    writerTab = await chrome.tabs.create({
      url: chrome.runtime.getURL(WRITER_URL),
      active: false,
    });
    await waitForWriterReady(writerTab.id);
  } catch (e) {
    console.warn("[VidSave/bg] writer tab failed to start", e);
    contentPort.postMessage({ type: "error", message: "Could not start writer: " + e.message });
    if (writerTab) chrome.tabs.remove(writerTab.id).catch(() => {});
    contentPort.disconnect();
    return;
  }

  console.log("[VidSave/bg] writer tab ready, relaying", writerTab.id);
  const writerPort = chrome.tabs.connect(writerTab.id, { name: "vidsave-writer" });

  const closeWriterTab = () => {
    chrome.tabs.remove(writerTab.id).catch(() => {});
  };

  writerPort.onMessage.addListener((msg) => {
    try {
      contentPort.postMessage(msg);
    } catch (e) {
      // content port may already be gone
    }
    if (msg.type === "done" || msg.type === "error") closeWriterTab();
  });
  contentPort.onMessage.addListener((msg) => {
    try {
      writerPort.postMessage(msg);
    } catch (e) {
      // writer port may already be gone
    }
  });

  const cleanup = () => {
    try { writerPort.disconnect(); } catch (e) {}
    closeWriterTab();
  };
  contentPort.onDisconnect.addListener(cleanup);
  writerPort.onDisconnect.addListener(() => {
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
