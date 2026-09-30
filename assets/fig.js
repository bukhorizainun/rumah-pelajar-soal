/* Rumah Pelajar — penampil gambar bergaya GeoGebra.
   RP.view(el, fig) membuat "Tampilan Grafis": 2D (SVG statis) atau 3D (bangun ruang yang bisa diputar).
   Bangun 3D: sumbu z ke atas; sisi yang menghadap belakang digambar putus-putus seperti di buku. */
window.RP = window.RP || {};

(function () {
  const NS = "http://www.w3.org/2000/svg";
  const INK = "#1d1b2e", HID = "#8d89a6", PRI = "#6557d2";

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  function shell(host, title, onReset) {
    host.innerHTML = "";
    const v = document.createElement("div");
    v.className = "view";
    v.innerHTML = `<div class="view-bar"><span>${title}</span>${onReset ? '<button type="button">Atur ulang</button>' : ""}</div><div class="view-cv paper"></div>`;
    host.appendChild(v);
    if (onReset) v.querySelector("button").addEventListener("click", onReset);
    return v.querySelector(".view-cv");
  }

  /* ---------------- 2D ---------------- */
  function view2d(host, fig) {
    const cv = shell(host, fig.title || "Tampilan Grafis");
    cv.innerHTML = `<svg viewBox="${fig.vb}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${fig.alt || "Gambar soal"}">${fig.svg}</svg>`;
  }

  /* ---------------- 3D ---------------- */
  function view3d(host, fig) {
    const yaw0 = fig.yaw ?? -0.62, pitch0 = fig.pitch ?? 0.42;
    let yaw = yaw0, pitch = pitch0;
    const cv = shell(host, "Tampilan Grafis 3D · seret untuk memutar", () => { yaw = yaw0; pitch = pitch0; draw(); });
    cv.classList.add("drag");
    const svg = el("svg", { role: "img", "aria-label": fig.alt || "Bangun ruang" }, cv);

    const solids = fig.solids.map((s) => {
      const names = Object.keys(s.v);
      const c = [0, 1, 2].map((k) => names.reduce((a, n) => a + s.v[n][k], 0) / names.length);
      const edges = new Map();
      s.f.forEach((f, fi) => f.forEach((a, i) => {
        const b = f[(i + 1) % f.length];
        const key = a < b ? a + "|" + b : b + "|" + a;
        if (!edges.has(key)) edges.set(key, { a, b, faces: [] });
        edges.get(key).faces.push(fi);
      }));
      return { ...s, c, edges: [...edges.values()] };
    });

    function rot(p) {
      const [x, y, z] = p;
      const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
      const x1 = x * cy - y * sy, y1 = x * sy + y * cy;
      return { sx: x1, sy: y1 * sp + z * cp, d: -y1 * cp + z * sp, r: [x1, y1, z] };
    }
    const camDir = () => [0, -Math.cos(pitch), Math.sin(pitch)];

    function draw() {
      const W = cv.clientWidth || 400, H = cv.clientHeight || 300;
      svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
      svg.innerHTML = "";
      // skala agar semua titik muat
      const all = [];
      solids.forEach((s) => Object.values(s.v).forEach((p) => all.push(rot(p))));
      (fig.pts ? Object.values(fig.pts) : []).forEach((p) => all.push(rot(p)));
      const xs = all.map((q) => q.sx), ys = all.map((q) => q.sy);
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      const pad = 46;
      const k = Math.min((W - 2 * pad) / (maxX - minX || 1), (H - 2 * pad) / (maxY - minY || 1));
      const ox = W / 2 - k * (minX + maxX) / 2, oy = H / 2 + k * (minY + maxY) / 2;
      const P = (p) => { const q = rot(p); return { x: ox + k * q.sx, y: oy - k * q.sy, d: q.d }; };
      const cam = camDir();

      const faceItems = [], edgeItems = [];
      solids.forEach((s) => {
        const vis = s.f.map((f) => {
          const pts = f.map((n) => rot(s.v[n]).r);
          const n = [0, 0, 0];
          for (let i = 0; i < pts.length; i++) {
            const a = pts[i], b = pts[(i + 1) % pts.length];
            n[0] += (a[1] - b[1]) * (a[2] + b[2]);
            n[1] += (a[2] - b[2]) * (a[0] + b[0]);
            n[2] += (a[0] - b[0]) * (a[1] + b[1]);
          }
          const fc = [0, 1, 2].map((kk) => pts.reduce((acc, p) => acc + p[kk], 0) / pts.length);
          const sc = rot(s.c).r;
          if (n[0] * (fc[0] - sc[0]) + n[1] * (fc[1] - sc[1]) + n[2] * (fc[2] - sc[2]) < 0) { n[0] = -n[0]; n[1] = -n[1]; n[2] = -n[2]; }
          const front = n[0] * cam[0] + n[1] * cam[1] + n[2] * cam[2] > 1e-9;
          const depth = f.reduce((acc, nm) => acc + P(s.v[nm]).d, 0) / f.length;
          faceItems.push({ s, f, front, depth, fi: s.f.indexOf(f) });
          return front;
        });
        s.edges.forEach((e) => edgeItems.push({ s, e, front: e.faces.some((fi) => vis[fi]) }));
      });

      faceItems.sort((a, b) => a.depth - b.depth).forEach((it) => {
        const pts = it.f.map((n) => { const q = P(it.s.v[n]); return q.x.toFixed(1) + "," + q.y.toFixed(1); }).join(" ");
        const fill = (it.s.faceFill && it.s.faceFill[it.fi]) || it.s.fill || PRI;
        el("polygon", { points: pts, fill, "fill-opacity": it.front ? (it.s.alpha ?? 0.22) : (it.s.alpha ?? 0.22) * 0.45, stroke: "none" }, svg);
      });
      edgeItems.filter((x) => !x.front).forEach(({ s, e }) => {
        const a = P(s.v[e.a]), b = P(s.v[e.b]);
        el("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: HID, "stroke-width": 1.4, "stroke-dasharray": "5 4" }, svg);
      });
      edgeItems.filter((x) => x.front).forEach(({ s, e }) => {
        const a = P(s.v[e.a]), b = P(s.v[e.b]);
        el("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: s.stroke || INK, "stroke-width": 2, "stroke-linecap": "round" }, svg);
      });

      const at = (ref) => (Array.isArray(ref) ? ref : (fig.pts && fig.pts[ref]) || solids.map((s) => s.v[ref]).find(Boolean));
      (fig.segs || []).forEach((g) => {
        const a = P(at(g.a)), b = P(at(g.b));
        el("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: g.color || "#d64545", "stroke-width": g.w || 2, "stroke-dasharray": g.dash ? "6 4" : "none" }, svg);
      });

      // pusat layar dari seluruh bangun, untuk mendorong label ke luar
      const cx = W / 2, cy = H / 2;
      const label = (x, y, t, color, bold, push) => {
        let dx = x - cx, dy = y - cy;
        const L = Math.hypot(dx, dy) || 1;
        const off = push ?? 14;
        const tx = x + (dx / L) * off, ty = y + (dy / L) * off;
        const txt = el("text", { x: tx, y: ty + 4, "text-anchor": "middle", fill: color || INK, "font-size": bold ? 15 : 13.5, "font-weight": bold ? 800 : 700,
          stroke: "#fff", "stroke-width": 4, "paint-order": "stroke", "stroke-linejoin": "round" }, svg);
        txt.textContent = t;
      };

      (fig.dims || []).forEach((d) => {
        const a = at(d.a), b = at(d.b);
        const m = P([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]);
        label(m.x, m.y, d.t, d.color || "#b4232a", false, d.push);
      });

      // titik bernama
      const named = fig.names || [];
      named.forEach((nm) => {
        const p = P(at(nm));
        el("circle", { cx: p.x, cy: p.y, r: 3.6, fill: PRI, stroke: "#fff", "stroke-width": 1.4 }, svg);
        label(p.x, p.y, nm, INK, true, 13);
      });
    }

    let drag = null;
    svg.addEventListener("pointerdown", (e) => { e.preventDefault(); drag = { x: e.clientX, y: e.clientY }; svg.setPointerCapture(e.pointerId); });
    svg.addEventListener("pointermove", (e) => {
      if (!drag) return;
      yaw -= (e.clientX - drag.x) * 0.01;
      pitch = Math.max(-0.15, Math.min(1.45, pitch + (e.clientY - drag.y) * 0.008));
      drag = { x: e.clientX, y: e.clientY };
      draw();
    });
    const end = () => { drag = null; };
    svg.addEventListener("pointerup", end);
    svg.addEventListener("pointercancel", end);
    new ResizeObserver(draw).observe(cv);
    draw();
  }

  RP.view = function (host, fig) {
    if (!fig) return;
    if (fig.type === "3d") view3d(host, fig); else view2d(host, fig);
  };
})();
