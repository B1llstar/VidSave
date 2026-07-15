const folderStatus = document.getElementById("folderStatus");
const openOptions = document.getElementById("openOptions");

async function refresh() {
  try {
    const handle = await getSavedDirectoryHandle();
    if (!handle) {
      folderStatus.innerHTML = "No folder selected yet. Click below to choose one.";
      return;
    }
    const perm = await handle.queryPermission({ mode: "readwrite" });
    if (perm === "granted") {
      folderStatus.innerHTML = `Saving to: <strong>${handle.name}</strong>`;
    } else {
      folderStatus.innerHTML = `Folder set to <strong>${handle.name}</strong>, but permission needs to be re-granted.`;
    }
  } catch (e) {
    folderStatus.textContent = "No folder selected yet.";
  }
}

openOptions.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});

refresh();
