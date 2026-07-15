async function ensureUniqueName(dirHandle, filename) {
  const dot = filename.lastIndexOf(".");
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : "";

  let candidate = filename;
  let n = 1;
  while (true) {
    try {
      await dirHandle.getFileHandle(candidate, { create: false });
      candidate = `${base} (${n})${ext}`;
      n++;
    } catch (e) {
      return candidate;
    }
  }
}

async function openWritable(filename) {
  const dirHandle = await getSavedDirectoryHandle();
  if (!dirHandle) {
    throw new Error("No save folder set. Open VidSave options and choose a folder.");
  }

  let perm = await dirHandle.queryPermission({ mode: "readwrite" });
  if (perm !== "granted") {
    perm = await dirHandle.requestPermission({ mode: "readwrite" });
  }
  if (perm !== "granted") {
    throw new Error("Folder permission was revoked. Reopen VidSave options and reselect the folder.");
  }

  const uniqueName = await ensureUniqueName(dirHandle, filename);
  const fileHandle = await dirHandle.getFileHandle(uniqueName, { create: true });
  const writable = await fileHandle.createWritable();
  return { writable, uniqueName };
}

chrome.runtime.sendMessage({ type: "vidsave-writer-ready" });

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "vidsave-writer") return;

  let writable = null;
  let uniqueName = null;
  let totalSize = 0;
  let written = 0;

  port.onMessage.addListener(async (msg) => {
    try {
      if (msg.type === "begin") {
        totalSize = msg.totalSize || 0;
        written = 0;
        ({ writable, uniqueName } = await openWritable(msg.filename));
        port.postMessage({ type: "ready-for-chunk" });
      } else if (msg.type === "chunk") {
        const bytes = new Uint8Array(msg.data);
        await writable.write(bytes);
        written += bytes.byteLength;
        port.postMessage({
          type: "progress",
          written,
          totalSize,
          percent: totalSize ? Math.min(100, Math.round((written / totalSize) * 100)) : null,
        });
        port.postMessage({ type: "ready-for-chunk" });
      } else if (msg.type === "end") {
        await writable.close();
        port.postMessage({ type: "done", filename: uniqueName });
      }
    } catch (e) {
      port.postMessage({ type: "error", message: e.message || String(e) });
    }
  });
});
