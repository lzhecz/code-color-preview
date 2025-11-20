let currentUrl = "";
let currentDomain = "";

// --- UI HELPERS ---

function switchTab(tabId) {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.target === tabId);
  });
  document.querySelectorAll(".tab-content").forEach((content) => {
    content.classList.toggle("active", content.id === tabId);
  });
}

function updateGlobalToggleUI(enabled) {
  const btnOn = document.getElementById("extOn");
  const btnOff = document.getElementById("extOff");
  if (enabled) {
    btnOn.classList.add("active");
    btnOff.classList.remove("active");
  } else {
    btnOn.classList.remove("active");
    btnOff.classList.add("active");
  }
}

function updateSiteToggleUI(settings) {
  const btn = document.getElementById("siteToggleBtn");

  // Set text to domain
  btn.textContent = currentDomain || "Website";

  // LOGIC: Whitelist Mode
  // The button is "Active" (Checkmark) if the site is in the enabledSites list.
  // The button is "Inactive" (X) if not in list.

  const isDomainEnabled = settings.enabledSites.includes(currentDomain);

  if (isDomainEnabled) {
    btn.classList.add("active");
    btn.classList.remove("disabled-state");
    btn.title = "Website is enabled. Click to disable.";
  } else {
    btn.classList.remove("active");
    btn.classList.add("disabled-state"); // Adds the X icon and red color
    btn.title = "Website is not enabled. Click to enable.";
  }
}

// --- DATA LOGIC ---

async function loadSettings() {
  const result = await browser.storage.local.get({
    enabled: true,
    noHashColors: false,
    scanRgb: false,
    debugMode: false,
    enabledSites: [],
    disabledSites: [],
  });

  updateGlobalToggleUI(result.enabled);

  document.getElementById("noHashColors").checked = result.noHashColors;
  document.getElementById("scanRgb").checked = result.scanRgb;
  document.getElementById("debugMode").checked = result.debugMode;

  return result;
}

async function saveSetting(key, value) {
  await browser.storage.local.set({ [key]: value });
  notifyContentScript();
}

function notifyContentScript() {
  browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
    if (tabs[0]) {
      browser.tabs
        .sendMessage(tabs[0].id, { action: "reloadSettings" })
        .catch(() => {});
    }
  });
}

async function getCurrentTab() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  if (tab && tab.url) {
    const url = new URL(tab.url);
    currentUrl = url.href;
    currentDomain = url.hostname;

    document.getElementById("siteToggleBtn").textContent = currentDomain;
  }
}

// --- LIST MANAGEMENT ---

function renderSiteLists(settings) {
  const enabledWebsitesList = document.getElementById("enabledWebsitesList");
  const enabledPagesList = document.getElementById("enabledPagesList");
  const disabledList = document.getElementById("disabledList");

  // Helper: Check if string looks like a URL (has slash after protocol) or just domain
  const isDomain = (str) =>
    !str.includes("/") || (str.split("/").length <= 3 && !str.endsWith("/"));

  // 1. Split enabledSites into Domains and Pages
  const enabledDomains = settings.enabledSites.filter((s) => isDomain(s));
  const enabledPages = settings.enabledSites.filter((s) => !isDomain(s));

  // 2. Disabled list contains only specific pages
  const disabledPages = settings.disabledSites.filter((s) => !isDomain(s));

  // Helper to render HTML securely using DOM creation instead of innerHTML
  const renderItems = (items, container, listType) => {
    // Clear current content
    container.textContent = "";

    if (items.length === 0) {
      const emptyMsg = document.createElement("div");
      emptyMsg.className = "empty-msg";
      emptyMsg.textContent = "List is empty";
      container.appendChild(emptyMsg);
      return;
    }

    items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "site-item";

      const span = document.createElement("span");
      span.title = item;
      span.style.overflow = "hidden";
      span.style.textOverflow = "ellipsis";
      span.style.whiteSpace = "nowrap";
      span.style.maxWidth = "220px";
      span.textContent = item;

      const btn = document.createElement("button");
      btn.className = "remove-btn";
      btn.dataset.val = item;
      btn.dataset.list = listType;
      btn.textContent = "×";

      row.appendChild(span);
      row.appendChild(btn);
      container.appendChild(row);
    });
  };

  renderItems(enabledDomains, enabledWebsitesList, "enabled");
  renderItems(enabledPages, enabledPagesList, "enabled");
  renderItems(disabledPages, disabledList, "disabled");

  // Re-attach listeners using event delegation or direct attachment
  // Since we recreated buttons, we need to attach listeners to the new buttons
  document.querySelectorAll(".remove-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      const val = e.target.dataset.val;
      const type = e.target.dataset.list;

      const currentSettings = await loadSettings();
      if (type === "enabled") {
        currentSettings.enabledSites = currentSettings.enabledSites.filter(
          (s) => s !== val,
        );
      } else {
        currentSettings.disabledSites = currentSettings.disabledSites.filter(
          (s) => s !== val,
        );
      }

      await browser.storage.local.set(currentSettings);
      renderSiteLists(currentSettings);
      updateSiteToggleUI(currentSettings);
      notifyContentScript();
    });
  });
}

async function clearList(listName) {
  const settings = await loadSettings();

  if (listName === "enabledWebsites") {
    // Only remove domains, keep pages
    settings.enabledSites = settings.enabledSites.filter(
      (s) => s.includes("/") && (s.split("/").length > 3 || s.endsWith("/")),
    );
  } else if (listName === "enabledPages") {
    // Only remove pages, keep domains
    settings.enabledSites = settings.enabledSites.filter(
      (s) => !s.includes("/") || (s.split("/").length <= 3 && !s.endsWith("/")),
    );
  } else if (listName === "disabled") {
    settings.disabledSites = [];
  }

  await browser.storage.local.set({
    enabledSites: settings.enabledSites,
    disabledSites: settings.disabledSites,
  });

  renderSiteLists(settings);
  updateSiteToggleUI(settings);
  notifyContentScript();
}

// --- ACTIONS ---

async function toggleGlobal(state) {
  await saveSetting("enabled", state);
  const settings = await loadSettings();
  // Note: Global toggle doesn't change lists, just the "main switch" state
}

async function toggleCurrentWebsite() {
  const settings = await loadSettings();
  const isDomainEnabled = settings.enabledSites.includes(currentDomain);

  if (isDomainEnabled) {
    // Disable it (Remove from enabled list)
    settings.enabledSites = settings.enabledSites.filter(
      (s) => s !== currentDomain,
    );
  } else {
    // Enable it (Add to enabled list)
    settings.enabledSites.push(currentDomain);
    // Clean up potential conflicts
    settings.disabledSites = settings.disabledSites.filter(
      (s) => !s.includes(currentDomain),
    );
  }

  await browser.storage.local.set({
    enabledSites: settings.enabledSites,
    disabledSites: settings.disabledSites,
  });

  updateSiteToggleUI(settings);
  renderSiteLists(settings);
  notifyContentScript();
}

async function modifyPageList(action) {
  const settings = await loadSettings();

  // Clean existing entries for this URL
  settings.enabledSites = settings.enabledSites.filter((s) => s !== currentUrl);
  settings.disabledSites = settings.disabledSites.filter(
    (s) => s !== currentUrl,
  );

  if (action === "enable") {
    settings.enabledSites.push(currentUrl);
  } else {
    settings.disabledSites.push(currentUrl);
  }

  await browser.storage.local.set({
    enabledSites: settings.enabledSites,
    disabledSites: settings.disabledSites,
  });

  renderSiteLists(settings);
  updateSiteToggleUI(settings);
  notifyContentScript();
}

// Temporary Show
async function showOnce() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tabs[0]) return;

  const btn = document.getElementById("showOnce");
  const response = await browser.tabs
    .sendMessage(tabs[0].id, { action: "getTemporaryState" })
    .catch(() => {});

  if (response && response.enabled) {
    await browser.tabs.sendMessage(tabs[0].id, { action: "disableTemporary" });
    btn.textContent = "Show on Current Page (Until Reload)";
    btn.style.background = "#303436";
  } else {
    await browser.tabs.sendMessage(tabs[0].id, { action: "enableTemporary" });
    btn.textContent = "Hide (Until Reload)";
    btn.style.background = "#cc3333";
  }
}

// --- INITIALIZATION ---

document.addEventListener("DOMContentLoaded", async () => {
  await getCurrentTab();
  const settings = await loadSettings();
  renderSiteLists(settings);
  updateSiteToggleUI(settings);

  // Tabs
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.target));
  });

  // Header Buttons
  document
    .getElementById("extOn")
    .addEventListener("click", () => toggleGlobal(true));
  document
    .getElementById("extOff")
    .addEventListener("click", () => toggleGlobal(false));
  document
    .getElementById("siteToggleBtn")
    .addEventListener("click", toggleCurrentWebsite);

  // Settings
  document
    .getElementById("noHashColors")
    .addEventListener("change", (e) =>
      saveSetting("noHashColors", e.target.checked),
    );
  document
    .getElementById("scanRgb")
    .addEventListener("change", (e) =>
      saveSetting("scanRgb", e.target.checked),
    );
  document
    .getElementById("debugMode")
    .addEventListener("change", (e) =>
      saveSetting("debugMode", e.target.checked),
    );

  // Page Actions
  document.getElementById("showOnce").addEventListener("click", showOnce);
  document
    .getElementById("enablePage")
    .addEventListener("click", () => modifyPageList("enable"));
  document
    .getElementById("disablePage")
    .addEventListener("click", () => modifyPageList("disable"));

  // Clear Buttons
  document
    .getElementById("clearEnabledSites")
    .addEventListener("click", () => clearList("enabledWebsites"));
  document
    .getElementById("clearEnabledPages")
    .addEventListener("click", () => clearList("enabledPages"));
  document
    .getElementById("clearDisabled")
    .addEventListener("click", () => clearList("disabled"));
});
