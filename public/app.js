// app.js — fetches a report and renders a draggable roadmap canvas. No dependencies.
const $ = (id) => document.getElementById(id);
const form = $("form"), input = $("input"), results = $("results"),
      loading = $("loading"), step = $("step"), error = $("error"),
      board = $("board"), viewport = $("viewport"), world = $("world"),
      svg = $("links"), nodesEl = $("nodes"),
      interview = $("interview"), scripts = $("scripts"), filter = $("filter");

const STEPS = ["Cloning repo…", "Counting files…", "Reading manifests…", "Detecting frameworks…", "Building map…"];
let stepTimer = null;
let current = null;

const KIND_META = {
  core: { label: "Key finding", mark: "✓" },
  alt: { label: "Supporting detail", mark: "✓" },
  info: { label: "Heads-up", mark: "!" },
};

function kindOf(catLabel, k, i) {
  if (/^(no |not published|—)/i.test(k.t)) return "info";
  if (i === 0 && /^(Runtime|Framework|UI System|Charts|Distribution|Workspace|Deployment)/.test(catLabel)) return "core";
  return "alt";
}

// Blue spine nodes are real outbound links (repo, live site, file tree, CI).
function spineLink(catLabel, cat, meta) {
  if (!meta?.url) return null;
  if (catLabel.startsWith("Deployment")) {
    const site = cat.children[0];
    if (site && /^[a-z0-9.-]+\.[a-z]{2,}(\/.*)?$/i.test(site.t)) return "https://" + site.t;
  }
  if (catLabel.startsWith("File Structure")) return `${meta.url}/tree/${meta.branch || "HEAD"}`;
  if (catLabel.startsWith("Quality") && cat.children.some((k) => k.t.startsWith("CI:"))) {
    return `${meta.url}/actions`;
  }
  return null;
}

const LANG_COLORS = {
  TypeScript: "#3178c6", JavaScript: "#f1e05a", Python: "#3572A5", Go: "#00ADD8",
  Rust: "#dea584", Ruby: "#701516", Java: "#b07219", Kotlin: "#A97BFF", PHP: "#4F5D95",
  Swift: "#F05138", Dart: "#00B4AB", CSS: "#563d7c", SCSS: "#c6538c", HTML: "#e34c26",
  Shell: "#89e051", SQL: "#e38c00", JSON: "#8a8a8a", YAML: "#8a8a8a", TOML: "#8a8a8a",
  Markdown: "#083fa1", MDX: "#083fa1", "Vue SFC": "#41b883", Svelte: "#ff3e00",
  "C#": "#178600", "C++": "#f34b7d", "C/C++": "#555555", Dockerfile: "#384d54",
  "Prisma Schema": "#5a67d8", Terraform: "#844FBA", XML: "#0060ac",
};
const langColor = (name) => LANG_COLORS[name] ?? "#71717a";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Only real file paths become source links; prose stays text.
function evidence(e, meta) {
  if (!e) return "";
  const looksFile = /^[\w.\-@/]+(\/[\w.\-@/]+)*$/.test(e) && /[./]/.test(e);
  if (looksFile && meta?.url) {
    const href = `${meta.url}/blob/${meta.branch || "HEAD"}/${e}`;
    return `<a class="k-e" href="${esc(href)}" target="_blank" rel="noopener">${esc(e)}</a>`;
  }
  return `<span class="k-e dim">${esc(e)}</span>`;
}

function setLoading(on) {
  loading.hidden = !on;
  if (on) {
    let i = 0;
    step.textContent = STEPS[0];
    stepTimer = setInterval(() => { i = (i + 1) % STEPS.length; step.textContent = STEPS[i]; }, 1400);
  } else clearInterval(stepTimer);
}

function showError(msg) {
  error.textContent = msg;
  error.hidden = !msg;
}

// --- canvas world -------------------------------------------------------------
const WORLD_W = 1160, SPINE_X = 580, KID_W = 250, SPINE_W = 250;
const COL_GAP = 120, KID_H = 78, KID_GAP = 12, CAT_GAP = 64;
const LEFT_X = SPINE_X - COL_GAP - KID_W, RIGHT_X = SPINE_X + COL_GAP;
const SPINE_X0 = SPINE_X - SPINE_W / 2;

let view = { x: 0, y: 0, z: 1 };
let worldH = 800;
let items = []; // { el, x, y, w, h, kind: 'spine'|'kid', cat, link, hidden }

function applyView() {
  world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.z})`;
}

function fitView() {
  const vw = viewport.clientWidth;
  const z = Math.min(1, vw / WORLD_W);
  view = { x: (vw - WORLD_W * z) / 2, y: 16, z };
  applyView();
}

function zoomAt(cx, cy, factor) {
  const rect = viewport.getBoundingClientRect();
  const sx = cx - rect.left, sy = cy - rect.top;
  const wx = (sx - view.x) / view.z, wy = (sy - view.y) / view.z;
  const z = Math.min(2.5, Math.max(0.25, view.z * factor));
  view.x = sx - wx * z;
  view.y = sy - wy * z;
  view.z = z;
  applyView();
}

// Recompute every node position from visibility state, then redraw wires.
function layout() {
  let y = 46;
  const place = (it, x, yy) => {
    it.x = x; it.y = yy;
    it.el.style.left = x + "px";
    it.el.style.top = yy + "px";
    it.el.style.display = it.hidden ? "none" : "";
  };

  for (const it of items.filter((n) => n.kind === "title")) {
    if (!it.hidden) { place(it, SPINE_X - it.w / 2, y); y += it.h + 56; }
    else it.el.style.display = "none";
  }

  const cats = [...new Set(items.filter((n) => n.kind === "spine").map((n) => n.cat))];
  for (const cat of cats) {
    const spine = items.find((n) => n.kind === "spine" && n.cat === cat);
    const kids = items.filter((n) => n.kind === "kid" && n.cat === cat && !n.hidden);
    if (spine.hidden && !kids.length) { spine.el.style.display = "none"; continue; }
    spine.el.style.display = "";
    const left = kids.filter((_, i) => i % 2 === 1);
    const right = kids.filter((_, i) => i % 2 === 0);
    const rows = Math.max(left.length, right.length);
    const budget = rows === 0 ? spine.h : Math.max(spine.h, rows * KID_H + (rows - 1) * KID_GAP);
    const cy = y + budget / 2;
    place(spine, SPINE_X0, cy - spine.h / 2);
    const stack = (list, x) => {
      const total = list.length * KID_H + Math.max(0, list.length - 1) * KID_GAP;
      let yy = cy - total / 2;
      for (const k of list) { place(k, x, yy); yy += KID_H + KID_GAP; }
    };
    stack(left, LEFT_X);
    stack(right, RIGHT_X);
    for (const k of items.filter((n) => n.kind === "kid" && n.cat === cat && n.hidden)) {
      k.el.style.display = "none";
    }
    y += budget + CAT_GAP;
  }

  for (const it of items.filter((n) => n.kind === "end")) {
    if (!it.hidden) { place(it, SPINE_X - it.w / 2, y); y += it.h + 46; }
    else it.el.style.display = "none";
  }

  worldH = y;
  world.style.width = WORLD_W + "px";
  world.style.height = worldH + "px";
  svg.setAttribute("width", WORLD_W);
  svg.setAttribute("height", worldH);
  svg.setAttribute("viewBox", `0 0 ${WORLD_W} ${worldH}`);
  drawLinks();
}

function drawLinks() {
  const NS = "http://www.w3.org/2000/svg";
  svg.innerHTML = "";
  const vis = (n) => !n.hidden && n.el.style.display !== "none";
  const line = (d, solid) => {
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", d);
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", "#2563eb");
    p.setAttribute("stroke-width", solid ? 3.5 : 2.5);
    if (!solid) {
      p.setAttribute("stroke-dasharray", "0.5 8");
      p.setAttribute("stroke-linecap", "round");
    }
    svg.appendChild(p);
  };

  const spineNodes = items.filter((n) => (n.kind === "spine" || n.kind === "title" || n.kind === "end") && vis(n));
  const centers = spineNodes.map((n) => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 }));
  if (centers.length > 1) {
    line("M " + centers.map((p) => `${p.x} ${p.y}`).join(" L "), true);
  }

  for (const s of items.filter((n) => n.kind === "spine" && vis(n))) {
    const nx = s.x + s.w / 2, ny = s.y + s.h / 2;
    for (const k of items.filter((n) => n.kind === "kid" && n.cat === s.cat && vis(n))) {
      const kx = k.x + k.w / 2, ky = k.y + k.h / 2;
      const x2 = kx > nx ? k.x - 5 : k.x + k.w + 5;
      const mx = (nx + x2) / 2;
      line(`M ${nx} ${ny} C ${mx} ${ny}, ${mx} ${ky}, ${x2} ${ky}`, false);
    }
  }
}

// --- pan / zoom / drag ----------------------------------------------------------
{
  const pointers = new Map();
  let mode = null, moved = 0, pinchD0 = 0, pinchZ0 = 1;
  let dragItem = null, startPX = 0, startPY = 0, itemX0 = 0, itemY0 = 0;

  viewport.addEventListener("pointerdown", (e) => {
    if (e.target.closest("a")) return; // let links work
    viewport.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = 0;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchD0 = Math.hypot(a.x - b.x, a.y - b.y);
      pinchZ0 = view.z;
      mode = "pinch";
      dragItem = null;
      return;
    }
    const nodeEl = e.target.closest(".wnode");
    if (nodeEl) {
      dragItem = items.find((n) => n.el === nodeEl);
      itemX0 = dragItem.x; itemY0 = dragItem.y;
      startPX = e.clientX; startPY = e.clientY;
      mode = "node";
    } else {
      mode = "pan";
      startPX = e.clientX - view.x; startPY = e.clientY - view.y;
      viewport.classList.add("panning");
    }
  });

  viewport.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    moved += Math.abs(e.clientX - prev.x) + Math.abs(e.clientY - prev.y);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (mode === "pinch" && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const rect = viewport.getBoundingClientRect();
      const wx = (mx - rect.left - view.x) / view.z, wy = (my - rect.top - view.y) / view.z;
      view.z = Math.min(2.5, Math.max(0.25, pinchZ0 * (d / pinchD0)));
      view.x = mx - rect.left - wx * view.z;
      view.y = my - rect.top - wy * view.z;
      applyView();
      return;
    }
    if (mode === "pan") {
      view.x = e.clientX - startPX;
      view.y = e.clientY - startPY;
      applyView();
    } else if (mode === "node" && dragItem) {
      dragItem.x = itemX0 + (e.clientX - startPX) / view.z;
      dragItem.y = itemY0 + (e.clientY - startPY) / view.z;
      dragItem.el.style.left = dragItem.x + "px";
      dragItem.el.style.top = dragItem.y + "px";
      requestAnimationFrame(drawLinks);
    }
  });

  const up = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2 && mode === "pinch") mode = null;
    if (pointers.size === 0) {
      // Treat as click when barely moved: follow node links.
      if (mode === "node" && dragItem && moved < 6) {
        if (dragItem.link) window.open(dragItem.link, "_blank", "noopener");
        else if (dragItem.kind === "end") $("scripts").scrollIntoView({ behavior: "smooth" });
      }
      mode = null;
      dragItem = null;
      viewport.classList.remove("panning");
    }
  };
  viewport.addEventListener("pointerup", up);
  viewport.addEventListener("pointercancel", up);

  viewport.addEventListener("wheel", (e) => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12);
  }, { passive: false });

  $("zin").addEventListener("click", () => {
    const r = viewport.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.25);
  });
  $("zout").addEventListener("click", () => {
    const r = viewport.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1 / 1.25);
  });
  $("zreset").addEventListener("click", () => { layout(); fitView(); });
}

// --- render ----------------------------------------------------------------------
function buildBoard(report) {
  nodesEl.innerHTML = "";
  items = [];
  const add = (cls, html, meta) => {
    const el = document.createElement("div");
    el.className = `wnode ${cls}`;
    el.innerHTML = html;
    el.querySelectorAll("a").forEach((a) => { a.draggable = false; });
    nodesEl.appendChild(el);
    const it = { el, x: 0, y: 0, w: 0, h: 0, hidden: false, ...meta };
    items.push(it);
    return it;
  };

  const titleLink = report.meta?.url ?? null;
  add("spine-node title-node" + (titleLink ? " link" : ""),
    `${esc(report.summary.name)}<small>${esc(report.summary.type)}</small>`,
    { kind: "title", w: 300, h: 64, link: titleLink });

  for (const cat of report.tree) {
    const link = spineLink(cat.label, cat, report.meta);
    add("spine-node" + (link ? " link" : ""),
      `${esc(cat.label)}<small>${cat.children.length} finding${cat.children.length === 1 ? "" : "s"}</small>`,
      { kind: "spine", cat: cat.label, w: SPINE_W, h: 60, link });
    cat.children.forEach((k, j) => {
      const kind = kindOf(cat.label, k, j);
      add("kid",
        `<span class="badge-dot ${kind}" title="${KIND_META[kind].label}">${KIND_META[kind].mark}</span>
         <div class="k-t">${esc(k.t)}</div>
         ${k.d ? `<div class="k-d">${esc(k.d)}</div>` : ""}
         ${evidence(k.e, report.meta)}`,
        { kind: "kid", cat: cat.label, w: KID_W, h: KID_H });
    });
  }

  add("spine-node end-node", `Run it yourself<small>commands below ↓</small>`,
    { kind: "end", w: 280, h: 60 });

  // Measure real spine heights (kids are fixed), then lay out + fit.
  requestAnimationFrame(() => {
    for (const it of items) {
      if (it.kind === "kid") continue;
      it.h = it.el.offsetHeight || it.h;
      it.w = it.el.offsetWidth || it.w;
    }
    layout();
    fitView();
  });
}

function render(report) {
  current = report;
  document.title = `${report.summary.name} — learn-the-code`;
  $("r-type").textContent = report.summary.type;
  $("r-name").innerHTML = report.summary.url
    ? `<a href="${esc(report.summary.url)}" target="_blank" rel="noopener">${esc(report.summary.name)}</a>`
    : esc(report.summary.name);
  $("r-one").textContent = report.summary.oneLiner;
  $("r-badges").innerHTML = report.summary.badges
    .map((b) => `<span class="badge"><span>${esc(b.k)}</span><b>${esc(b.v)}</b></span>`).join("");
  $("r-stats").innerHTML = report.summary.stats
    .map((s) => `<div><b>${esc(s.v)}</b><span>${esc(s.k)}</span></div>`).join("");

  if (report.languages?.length) {
    $("r-langs").hidden = false;
    $("r-langbar").innerHTML = report.languages
      .map((l) => `<i style="width:${l.pct}%;background:${langColor(l.name)}" title="${esc(l.name)} ${l.pct}%"></i>`).join("");
    $("r-langlegend").innerHTML = report.languages
      .map((l) => `<span><b style="background:${langColor(l.name)}"></b>${esc(l.name)} <em>${l.pct}%</em></span>`).join("");
  } else {
    $("r-langs").hidden = true;
  }

  buildBoard(report);

  interview.innerHTML = report.interview.map((qa, i) => `
    <details${i < 2 ? " open" : ""}>
      <summary>${esc(qa.q)}</summary>
      <p>${esc(qa.a)}</p>
    </details>`).join("");

  const cmds = report.tree.filter((c) => c.label === "Scripts").flatMap((c) => c.children);
  scripts.innerHTML = cmds.length
    ? cmds.map((c) => `<div class="cmd"><code>${esc(c.t)}</code><span>${esc(c.d)}</span></div>`).join("")
    : `<div class="cmd"><code>—</code><span>No runnable scripts detected. Check the README.</span></div>`;

  filter.value = "";
  results.hidden = false;
  results.scrollIntoView({ behavior: "smooth", block: "start" });
}

function toMarkdown(r) {
  const lines = [
    `# ${r.summary.name}`,
    `${r.summary.oneLiner}`,
    ``,
    ...r.summary.badges.map((b) => `- **${b.k}:** ${b.v}`),
    ``,
    ...r.tree.flatMap((c) => [`## ${c.label}`, ...c.children.map((k) => `- **${k.t}**${k.d ? ` — ${k.d}` : ""}${k.e ? ` (\`${k.e}\`)` : ""}`), ``]),
    `## Grill the builder`,
    ...r.interview.flatMap((qa) => [`**${qa.q}**`, qa.a, ``]),
    `_Analyzed ${r.meta.analyzedAt} from ${r.meta.url} (${r.meta.branch})._`,
  ];
  return lines.join("\n");
}

async function analyze(repo) {
  showError("");
  setLoading(true);
  try {
    const res = await fetch(`/api/analyze?repo=${encodeURIComponent(repo)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Analysis failed.");
    render(data);
    history.replaceState(null, "", `/?repo=${encodeURIComponent(repo)}`);
  } catch (err) {
    showError(err.message);
  } finally {
    setLoading(false);
  }
}

async function loadExample() {
  showError("");
  setLoading(true);
  try {
    const data = await (await fetch("/api/example")).json();
    render(data);
  } catch {
    showError("Could not load the example.");
  } finally {
    setLoading(false);
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const repo = input.value.trim();
  if (!repo) return showError("Paste a GitHub repo URL first.");
  analyze(repo);
});

document.querySelectorAll(".chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    if (chip.dataset.instant) return loadExample();
    input.value = chip.dataset.repo;
    analyze(chip.dataset.repo);
  });
});

$("expand").addEventListener("click", () => {
  filter.value = "";
  items.forEach((n) => { n.hidden = false; });
  layout();
});
$("collapse").addEventListener("click", () => {
  items.forEach((n) => { n.hidden = n.kind === "kid"; });
  layout();
});

$("copy").addEventListener("click", async (e) => {
  if (!current) return;
  try {
    await navigator.clipboard.writeText(toMarkdown(current));
    e.target.textContent = "Copied";
    setTimeout(() => (e.target.textContent = "Copy markdown"), 1600);
  } catch {
    showError("Clipboard blocked by the browser.");
  }
});

filter.addEventListener("input", () => {
  const q = filter.value.trim().toLowerCase();
  const textOf = (n) => (n.el.dataset.text ?? n.el.textContent.toLowerCase());
  items.forEach((n) => {
    if (n.kind !== "kid") return;
    if (!n.el.dataset.text) {
      n.el.dataset.text = n.el.textContent.toLowerCase();
    }
    n.hidden = !!q && !textOf(n).includes(q);
  });
  // Hide spine nodes whose whole branch is filtered out.
  const cats = [...new Set(items.filter((n) => n.kind === "spine").map((n) => n.cat))];
  for (const cat of cats) {
    const any = items.some((n) => n.kind === "kid" && n.cat === cat && !n.hidden);
    items.find((n) => n.kind === "spine" && n.cat === cat).hidden = q ? !any : false;
  }
  layout();
});

// Deep link (?repo=…) or the livedocs example on first visit.
const params = new URLSearchParams(location.search);
if (params.get("repo")) {
  input.value = params.get("repo");
  analyze(params.get("repo"));
} else {
  loadExample();
}
