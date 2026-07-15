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
