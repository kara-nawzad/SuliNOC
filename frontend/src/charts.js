// Small SVG line chart with readable typography. No dependencies.
export function niceTicks(min, max, n = 4) {
  const span = max - min || 1,
    raw = span / n,
    p = 10 ** Math.floor(Math.log10(raw)),
    f = raw / p;
  const step = (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p,
    lo = Math.floor(min / step) * step,
    out = [];
  for (let v = lo; v <= max + step * 0.001; v += step) out.push(+v.toFixed(6));
  return out;
}
export const hhmm = (m) =>
  String(Math.floor(m / 60) % 24).padStart(2, "0") +
  ":" +
  String(Math.floor(m % 60)).padStart(2, "0");
export function xLabel(m, spanMin) {
  return spanMin > 1440
    ? m % 1440 < spanMin / 12
      ? "D" + (Math.floor(m / 1440) + 1)
      : ""
    : hhmm(m);
}
/** At most `maxPoints` samples, keeping the peaks.
 *
 * Long windows (7 d) hold ~2 000 samples — far more than the ~600 px the chart
 * has. Each bucket contributes its lowest and highest sample, in x order, so the
 * envelope (and every visible spike) survives while the path gets ~10x shorter.
 * The untouched array stays for the tooltip, so hovered values remain exact.
 */
export function downsample(points, maxPoints = 300) {
  if (points.length <= maxPoints) return points;
  const buckets = Math.max(1, Math.floor(maxPoints / 2));
  const size = points.length / buckets;
  const out = [];
  for (let b = 0; b < buckets; b += 1) {
    const chunk = points.slice(
      Math.floor(b * size),
      Math.floor((b + 1) * size),
    );
    if (!chunk.length) continue;
    let lo = chunk[0],
      hi = chunk[0];
    for (const p of chunk) {
      if (p[1] < lo[1]) lo = p;
      if (p[1] > hi[1]) hi = p;
    }
    if (lo[0] <= hi[0]) out.push(lo, hi);
    else out.push(hi, lo);
  }
  // Buckets can overlap at the seam; keep the sequence monotonic in x.
  const seen = new Set();
  return out.filter((p) => (seen.has(p[0]) ? false : (seen.add(p[0]), true)));
}

export function lineChart(
  host,
  {
    color = "#0C9C83",
    unit = "",
    decimals = 1,
    zero = false,
    onNote = () => {},
  } = {},
) {
  // The drawing width follows the host's real width, so axis text keeps its CSS size
  // (12 px) instead of being scaled down with a fixed 640-unit viewBox.
  let W = 640;
  const H = 220,
    L = 46,
    R = 12,
    T = 14,
    B = 28;
  let pts = [];
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img"><g class="g"></g><path class="ln" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/><circle class="dot" r="3.5" fill="${color}" stroke="#fff" stroke-width="1.5"/><line class="cr" y1="${T}" y2="${H - B}"/></svg><div class="ch-tip" hidden></div>`;
  const svg = host.querySelector("svg"),
    g = svg.querySelector(".g"),
    ln = svg.querySelector(".ln"),
    dot = svg.querySelector(".dot"),
    cr = svg.querySelector(".cr"),
    tip = host.querySelector(".ch-tip");
  let sx,
    sy,
    raf = 0,
    dom = null,
    winMin = 0,
    axisKey = "";
  const fit = () => {
    const w = Math.round(host.clientWidth);
    if (w >= 200 && w !== W) {
      W = w;
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    }
  };
  const draw = () => {
    raf = 0;
    fit();
    if (!pts.length) return;
    const xs = pts.map((p) => p[0]),
      ys = pts.map((p) => p[1]);
    let lo = zero ? 0 : Math.min(...ys),
      hi = Math.max(...ys);
    if (dom) {
      lo = dom[0];
      hi = dom[1];
    } else {
      if (hi === lo) {
        hi += 1;
        lo -= 1;
      }
      const pad = (hi - lo) * 0.08;
      if (!zero) lo -= pad;
      hi += pad;
    }
    const fixed = (v) =>
      dom ? String(+v.toFixed(decimals)) : v.toFixed(decimals);
    const ticks = niceTicks(lo, hi),
      y0 = Math.min(ticks[0], lo),
      y1 = Math.max(ticks.at(-1), hi),
      x1 = xs.at(-1),
      // If the selected window reaches before available history, begin at the
      // first sample instead of leaving a blank gap at the left of the chart.
      x0 = winMin ? Math.max(xs[0], x1 - winMin) : xs[0],
      span = x1 - x0 || 1; // a set window spans its own length
    const dl = (m) => hhmm(m) + " D" + (Math.floor(m / 1440) + 1),
      longWin = winMin ? winMin >= 1440 : span > 1440;
    sx = (x) => L + ((x - x0) / span) * (W - L - R);
    sy = (v) => T + (1 - (v - y0) / (y1 - y0 || 1)) * (H - T - B);
    let s = "";
    // Specs for the same markup, so an unchanged axis can be skipped and a
    // changed one updated node by node instead of re-parsed.
    const specs = [];
    for (const v of ticks) {
      s += `<line class="gl" x1="${L}" x2="${W - R}" y1="${sy(v)}" y2="${sy(v)}"/><text class="ay" x="${L - 8}" y="${sy(v) + 4}" text-anchor="end">${fixed(v)}</text>`;
      specs.push({
        tag: "line",
        attrs: { class: "gl", x1: L, x2: W - R, y1: sy(v), y2: sy(v) },
      });
      specs.push({
        tag: "text",
        attrs: {
          class: "ay",
          x: L - 8,
          y: sy(v) + 4,
          "text-anchor": "end",
        },
        text: fixed(v),
      });
    }
    const xLabels = [];
    const addXLabel = (x, text, anchor) => {
      const width = text.length * 7;
      const left =
        anchor === "start" ? x : anchor === "end" ? x - width : x - width / 2;
      const right = left + width;
      if (
        xLabels.some(
          (label) => left < label.right + 8 && right > label.left - 8,
        )
      )
        return;
      xLabels.push({ x, text, anchor, left, right });
    };
    if (longWin) {
      // Endpoints carry the time; compact day markers keep a week readable.
      addXLabel(sx(x0), dl(x0), "start");
      if (x1 > x0) {
        addXLabel(sx(x1), dl(x1), "end");
        for (let m = Math.ceil(x0 / 1440) * 1440; m < x1; m += 1440)
          addXLabel(sx(m), `D${Math.floor(m / 1440) + 1}`, "middle");
      }
    } else {
      for (let i = 0; i < 5; i++) {
        const x = x0 + (span * i) / 4,
          lab = xLabel(x, span);
        // The label is placed at sx(x): the minute value itself is not a
        // pixel position. Passing it raw piled every label at one "x" and
        // pushed them off-canvas, so the axis showed no times at all.
        if (lab)
          addXLabel(sx(x), lab, i === 0 ? "start" : i === 4 ? "end" : "middle");
      }
    }
    for (const label of xLabels.sort((a, b) => a.x - b.x)) {
      s += `<text class="ax" x="${label.x}" y="${H - 8}" text-anchor="${label.anchor}">${label.text}</text>`;
      specs.push({
        tag: "text",
        attrs: {
          class: "ax",
          x: label.x,
          y: H - 8,
          "text-anchor": label.anchor,
        },
        text: label.text,
      });
    }
    // The axis is only touched when its content actually changed: replacing the
    // group with innerHTML re-parses every grid line and label, and for a
    // fixed-domain chart that was the same 13 nodes every second. When only the
    // numbers moved (a window that slides), the existing nodes are updated in
    // place instead — same markup, no parse, no node churn.
    if (s !== axisKey) {
      const same = axisKey !== "" && g.children.length === specs.length;
      axisKey = s;
      if (!same) {
        g.innerHTML = s;
      } else {
        for (let i = 0; i < specs.length; i += 1) {
          const el = g.children[i],
            spec = specs[i];
          if (el.tagName !== spec.tag) {
            g.innerHTML = s;
            break;
          }
          for (const name in spec.attrs) {
            const value = String(spec.attrs[name]);
            if (el.getAttribute(name) !== value) el.setAttribute(name, value);
          }
          if (spec.text != null && el.textContent !== spec.text)
            el.textContent = spec.text;
        }
      }
    }
    ln.setAttribute(
      "d",
      downsample(pts)
        .filter((p) => p[0] >= x0)
        .map(
          (p, i) =>
            (i ? "L" : "M") + sx(p[0]).toFixed(1) + " " + sy(p[1]).toFixed(1),
        )
        .join(""),
    );
    dot.setAttribute("cx", sx(x1));
    dot.setAttribute("cy", sy(pts.at(-1)[1]));
    onNote(
      !dom && !zero && y0 > 0
        ? `Axis starts at ${y0.toFixed(decimals)}${unit}, not zero.`
        : "",
    );
  };
  // One readout for a mouse and for a finger: pointer events already cover
  // both, so a tap (pointerdown) opens it and a touch-drag (pointermove while
  // pressed) tracks it.
  const showAt = (clientX) => {
    if (!pts.length) return;
    const r = svg.getBoundingClientRect(),
      x = ((clientX - r.left) / r.width) * W;
    let best = pts[0];
    for (const p of pts)
      if (Math.abs(sx(p[0]) - x) < Math.abs(sx(best[0]) - x)) best = p;
    cr.setAttribute("x1", sx(best[0]));
    cr.setAttribute("x2", sx(best[0]));
    cr.style.opacity = 1;
    tip.hidden = false;
    tip.textContent = `${hhmm(best[0])}  ${best[1].toFixed(decimals)} ${unit}`;
    tip.style.left =
      Math.min(r.width - 120, (sx(best[0]) / W) * r.width + 8) + "px";
  };
  svg.addEventListener("pointerdown", (e) => {
    showAt(e.clientX);
    // A finger drag belongs to the chart while it is pressed, not to the page.
    if (e.pointerType !== "mouse") {
      try {
        svg.setPointerCapture(e.pointerId);
      } catch {
        /* capture is best-effort */
      }
    }
  });
  svg.addEventListener("pointermove", (e) => showAt(e.clientX));
  svg.addEventListener("pointerleave", () => {
    cr.style.opacity = 0;
    tip.hidden = true;
  });
  const ro =
    typeof ResizeObserver !== "undefined"
      ? new ResizeObserver(() => {
          if (pts.length && !raf) raf = requestAnimationFrame(draw);
        })
      : null;
  ro?.observe(host);
  return {
    setData(next) {
      pts = next;
      if (!raf) raf = requestAnimationFrame(draw);
    },
    setWindow(minutes) {
      const next = minutes || 0;
      // Same window, same picture: no new frame.
      if (next === winMin) return;
      winMin = next;
      if (!raf) raf = requestAnimationFrame(draw);
    },
    /** Fix the y-axis to [min, max]; pass null to return to automatic. */
    setDomain(min, max) {
      const next = min == null ? null : [min, max];
      if (
        next === dom ||
        (next && dom && next[0] === dom[0] && next[1] === dom[1])
      )
        return;
      dom = next;
      if (!raf) raf = requestAnimationFrame(draw);
    },
    append(p) {
      pts.push(p);
      // Appending into a fixed window drops what has scrolled off it, so the
      // chart keeps exactly the same points a full setData would have drawn.
      if (winMin && pts.length > 1) {
        const cutoff = pts[pts.length - 1][0] - winMin;
        let drop = 0;
        while (drop < pts.length - 1 && pts[drop][0] < cutoff) drop += 1;
        if (drop) pts.splice(0, drop);
      }
      if (!raf) raf = requestAnimationFrame(draw);
    },
    destroy() {
      ro?.disconnect();
    },
  };
}
