// Runs in an isolated world inside the page, so the page's own scripts can't see or change it.
// Visible text only: forms, fields, editable drafts and hidden elements are skipped.
// Bounded so it fits the 1B model's context next to the question.
export const PAGE_TEXT_LIMIT = 8000;

export const EXTRACT = `(() => {
  const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "CANVAS", "IFRAME", "FORM", "INPUT", "TEXTAREA", "SELECT", "BUTTON", "OPTION", "NAV", "FOOTER"]);
  const parts = [];
  let size = 0;
  const walk = (node) => {
    if (size > ${PAGE_TEXT_LIMIT}) return;
    if (node.nodeType === 3) {
      const t = node.textContent.replace(/\\s+/g, " ").trim();
      if (t) { parts.push(t); size += t.length + 1; }
      return;
    }
    if (node.nodeType !== 1) return;
    if (SKIP.has(node.tagName) || node.isContentEditable || node.getAttribute("aria-hidden") === "true") return;
    if (node.checkVisibility && !node.checkVisibility()) return;
    const block = /^(P|DIV|LI|H[1-6]|TR|SECTION|ARTICLE|BR|PRE|BLOCKQUOTE)$/.test(node.tagName);
    for (const child of node.childNodes) walk(child);
    if (block) parts.push("\\n");
  };
  walk(document.querySelector("main, article, [role=main]") || document.body || document.documentElement);
  const text = parts.join(" ").replace(/ *\\n[ \\n]*/g, "\\n").trim().slice(0, ${PAGE_TEXT_LIMIT});
  return { title: document.title, url: location.href, text };
})()`;
