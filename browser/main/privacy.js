// The extension's network settings (../../extension/lib.js), turned into Electron session calls.
import { proxyConfig, webrtcPolicy } from "../../extension/lib.js";

// A port nothing listens on: traffic through it fails instead of going out directly.
export const KILL_SWITCH = { proxyRules: "socks5://127.0.0.1:9" };

// Electron's setProxy() value for the stored settings, plus the error that forced the kill switch.
export function sessionProxy(s) {
  try {
    const value = proxyConfig(s);
    if (!value) return { config: { mode: "direct" }, error: "" };
    const { scheme, host, port } = value.rules.singleProxy;
    return { config: { proxyRules: `${scheme}://${host}:${port}` }, error: "" };
  } catch (e) {
    // Fail closed: a broken Tor or proxy setting blocks traffic, it never goes direct.
    return { config: KILL_SWITCH, error: e.message };
  }
}

// lib.js returns null for "the browser's default"; Helium's default is public interface only.
export function sessionWebRTC(s) {
  return webrtcPolicy(s) ?? "default_public_interface_only";
}
