const statusEl = document.getElementById("status");

function setStatus(text, cls) {
  statusEl.hidden = !text;
  statusEl.textContent = text || "";
  statusEl.className = cls || "";
}

document.getElementById("clear-cache").addEventListener("click", async () => {
  const all = await chrome.storage.local.get(null);
  const stale = Object.keys(all).filter(
    (k) => k.startsWith("show_") || k.startsWith("wiki_")
  );
  await chrome.storage.local.remove(stale);
  setStatus(`Cleared ${stale.length} cached lookup(s).`, "ok");
});

document.getElementById("disarm").addEventListener("click", async () => {
  await chrome.storage.local.remove("armed");
  setStatus("Guard disarmed.", "ok");
});
