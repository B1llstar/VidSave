const DEFAULT_SUBFOLDER = "VidSave";

// Service workers in some Brave/Chromium builds don't expose
// URL.createObjectURL, so build a data: URL instead. Encode in
// 3-byte-aligned pieces so each piece's base64 output can be concatenated
// directly, keeping only one small binary string in memory at a time
// instead of the whole file (String.fromCharCode(...bigArray) would also
// overflow the call stack for large inputs).
async function bytesToDataUrl(chunks, mime) {
  const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let off = 0;
  for (const chunk of chunks) {
    all.set(chunk, off);
    off += chunk.length;
  }

  let base64 = "";
  const SUB_CHUNK = 3 * 20000; // multiple of 3 so each piece is byte-aligned
  for (let i = 0; i < all.length; i += SUB_CHUNK) {
    const sub = all.subarray(i, i + SUB_CHUNK);
    let bin = "";
    for (let j = 0; j < sub.length; j++) bin += String.fromCharCode(sub[j]);
    base64 += btoa(bin);
  }
  return `data:${mime};base64,${base64}`;
}

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
      try {
        const dataUrl = await bytesToDataUrl(chunks, mime);
        const subfolder = await getSubfolder();
        const downloadId = await chrome.downloads.download({
          url: dataUrl,
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
            contentPort.postMessage({ type: "done" });
          } else if (delta.state && delta.state.current === "interrupted") {
            clearInterval(pollTimer);
            chrome.downloads.onChanged.removeListener(onChanged);
            contentPort.postMessage({ type: "error", message: "Download was interrupted" });
          }
        };
        chrome.downloads.onChanged.addListener(onChanged);
      } catch (e) {
        console.warn("[VidSave/bg] download failed", e);
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
