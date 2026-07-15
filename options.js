const DEFAULT_SUBFOLDER = "VidSave";
const subfolderInput = document.getElementById("subfolder");
const saveBtn = document.getElementById("saveBtn");
const statusEl = document.getElementById("status");

function setStatus(msg, isError) {
  statusEl.textContent = msg;
  statusEl.className = "status" + (isError ? " error" : "");
}

function sanitizeSubfolder(name) {
  return name.replace(/[\\:*?"<>|]+/g, "_").replace(/^\/+|\/+$/g, "").trim();
}

chrome.storage.sync.get({ subfolder: DEFAULT_SUBFOLDER }, (items) => {
  subfolderInput.value = items.subfolder || DEFAULT_SUBFOLDER;
});

saveBtn.addEventListener("click", () => {
  const clean = sanitizeSubfolder(subfolderInput.value) || DEFAULT_SUBFOLDER;
  subfolderInput.value = clean;
  chrome.storage.sync.set({ subfolder: clean }, () => {
    setStatus(`Saved! Videos will go into Downloads/${clean}.`, false);
  });
});
