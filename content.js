let settings = {
  enabled: true,
  noHashColors: false,
  scanRgb: false,
  debugMode: false,
  enabledSites: [],
  disabledSites: [],
};

let isTemporaryEnabled = false;

// Debug logging
function debug(...args) {
  if (settings.debugMode) {
    console.log("[Color Preview Debug]", ...args);
  }
}

// Load settings from storage
async function loadSettings() {
  const result = await browser.storage.local.get({
    enabled: true,
    noHashColors: false,
    scanRgb: false,
    debugMode: false,
    enabledSites: [],
    disabledSites: [],
  });
  settings = result;
  debug("Settings loaded:", settings);
}

// Check if extension should run on current site
function shouldRunOnSite() {
  // 1. Global Switch must be ON
  if (!settings.enabled) return false;

  // 2. Temporary override always wins
  if (isTemporaryEnabled) return true;

  const hostname = window.location.hostname;
  const url = window.location.href;

  // 3. Check for Explicitly Disabled Page (Specific URL blacklist)
  // This overrides domain enablement
  if (settings.disabledSites.includes(url)) {
    return false;
  }

  // 4. Check Whitelist (Domain or Specific URL)
  // The extension ONLY runs if the site/page is explicitly in the enabled list
  const isDomainEnabled = settings.enabledSites.some(
    (site) => hostname === site || hostname.endsWith("." + site),
  );
  const isPageEnabled = settings.enabledSites.includes(url);

  return isDomainEnabled || isPageEnabled;
}

// Convert RGB to hex for display (tooltip only)
function rgbToHex(r, g, b) {
  return (
    "#" +
    [r, g, b]
      .map((x) => {
        const hex = parseInt(x).toString(16);
        return hex.length === 1 ? "0" + hex : hex;
      })
      .join("")
  );
}

// Remove all existing color preview boxes
function removeAllPreviews() {
  document
    .querySelectorAll(".color-preview-box")
    .forEach((box) => box.remove());
  // Reset processed flag so we can re-scan cleanly
  document.querySelectorAll("[data-color-preview-processed]").forEach((el) => {
    delete el.dataset.colorPreviewProcessed;
  });
}

// Process a single text node
function processTextNode(textNode) {
  const parent = textNode.parentNode;
  if (!parent || parent.classList?.contains("color-preview-box")) return;

  const text = textNode.textContent;

  // Optimization: Only skip if BOTH checks fail.
  // If noHashColors is ON, we cannot skip just because '#' is missing.
  if (
    !settings.noHashColors &&
    !text.includes("#") &&
    !text.toLowerCase().includes("rgb")
  ) {
    return;
  }

  // Further optimization: if noHashColors is ON, but text is too short for a hex
  if (
    settings.noHashColors &&
    text.length < 6 &&
    !text.toLowerCase().includes("rgb")
  ) {
    return;
  }

  const matches = [];

  // 1. Match hex with #
  const hexWithHash = /#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})\b/g;
  let m;
  while ((m = hexWithHash.exec(text)) !== null) {
    matches.push({
      index: m.index,
      length: m[0].length,
      text: m[0],
      color: m[0], // CSS accepts #hex
    });
  }

  // 2. Match hex without # (Only if enabled in settings)
  if (settings.noHashColors) {
    // Matches 6 character hex codes strictly bounded
    const hexWithoutHash = /\b([0-9A-Fa-f]{6})\b/g;
    while ((m = hexWithoutHash.exec(text)) !== null) {
      const pos = m.index;

      // Avoid overlapping with existing matches (e.g. parts of a #hex)
      const covered = matches.some(
        (existing) =>
          pos >= existing.index - 1 && pos <= existing.index + existing.length,
      );

      if (!covered) {
        matches.push({
          index: pos,
          length: m[0].length,
          text: m[0],
          color: "#" + m[0], // Add # for CSS
        });
      }
    }
  }

  // 3. Match RGB/RGBA (Only if enabled in settings)
  if (settings.scanRgb) {
    // Regex captures: 1=R, 2=G, 3=B, 4=Alpha(optional)
    const rgbPattern =
      /rgba?\s*\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)/gi;

    while ((m = rgbPattern.exec(text)) !== null) {
      const r = parseInt(m[1]);
      const g = parseInt(m[2]);
      const b = parseInt(m[3]);
      const a = m[4] ? parseFloat(m[4]) : 1; // Alpha value

      // Validate 0-255 range
      if (r <= 255 && g <= 255 && b <= 255) {
        // If we have transparency (a < 1) or it is an 'rgba' string,
        // use the original string for CSS to preserve transparency.
        // Otherwise, convert to hex for a cleaner look.
        let cssColor;
        if (m[0].toLowerCase().startsWith("rgba") || a < 1) {
          cssColor = m[0]; // Use "rgba(r,g,b,a)" directly
        } else {
          cssColor = rgbToHex(r, g, b);
        }

        matches.push({
          index: m.index,
          length: m[0].length,
          text: m[0],
          color: cssColor,
        });
      }
    }
  }

  if (matches.length === 0) return;

  // Sort matches by position
  matches.sort((a, b) => a.index - b.index);

  // Filter overlaps
  const filtered = [];
  for (const match of matches) {
    const overlaps = filtered.some(
      (f) =>
        (match.index >= f.index && match.index < f.index + f.length) ||
        (match.index + match.length > f.index && match.index < f.index),
    );
    if (!overlaps) {
      filtered.push(match);
    }
  }

  // Build the DOM replacement
  const fragment = document.createDocumentFragment();
  let pos = 0;

  for (const match of filtered) {
    // Text before match
    if (match.index > pos) {
      fragment.appendChild(
        document.createTextNode(text.substring(pos, match.index)),
      );
    }

    // Matched text
    fragment.appendChild(document.createTextNode(match.text));

    // Color box
    const box = document.createElement("span");
    box.className = "color-preview-box";

    // We add a checkered background (conic-gradient) so semi-transparent colors (rgba) are visible
    const checkerboard = `
      background-image:
        linear-gradient(45deg, #ccc 25%, transparent 25%),
        linear-gradient(-45deg, #ccc 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, #ccc 75%),
        linear-gradient(-45deg, transparent 75%, #ccc 75%);
      background-size: 6px 6px;
      background-position: 0 0, 0 3px, 3px -3px, -3px 0px;
      background-color: white;
    `;

    box.style.cssText = `
      display: inline-block;
      width: 12px;
      height: 12px;
      margin: 0 2px 0 4px;
      border: 1px solid #888;
      border-radius: 2px;
      vertical-align: middle;
      cursor: default;
      user-select: none;
      ${checkerboard}
    `;

    // Create the actual color layer on top of the checkerboard
    const colorLayer = document.createElement("span");
    colorLayer.style.cssText = `
        display: block;
        width: 100%;
        height: 100%;
        background-color: ${match.color};
    `;

    box.appendChild(colorLayer);
    box.title = match.color; // Tooltip
    fragment.appendChild(box);

    pos = match.index + match.length;
  }

  // Remaining text
  if (pos < text.length) {
    fragment.appendChild(document.createTextNode(text.substring(pos)));
  }

  parent.replaceChild(fragment, textNode);
}

function addColorPreviews() {
  if (!shouldRunOnSite()) {
    removeAllPreviews();
    return;
  }

  debug("=== Starting color preview scan ===");
  removeAllPreviews();

  // Selectors for code-like elements
  const selectors = [
    "pre:not(:has(textarea))",
    "code",
    'td[class*="code"]:not(:has(textarea))',
    'div[class*="code"]:not(:has(textarea))',
    'span[class*="code"]',
  ];

  const allElements = new Set();
  selectors.forEach((sel) => {
    const elements = document.querySelectorAll(sel);
    elements.forEach((el) => allElements.add(el));
  });

  let elementsProcessed = 0;

  Array.from(allElements).forEach((element) => {
    if (element.dataset.colorPreviewProcessed) return;
    element.dataset.colorPreviewProcessed = "true";
    elementsProcessed++;

    const textNodesToProcess = [];

    // Recursive scanner with stop-conditions to prevent duplication
    function collectTextNodes(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (node.textContent.trim().length > 0) {
          textNodesToProcess.push(node);
        }
      } else if (node.nodeType === Node.ELEMENT_NODE) {
        // 1. Don't traverse into our own boxes
        if (node.classList?.contains("color-preview-box")) return;
        // 2. Don't traverse into textareas
        if (node.tagName === "TEXTAREA") return;

        // 3. Prevent nested recursion:
        // If we are inside a 'TD', but encounter a 'DIV.code', stop.
        // The 'DIV.code' will be handled by the main loop separately.
        if (node !== element) {
          if (node.tagName === "PRE" || node.tagName === "CODE") return;

          // Check for nested code containers
          if (
            (node.tagName === "DIV" ||
              node.tagName === "TD" ||
              node.tagName === "SPAN") &&
            node.className &&
            typeof node.className === "string" &&
            node.className.toLowerCase().includes("code")
          ) {
            return;
          }
        }

        for (const child of node.childNodes) {
          collectTextNodes(child);
        }
      }
    }

    collectTextNodes(element);

    textNodesToProcess.forEach((node) => {
      processTextNode(node);
    });
  });

  debug(`Processed ${elementsProcessed} elements`);
}

// Listen for messages
browser.runtime.onMessage.addListener((message) => {
  if (message.action === "reloadSettings") {
    loadSettings().then(() => {
      addColorPreviews();
    });
  } else if (message.action === "enableTemporary") {
    isTemporaryEnabled = true;
    addColorPreviews();
    return Promise.resolve({ enabled: true });
  } else if (message.action === "disableTemporary") {
    isTemporaryEnabled = false;
    removeAllPreviews();
    return Promise.resolve({ enabled: false });
  } else if (message.action === "getTemporaryState") {
    return Promise.resolve({ enabled: isTemporaryEnabled });
  }
});

// Initialize
loadSettings().then(() => {
  if (shouldRunOnSite()) {
    setTimeout(addColorPreviews, 500);
  }

  // Watch for dynamic content (GitHub uses a lot of AJAX)
  let scanTimeout;
  const observer = new MutationObserver((mutations) => {
    if (!shouldRunOnSite()) return;

    let shouldScan = false;

    for (const mutation of mutations) {
      if (
        mutation.target &&
        mutation.target.classList?.contains("color-preview-box")
      ) {
        continue;
      }

      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.TEXT_NODE) {
          shouldScan = true;
          break;
        } else if (
          node.nodeType === Node.ELEMENT_NODE &&
          !node.classList?.contains("color-preview-box")
        ) {
          shouldScan = true;
          break;
        }
      }
      if (shouldScan) break;
    }

    if (shouldScan) {
      clearTimeout(scanTimeout);
      scanTimeout = setTimeout(addColorPreviews, 500);
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
});
