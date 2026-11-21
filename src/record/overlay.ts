// The overlay put into every recorded page before its own scripts: the drawn cursor and click ripples, captions,
// title cards and the spotlight (delve-video's stage). Its look is the effects library's overlay theme (CSS); the
// element ids and classes below are what a theme styles.
export function overlayScript(themeCss: string): string {
  return `
(() => {
  if (window.__stage) return;
  const css = ${JSON.stringify(themeCss)};
  const el = (id, tag = "div") => {
    let node = document.getElementById(id);
    if (!node) { node = document.createElement(tag); node.id = id; document.body.appendChild(node); }
    return node;
  };
  const install = () => {
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    const cursor = el("stage-cursor");
    addEventListener("mousemove", (e) => { cursor.style.left = e.clientX + "px"; cursor.style.top = e.clientY + "px"; }, true);
    addEventListener("mousedown", (e) => {
      cursor.classList.add("down");
      const ripple = document.createElement("div");
      ripple.className = "stage-ripple";
      ripple.style.left = e.clientX + "px";
      ripple.style.top = e.clientY + "px";
      document.body.appendChild(ripple);
      setTimeout(() => ripple.remove(), 700);
    }, true);
    addEventListener("mouseup", () => cursor.classList.remove("down"), true);
  };
  window.__stage = {
    caption(label, text, place) {
      const node = el("stage-caption");
      node.className = place;
      node.innerHTML = "";
      if (label) { const b = document.createElement("b"); b.textContent = label; node.appendChild(b); }
      node.appendChild(document.createTextNode(text));
      requestAnimationFrame(() => requestAnimationFrame(() => node.classList.add("shown")));
    },
    uncaption() { document.getElementById("stage-caption")?.classList.remove("shown"); },
    card(title, text) {
      const node = el("stage-card");
      node.innerHTML = "";
      const h = document.createElement("h1"); h.textContent = title; node.appendChild(h);
      const rule = document.createElement("div"); rule.className = "rule"; node.appendChild(rule);
      if (text) { const p = document.createElement("p"); p.textContent = text; node.appendChild(p); }
      document.documentElement.classList.add("stage-carding");
      requestAnimationFrame(() => requestAnimationFrame(() => node.classList.add("shown")));
    },
    uncard() {
      document.getElementById("stage-card")?.classList.remove("shown");
      document.documentElement.classList.remove("stage-carding");
    },
    spot(box) {
      const node = el("stage-spot");
      const pad = 10;
      Object.assign(node.style, { left: box.x - pad + "px", top: box.y - pad + "px",
        width: box.width + 2 * pad + "px", height: box.height + 2 * pad + "px" });
      requestAnimationFrame(() => node.classList.add("shown"));
    },
    unspot() { document.getElementById("stage-spot")?.classList.remove("shown"); },
  };
  if (document.body) install(); else addEventListener("DOMContentLoaded", install);
})();
`;
}
