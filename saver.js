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

async function writeFile(filename, chunks) {
  const dirHandle = await getSavedDirectoryHandle();
  if (!dirHandle) {
    throw new Error("No save folder set. Open VidSave options and choose a folder.");
  }

  const perm = await dirHandle.queryPermission({ mode: "readwrite" });
  if (perm !== "granted") {
    throw new Error("Folder permission was revoked. Reopen VidSave options and reselect the folder.");
  }

  const uniqueName = await ensureUniqueName(dirHandle, filename);
  const fileHandle = await dirHandle.getFileHandle(uniqueName, { create: true });
  const writable = await fileHandle.createWritable();

  for (const chunk of chunks) {
    await writable.write(chunk);
  }
  await writable.close();
  return uniqueName;
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "vidsave-offscreen") return;

  let filename = null;
  let mime = "video/mp4";
  const chunks = [];

  port.onMessage.addListener(async (msg) => {
    try {
      if (msg.type === "begin") {
        filename = msg.filename;
        mime = msg.mime;
        chunks.length = 0;
        port.postMessage({ type: "ready-for-chunk" });
      } else if (msg.type === "chunk") {
        chunks.push(new Uint8Array(msg.data));
        port.postMessage({ type: "ready-for-chunk" });
      } else if (msg.type === "end") {
        const savedName = await writeFile(filename, chunks);
        port.postMessage({ type: "done", filename: savedName });
      }
    } catch (e) {
      port.postMessage({ type: "error", message: e.message || String(e) });
    }
  });
});
