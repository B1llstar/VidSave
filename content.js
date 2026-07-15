(() => {
  const PROCESSED = new WeakSet();
  const BUTTON_MAP = new WeakMap();

  function sanitizeFilename(name) {
    return name.replace(/[\\/:*?"<>|]+/g, "_").trim().slice(0, 120) || "video";
  }

  function guessExtension(url, blob) {
    if (blob && blob.type) {
      const m = /video\/([a-z0-9]+)/i.exec(blob.type);
      if (m) return m[1] === "quicktime" ? "mov" : m[1];
    }
    try {
      const u = new URL(url, location.href);
      const path = u.pathname;
      const m = /\.([a-z0-9]{2,4})$/i.exec(path);
      if (m) return m[1];
    } catch (e) {}
    return "mp4";
  }

  function makeFilename(video, blob, sourceUrl) {
    const title = sanitizeFilename(document.title || "video");
    const ext = guessExtension(sourceUrl, blob);
    return `${title}.${ext}`;
  }

  function setButtonState(btn, state, text) {
    btn.dataset.state = state;
    btn.textContent = text;
  }

  async function fetchAsBlob(url) {
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.blob();
  }

  function fetchViaBackground(url) {
    return new Promise((resolve, reject) => {
      const port = chrome.runtime.connect({ name: "vidsave-bg-fetch" });
      const chunks = [];
      let contentType = "";

      port.onMessage.addListener((msg) => {
        if (msg.type === "meta") {
          contentType = msg.contentType;
        } else if (msg.type === "chunk") {
          chunks.push(new Uint8Array(msg.data));
        } else if (msg.type === "done") {
          port.disconnect();
          resolve(new Blob(chunks, { type: contentType || "video/mp4" }));
        } else if (msg.type === "error") {
          port.disconnect();
          reject(new Error(msg.message));
        }
      });
      port.onDisconnect.addListener(() => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      });

      port.postMessage({ type: "fetch", url });
    });
  }

  function recordViaCapture(video, maxMs = 60000) {
    return new Promise((resolve, reject) => {
      let stream;
      try {
        stream = video.captureStream ? video.captureStream() : video.mozCaptureStream();
      } catch (e) {
        return reject(e);
      }
      if (!stream) return reject(new Error("captureStream unsupported"));

      const mimeCandidates = [
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm",
      ];
      const mime = mimeCandidates.find(
        (m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)
      );
      if (!mime) return reject(new Error("No supported recording format"));

      const chunks = [];
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size) chunks.push(e.data);
      };
      recorder.onerror = (e) => reject(e.error || new Error("MediaRecorder error"));
      recorder.onstop = () => resolve(new Blob(chunks, { type: mime }));

      const wasPaused = video.paused;
      const startedAt = video.currentTime;
      const onEnded = () => finish();
      const onTimeout = setTimeout(finish, maxMs);

      function finish() {
        clearTimeout(onTimeout);
        video.removeEventListener("ended", onEnded);
        if (recorder.state !== "inactive") recorder.stop();
        if (wasPaused) video.pause();
      }

      video.addEventListener("ended", onEnded);
      recorder.start(500);
      if (wasPaused) {
        video.currentTime = 0;
        video.play().catch(() => {});
      }
    });
  }

  async function obtainVideoBlob(video, btn) {
    const src = video.currentSrc || video.src;

    if (src && !src.startsWith("blob:")) {
      // Background fetch runs in a privileged, DOM-less context, so it is
      // not subject to the page's CORS/tainting rules that block a
      // content-script fetch() or captureStream() on cross-origin media.
      try {
        setButtonState(btn, "busy", "⏳ Fetching…");
        const blob = await fetchViaBackground(src);
        if (blob.size > 0) return { blob, sourceUrl: src };
      } catch (e) {
        // fall through
      }
      try {
        const blob = await fetchAsBlob(src);
        if (blob.size > 0) return { blob, sourceUrl: src };
      } catch (e) {
        // fall through to blob/record strategies
      }
    }

    if (src && src.startsWith("blob:")) {
      try {
        setButtonState(btn, "busy", "⏳ Fetching…");
        const blob = await fetchAsBlob(src);
        if (blob.size > 0) return { blob, sourceUrl: src };
      } catch (e) {
        // MSE-backed blob URLs often can't be fetched whole; fall through.
      }
    }

    setButtonState(btn, "busy", "⏺ Recording…");
    const blob = await recordViaCapture(video);
    return { blob, sourceUrl: src || location.href };
  }

  async function sendBlobToSaver(blob, filename) {
    const buf = await blob.arrayBuffer();
    return new Promise((resolve, reject) => {
      const port = chrome.runtime.connect({ name: "vidsave-save" });
      const CHUNK = 4 * 1024 * 1024;
      let offset = 0;

      port.postMessage({
        type: "begin",
        filename,
        mime: blob.type || "video/mp4",
        totalSize: buf.byteLength,
      });

      port.onMessage.addListener((msg) => {
        if (msg.type === "ready-for-chunk") {
          if (offset >= buf.byteLength) {
            port.postMessage({ type: "end" });
            return;
          }
          const slice = buf.slice(offset, offset + CHUNK);
          offset += CHUNK;
          port.postMessage({ type: "chunk", data: Array.from(new Uint8Array(slice)) });
        } else if (msg.type === "done") {
          port.disconnect();
          resolve();
        } else if (msg.type === "error") {
          port.disconnect();
          reject(new Error(msg.message));
        }
      });

      port.onDisconnect.addListener(() => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      });
    });
  }

  async function handleSaveClick(video, btn) {
    if (btn.dataset.state === "busy") return;
    try {
      const { blob, sourceUrl } = await obtainVideoBlob(video, btn);
      const filename = makeFilename(video, blob, sourceUrl);
      setButtonState(btn, "busy", "💾 Saving…");
      await sendBlobToSaver(blob, filename);
      setButtonState(btn, "done", "✅ Saved");
      setTimeout(() => setButtonState(btn, "idle", "⬇ Save video"), 2500);
    } catch (e) {
      console.error("[VidSave]", e);
      setButtonState(btn, "error", "⚠ " + (e.message || "Failed"));
      setTimeout(() => setButtonState(btn, "idle", "⬇ Save video"), 3000);
    }
  }

  function positionButton(video, btn) {
    const rect = video.getBoundingClientRect();
    btn.style.top = Math.max(rect.top + window.scrollY + 8, 0) + "px";
    btn.style.left = Math.max(rect.left + window.scrollX + 8, 0) + "px";
  }

  function attachButton(video) {
    if (PROCESSED.has(video)) return;
    if (video.dataset.vidsaveIgnore) return;

    const rect = video.getBoundingClientRect();
    if (rect.width < 80 || rect.height < 60) return;

    PROCESSED.add(video);

    const btn = document.createElement("button");
    btn.className = "vidsave-btn";
    btn.textContent = "⬇ Save video";
    btn.dataset.state = "idle";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      handleSaveClick(video, btn);
    });

    document.documentElement.appendChild(btn);
    BUTTON_MAP.set(video, btn);
    positionButton(video, btn);

    const update = () => {
      if (!document.documentElement.contains(video)) {
        btn.remove();
        return;
      }
      positionButton(video, btn);
    };
    window.addEventListener("scroll", update, true);
    window.addEventListener("resize", update);

    const ro = new ResizeObserver(update);
    ro.observe(video);

    const mo = new MutationObserver(() => {
      if (!document.documentElement.contains(video)) {
        btn.remove();
        ro.disconnect();
        mo.disconnect();
        window.removeEventListener("scroll", update, true);
        window.removeEventListener("resize", update);
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
  }

  function scanForVideos(root = document) {
    root.querySelectorAll("video").forEach(attachButton);
  }

  scanForVideos();

  const bodyObserver = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.tagName === "VIDEO") attachButton(node);
        else scanForVideos(node);
      }
    }
  });
  bodyObserver.observe(document.documentElement, { childList: true, subtree: true });

  setInterval(() => scanForVideos(), 2000);
})();
