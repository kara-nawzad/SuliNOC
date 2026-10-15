export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(v) {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export const num = (v, d = 0) =>
  Number.isFinite(Number(v)) ? Number(v).toLocaleString("en-US", { maximumFractionDigits: d, minimumFractionDigits: d }) : "—";

export const pct = (v, d = 2) => (Number.isFinite(Number(v)) ? `${Number(v).toFixed(d)} %` : "—");

export function reduceMotion() {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function toast(text, error = false) {
  const t = $("#toast");
  t.textContent = text;
  t.classList.toggle("err", error);
  t.classList.add("on");
  clearTimeout(toast.h);
  toast.h = setTimeout(() => t.classList.remove("on"), 2600);
}

export function tween(el, key, to, fmt = (v) => v.toFixed(0)) {
  // Smoothly count a numeric text node toward `to`.
  const from = Number(el.dataset[key] ?? to);
  el.dataset[key] = String(to);
  if (reduceMotion() || from === to || !Number.isFinite(from)) {
    el.textContent = fmt(to);
    return;
  }
  const t0 = performance.now(), dur = 600;
  const step = (now) => {
    const p = Math.min(1, (now - t0) / dur), e = 1 - (1 - p) ** 3;
    el.textContent = fmt(from + (to - from) * e);
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
