# VidSave — One-Click Video Saver for Brave

Detects `<video>` elements on any page — even sites that don't offer a
"Save video as…" option — and saves them to a folder you choose, with a
single click and no repeated save dialogs.

## How it works

- A content script scans every page (including dynamically loaded content
  and iframes) for `<video>` elements and overlays a small **⬇ Save video**
  button on top of each one.
- Clicking it:
  1. Tries to fetch the video's underlying file directly (works for normal
     `<video src="...mp4">` and most `blob:` URLs).
  2. If that fails (e.g. fragmented MSE/streaming players that never expose
     a whole-file blob), it falls back to recording the video in real time
     via `captureStream()` + `MediaRecorder`, which works for anything the
     browser can already play.
  3. The captured video is streamed to a hidden extension page that writes
     it straight to your chosen folder using the File System Access API —
     no "Save As" dialog.
- You pick the destination folder **once** in Settings; every save after
  that is fully one-click.

## Install in Brave

1. Open `brave://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this `VidSave` folder.
4. The Settings page opens automatically on install — click **Choose
   Folder…** and pick where videos should be saved.
5. Visit any page with a video, hover over it, and click **⬇ Save video**.

## Notes & limitations

- The chosen folder permission is granted per-browser-profile. If Brave
  ever asks again or saving fails with a permission error, reopen the
  extension's Settings (click the toolbar icon → **Open Settings**) and
  click **Choose Folder…** again.
- DRM-protected video (Widevine, etc.) cannot be captured — this is a
  browser-level restriction, not something any extension can bypass.
- For sites that use adaptive streaming (HLS/DASH via MSE) without a
  fetchable source file, VidSave records the stream in real time, so
  saving takes as long as the video's actual playback (recording starts
  automatically and plays it if paused).
- Re-running a save on the same page names the file uniquely (`Title
  (1).mp4`, etc.) rather than overwriting.

## File overview

| File | Purpose |
|---|---|
| `manifest.json` | MV3 extension manifest |
| `content.js` / `content.css` | Video detection + save button overlay |
| `background.js` | Service worker; spins up the offscreen writer and relays data |
| `saver.html` / `saver.js` | Offscreen document that performs the actual disk write |
| `fs-store.js` | Shared IndexedDB helper for persisting the folder handle |
| `options.html` / `options.js` | Settings page for picking the save folder |
| `popup.html` / `popup.js` | Toolbar popup showing current folder status |
