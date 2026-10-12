// app.js — fetches a report and renders the roadmap board. No dependencies.
const $ = (id) => document.getElementById(id);
const form = $("form"), input = $("input"), results = $("results"),
      loading = $("loading"), step = $("step"), error = $("error"),
      board = $("board"), svg = $("links"), cats = $("cats"),
      interview = $("interview"), scripts = $("scripts"), filter = $("filter");

const STEPS = ["Cloning repo…", "Counting files…", "Reading manifests…", "Detecting frameworks…", "Building map…"];
let stepTimer = null;
let current = null;

const KIND_META = {
  core: { label: "Key finding", mark: "✓" },
  alt: { label: "Supporting detail", mark: "✓" },
  info: { label: "Heads-up", mark: "!" },
};

// First headline item per major category is the key finding;
// "No X / Not published" notes are heads-ups; everything else supports.
function kindOf(catLabel, k, i) {
  if (/^(no |not published|—)/i.test(k.t)) return "info";
  if (i === 0 && /^(Runtime|Framework|UI System|Charts|Distribution|Workspace|Deployment)/.test(catLabel)) return "core";
  return "alt";
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

// --- roadmap connectors ------------------------------------------------------
let drawQueued = false;
function queueDraw() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => { drawQueued = false; drawLinks(); });
}

function drawLinks() {
  const NS = "http://www.w3.org/2000/svg";
  svg.innerHTML = "";
  if (board.offsetWidth < 760) {
    svg.setAttribute("width", 0);
    svg.setAttribute("height", 0);
    return;
  }
  const W = board.offsetWidth, H = board.offsetHeight;
  svg.setAttribute("width", W);
  svg.setAttribute("height", H);
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);

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

  const nodes = [...cats.querySelectorAll(".spine-node")].filter(
    (n) => n.closest(".cat").style.display !== "none");
  const centers = nodes.map((n) => ({
    x: n.offsetLeft + n.offsetWidth / 2,
    y: n.offsetTop + n.offsetHeight / 2,
  }));
  if (centers.length > 1) {
    line("M " + centers.map((p) => `${p.x} ${p.y}`).join(" L "), true);
  }

  cats.querySelectorAll(".cat").forEach((cat) => {
    if (cat.style.display === "none") return;
    const node = cat.querySelector(".spine-node");
    const nx = node.offsetLeft + node.offsetWidth / 2;
    const ny = node.offsetTop + node.offsetHeight / 2;
    cat.querySelectorAll(".kid").forEach((kid) => {
      if (kid.style.display === "none") return;
      const left = kid.offsetLeft, right = left + kid.offsetWidth;
      const ky = kid.offsetTop + kid.offsetHeight / 2;
      const onRight = left + kid.offsetWidth / 2 > nx;
      const x2 = onRight ? left - 5 : right + 5;
      const mx = (nx + x2) / 2;
      line(`M ${nx} ${ny} C ${mx} ${ny}, ${mx} ${ky}, ${x2} ${ky}`, false);
    });
  });
}

new ResizeObserver(queueDraw).observe(board);
if (document.fonts?.ready) document.fonts.ready.then(queueDraw);

// --- render -------------------------------------------------------------------
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

  cats.innerHTML = report.tree.map((cat, i) => {
    const kids = cat.children.map((k, j) => {
      const kind = kindOf(cat.label, k, j);
      return `<div class="kid" data-text="${esc((k.t + " " + k.d + " " + k.e).toLowerCase())}">
        <span class="badge-dot ${kind}" title="${KIND_META[kind].label}">${KIND_META[kind].mark}</span>
        <div class="k-t">${esc(k.t)}</div>
        ${k.d ? `<div class="k-d">${esc(k.d)}</div>` : ""}
        ${evidence(k.e, report.meta)}
      </div>`;
    }).join("");
    // Alternate: even categories branch right, odd branch left.
    const cells = i % 2 === 0
      ? `<div class="side"></div><div class="spine-cell"><div class="spine-node">${esc(cat.label)}<small>${cat.children.length} finding${cat.children.length === 1 ? "" : "s"}</small></div></div><div class="side">${kids}</div>`
      : `<div class="side">${kids}</div><div class="spine-cell"><div class="spine-node">${esc(cat.label)}<small>${cat.children.length} finding${cat.children.length === 1 ? "" : "s"}</small></div></div><div class="side"></div>`;
    return `<section class="cat">${cells}</section>`;
  }).join("");

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
  board.classList.remove("collapsed");
  results.hidden = false;
  queueDraw();
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
  board.classList.remove("collapsed");
  queueDraw();
});
$("collapse").addEventListener("click", () => {
  board.classList.add("collapsed");
  queueDraw();
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
  cats.querySelectorAll(".cat").forEach((cat) => {
    let visible = 0;
    cat.querySelectorAll(".kid").forEach((kid) => {
      const hit = !q || kid.dataset.text.includes(q);
      kid.style.display = hit ? "" : "none";
      if (hit) visible++;
    });
    cat.style.display = visible ? "" : "none";
  });
  queueDraw();
});

// Deep link (?repo=…) or the livedocs example on first visit.
const params = new URLSearchParams(location.search);
if (params.get("repo")) {
  input.value = params.get("repo");
  analyze(params.get("repo"));
} else {
  loadExample();
}
