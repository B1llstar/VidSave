const DEFAULT_SUBFOLDER = "VidSave";

function getSubfolder() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ subfolder: DEFAULT_SUBFOLDER }, (items) => {
      resolve(items.subfolder || DEFAULT_SUBFOLDER);
    });
  });
}

chrome.runtime.onConnect.addListener((contentPort) => {
  if (contentPort.name !== "vidsave-save") return;

  const chunks = [];
  let filename = "";
  let mime = "video/mp4";

  contentPort.onMessage.addListener(async (msg) => {
    if (msg.type === "begin") {
      filename = msg.filename;
      mime = msg.mime || "video/mp4";
      chunks.length = 0;
      contentPort.postMessage({ type: "ready-for-chunk" });
    } else if (msg.type === "chunk") {
      chunks.push(new Uint8Array(msg.data));
      contentPort.postMessage({ type: "ready-for-chunk" });
    } else if (msg.type === "end") {
      let objectUrl;
      try {
        const blob = new Blob(chunks, { type: mime });
        objectUrl = URL.createObjectURL(blob);
        const subfolder = await getSubfolder();
        const downloadId = await chrome.downloads.download({
          url: objectUrl,
          filename: `${subfolder}/${filename}`,
          saveAs: false,
          conflictAction: "uniquify",
        });

        const pollTimer = setInterval(async () => {
          const [item] = await chrome.downloads.search({ id: downloadId });
          if (item && item.totalBytes > 0) {
            contentPort.postMessage({
              type: "progress",
              percent: Math.min(100, Math.round((item.bytesReceived / item.totalBytes) * 100)),
            });
          }
        }, 200);

        const onChanged = (delta) => {
          if (delta.id !== downloadId) return;
          if (delta.state && delta.state.current === "complete") {
            clearInterval(pollTimer);
            chrome.downloads.onChanged.removeListener(onChanged);
            URL.revokeObjectURL(objectUrl);
            contentPort.postMessage({ type: "done" });
          } else if (delta.state && delta.state.current === "interrupted") {
            clearInterval(pollTimer);
            chrome.downloads.onChanged.removeListener(onChanged);
            URL.revokeObjectURL(objectUrl);
            contentPort.postMessage({ type: "error", message: "Download was interrupted" });
          }
        };
        chrome.downloads.onChanged.addListener(onChanged);
      } catch (e) {
        console.warn("[VidSave/bg] download failed", e);
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        contentPort.postMessage({ type: "error", message: e.message || String(e) });
      }
    }
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
