// Boosts: your own CSS, JavaScript and font for a site, plus Zap (click an element to hide it
// for good). Arc's Boosts and Zen's boosts/ are the model; the code here is Archium's own.
// Boost scripts run in an isolated world: they see the page's DOM, not its JavaScript.
import { hostOf } from "./privacy/filter.js";

const BOOST_WORLD = 1000;
const PICKER_WORLD = 1001;
const FONTS = new Set(["", "system-ui", "serif", "monospace", "Georgia", "Helvetica Neue", "Inter", "Iosevka", "Comic Sans MS"]);

export class Boosts {
  constructor(store) {
    this.store = store;
    this.inserted = new WeakMap(); // webContents → css key
  }

  get sites() {
    return this.store.data.sites;
  }

  get(host) {
    return this.sites[host] ?? null;
  }

  list() {
    return Object.entries(this.sites).map(([host, b]) => ({ host, ...b }));
  }

  set(host, patch) {
    if (!host) return null;
    const current = this.sites[host] ?? { enabled: true, css: "", js: "", font: "", zap: [] };
    const next = { ...current, ...pick(patch, ["enabled", "css", "js", "font", "zap"]) };
    if (!FONTS.has(next.font)) next.font = "";
    next.zap = (next.zap ?? []).filter((s) => typeof s === "string" && s.length < 500);
    this.sites[host] = next;
    this.store.save();
    return next;
  }

  remove(host) {
    delete this.sites[host];
    this.store.save();
  }

  addZap(host, selector) {
    const b = this.get(host) ?? this.set(host, {});
    if (!b.zap.includes(selector)) this.set(host, { zap: [...b.zap, selector] });
  }

  // The CSS a boost adds: hidden (zapped) elements and the font.
  static css(b) {
    const parts = [];
    if (b.zap?.length) parts.push(`${b.zap.join(",\n")} { display: none !important; }`);
    if (b.font) parts.push(`body, body *:not(code):not(pre):not(kbd):not(samp):not(i):not([class*=\"icon\"]) { font-family: ${JSON.stringify(b.font)}, system-ui, sans-serif !important; }`);
    if (b.css) parts.push(b.css);
    return parts.join("\n");
  }

  async apply(wc) {
    if (wc.isDestroyed()) return;
    const key = this.inserted.get(wc);
    if (key) {
      this.inserted.delete(wc);
      await wc.removeInsertedCSS(key).catch(() => {});
    }
    const b = this.get(hostOf(wc.getURL()));
    if (!b || b.enabled === false) return;
    const css = Boosts.css(b);
    if (css) this.inserted.set(wc, await wc.insertCSS(css, { cssOrigin: "user" }).catch(() => null));
    if (b.js) wc.executeJavaScriptInIsolatedWorld(BOOST_WORLD, [{ code: b.js }]).catch(() => {});
  }

  // Lets the user point at an element; resolves with a CSS selector for it, or null on Escape.
  pick(wc) {
    return wc.executeJavaScriptInIsolatedWorld(PICKER_WORLD, [{ code: `(${picker})()` }], true).catch(() => null);
  }
}

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => k in (obj ?? {})).map((k) => [k, obj[k]]));

// Runs in the page (isolated world). Kept self-contained: it's sent as source text.
function picker() {
  return new Promise((resolve) => {
    const box = document.createElement("div");
    box.style.cssText =
      "position:fixed;z-index:2147483647;pointer-events:none;border:2px solid #ff5f57;background:rgba(255,95,87,.18);border-radius:4px;transition:all .06s";
    const tip = document.createElement("div");
    tip.textContent = "Click to zap · Esc to cancel";
    tip.style.cssText =
      "position:fixed;z-index:2147483647;left:50%;top:12px;transform:translateX(-50%);padding:6px 12px;border-radius:999px;background:#111;color:#fff;font:13px system-ui;pointer-events:none";
    document.documentElement.append(box, tip);
    let target = null;
    const selectorFor = (el) => {
      if (el.id && /^[A-Za-z][\w-]*$/.test(el.id)) return `#${el.id}`;
      const parts = [];
      for (let node = el; node && node.nodeType === 1 && node !== document.documentElement; node = node.parentElement) {
        let part = node.localName;
        const classes = [...node.classList].filter((c) => /^[A-Za-z][\w-]*$/.test(c)).slice(0, 2);
        if (classes.length) part += `.${classes.join(".")}`;
        const parent = node.parentElement;
        if (parent) {
          const same = [...parent.children].filter((c) => c.localName === node.localName);
          if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
        }
        parts.unshift(part);
        if (node.id && /^[A-Za-z][\w-]*$/.test(node.id)) {
          parts[0] = `#${node.id}`;
          break;
        }
      }
      return parts.join(" > ");
    };
    const move = (e) => {
      target = document.elementFromPoint(e.clientX, e.clientY);
      if (!target || target === box) return;
      const r = target.getBoundingClientRect();
      Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    };
    const done = (value) => {
      removeEventListener("mousemove", move, true);
      removeEventListener("click", click, true);
      removeEventListener("keydown", key, true);
      box.remove();
      tip.remove();
      resolve(value);
    };
    const click = (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      done(target ? selectorFor(target) : null);
    };
    const key = (e) => e.key === "Escape" && done(null);
    addEventListener("mousemove", move, true);
    addEventListener("click", click, true);
    addEventListener("keydown", key, true);
  });
}
