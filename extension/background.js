import {
  SEARCH_RULE_ID,
  fallbackUrl,
  networkPrediction,
  proxyConfig,
  searchRedirectRule,
  webrtcPolicy,
  withDefaults,
} from "./lib.js";

async function settings() {
  return withDefaults(await chrome.storage.local.get(null));
}

async function setBadge(text, color) {
  await chrome.action.setBadgeText({ text });
  if (text) await chrome.action.setBadgeBackgroundColor({ color });
}

function setOrClear(setting, value) {
  return value === null ? setting.clear({}) : setting.set({ value });
}

// Push the stored settings into Chromium. Runs on startup and after every change.
async function apply() {
  const s = await settings();
  let error = "";

  try {
    const value = proxyConfig(s);
    if (value) await chrome.proxy.settings.set({ value, scope: "regular" });
    else await chrome.proxy.settings.clear({ scope: "regular" });
  } catch (e) {
    // Fail closed: a broken Tor/proxy setting must block traffic, never send it direct.
    error = e.message;
    await chrome.proxy.settings.set({
      value: { mode: "fixed_servers", rules: { singleProxy: { scheme: "socks5", host: "127.0.0.1", port: 9 } } },
      scope: "regular",
    });
  }

  await setOrClear(chrome.privacy.network.webRTCIPHandlingPolicy, webrtcPolicy(s));
  await setOrClear(chrome.privacy.network.networkPredictionEnabled, networkPrediction(s));

  // Dynamic (not session) rules survive a restart, so Tor-mode searches are covered before onStartup runs.
  const rule = searchRedirectRule(s);
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [SEARCH_RULE_ID],
    addRules: rule ? [rule] : [],
  });

  const badges = { tor: ["TOR", "#6b3fa0"], proxy: ["PXY", "#2f6f8f"], direct: ["", ""] };
  await setBadge(...(error ? ["!", "#c62828"] : badges[s.mode]));
  await chrome.storage.session.set({ error });
}

chrome.runtime.onStartup.addListener(apply);
chrome.runtime.onInstalled.addListener(apply);
chrome.storage.onChanged.addListener((_, area) => {
  if (area === "local") apply();
});

// Tor or the proxy is down: traffic is blocked (kill switch), so tell the user why pages fail.
chrome.proxy.onProxyError.addListener(async (details) => {
  if (!details.fatal) return;
  await setBadge("OFF", "#c62828");
  await chrome.storage.session.set({ error: `Proxy unreachable: ${details.error}` });
});

// Local SearXNG is not running: retry the same search on the public instance.
chrome.webNavigation.onErrorOccurred.addListener(async (details) => {
  if (details.frameId !== 0) return;
  const url = fallbackUrl(details.url, await settings());
  if (url) chrome.tabs.update(details.tabId, { url });
});
