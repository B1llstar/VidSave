const DEFAULT_SUBFOLDER = "VidSave";
const folderStatus = document.getElementById("folderStatus");
const openOptions = document.getElementById("openOptions");

chrome.storage.sync.get({ subfolder: DEFAULT_SUBFOLDER }, (items) => {
  const subfolder = items.subfolder || DEFAULT_SUBFOLDER;
  folderStatus.innerHTML = `Saving to: <strong>Downloads/${subfolder}</strong>`;
});

openOptions.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});
