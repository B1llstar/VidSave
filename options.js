const folderNameEl = document.getElementById("folderName");
const pickBtn = document.getElementById("pickBtn");
const statusEl = document.getElementById("status");

function setStatus(msg, isError) {
  statusEl.textContent = msg;
  statusEl.className = "status" + (isError ? " error" : "");
}

async function refreshFolderLabel() {
  try {
    const handle = await getSavedDirectoryHandle();
    if (!handle) {
      folderNameEl.textContent = "No folder selected";
      return;
    }
    const perm = await handle.queryPermission({ mode: "readwrite" });
    folderNameEl.textContent =
      handle.name + (perm === "granted" ? "" : "  (permission needed — click Choose Folder)");
  } catch (e) {
    folderNameEl.textContent = "No folder selected";
  }
}

pickBtn.addEventListener("click", async () => {
  try {
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    const perm = await handle.requestPermission({ mode: "readwrite" });
    if (perm !== "granted") {
      setStatus("Permission was not granted.", true);
      return;
    }
    await saveDirectoryHandle(handle);
    await refreshFolderLabel();
    setStatus("Saved! Videos will now be written to \"" + handle.name + "\".", false);
  } catch (e) {
    if (e.name !== "AbortError") {
      setStatus("Could not select folder: " + e.message, true);
    }
  }
});

refreshFolderLabel();
