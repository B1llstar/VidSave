# VidSave — One-Click Video Saver for Brave

Detects `<video>` elements on any page — even sites that don't offer a
"Save video as…" option — and saves them into a subfolder of your
Downloads folder with a single click and no save dialogs.

## How it works

- A content script scans every page (including dynamically loaded content
  and iframes) for `<video>` elements and overlays a small **⬇ Save video**
  button on top of each one, with a live progress bar/percentage.
- Clicking it:
  1. Tries to fetch the video's underlying file via a privileged
     background fetch (works for normal `<video src="...mp4">` and most
     direct source URLs, bypassing page-level CORS restrictions that
     block a content script's own fetch).
  2. Falls back to an in-page fetch for `blob:` URLs.
  3. If both fail (e.g. fragmented MSE/streaming players that never expose
     a whole-file blob, or DRM-adjacent CORS locks), it records the video
     in real time via `captureStream()` + `MediaRecorder`, which works for
     anything the browser can already play.
  4. The resulting file streams to the background service worker, which
     saves it via `chrome.downloads.download()` — no "Save As" dialog,
     ever.
- Files land in `Downloads/<subfolder>/`, where `<subfolder>` defaults to
  `VidSave` and is configurable in Settings.

## Install in Brave

1. Open `brave://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this `VidSave` folder.
4. (Optional) Open Settings from the toolbar popup to change the
   subfolder name — it defaults to `VidSave`.
5. Visit any page with a video, hover over it, and click **⬇ Save video**.

## Changing the actual save location

`chrome.downloads` always saves relative to Brave's configured Downloads
folder. To redirect everything (including VidSave's subfolder) to a
different drive or directory, change Brave's base download location once
at `brave://settings/downloads` — VidSave will follow whatever that's set
to.

## Notes & limitations

- DRM-protected video (Widevine, etc.) cannot be captured — this is a
  browser-level restriction, not something any extension can bypass.
- For sites that use adaptive streaming (HLS/DASH via MSE) without a
  fetchable source file, VidSave records the stream in real time, so
  saving takes as long as the video's actual playback (recording starts
  automatically and plays it if paused).
- Re-running a save on the same page names the file uniquely rather than
  overwriting (`conflictAction: "uniquify"`).

## File overview

| File | Purpose |
|---|---|
| `manifest.json` | MV3 extension manifest |
| `content.js` / `content.css` | Video detection, save button overlay, progress bar |
| `background.js` | Service worker; background fetch, blob assembly, `chrome.downloads` save |
| `options.html` / `options.js` | Settings page for the Downloads subfolder name |
| `popup.html` / `popup.js` | Toolbar popup showing the current save location |
