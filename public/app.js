// app.js — fetches a report and renders the hierarchy map. No dependencies.
const $ = (id) => document.getElementById(id);
const form = $("form"), input = $("input"), results = $("results"),
      loading = $("loading"), step = $("step"), error = $("error"),
      tree = $("tree"), interview = $("interview"), scripts = $("scripts"),
      filter = $("filter");

const STEPS = ["Cloning repo…", "Counting files…", "Reading manifests…", "Detecting frameworks…", "Building map…"];
let stepTimer = null;
let current = null;

const PALETTE = ["#7dd3fc", "#a5b4fc", "#c4b5fd", "#f0abfc", "#fda4af", "#fdba74",
                 "#fcd34d", "#86efac", "#6ee7b7", "#67e8f9", "#93c5fd"];

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
    return `<a class="leaf-e" href="${esc(href)}" target="_blank" rel="noopener">${esc(e)}</a>`;
  }
  return `<span class="leaf-e">${esc(e)}</span>`;
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

  tree.innerHTML = report.tree.map((cat, i) => `
    <details class="node" open style="--c:${PALETTE[i % PALETTE.length]}">
      <summary><span class="dot"></span><span class="caret">▶</span>${esc(cat.label)}<span class="count">${cat.children.length}</span></summary>
      <ul class="leaves">
        ${cat.children.map((k) => `
          <li data-text="${esc((k.t + " " + k.d + " " + k.e).toLowerCase())}">
            <span class="leaf-t">${esc(k.t)}</span>${k.d ? `<span class="leaf-d"> — ${esc(k.d)}</span>` : ""}${evidence(k.e, report.meta)}
          </li>`).join("")}
      </ul>
    </details>`).join("");

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
  // Retrigger entrance animation on repeat renders.
  results.style.animation = "none";
  requestAnimationFrame(() => {
    results.style.animation = "";
    results.scrollIntoView({ behavior: "smooth", block: "start" });
  });
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

$("expand").addEventListener("click", () =>
  tree.querySelectorAll("details").forEach((d) => (d.open = true)));
$("collapse").addEventListener("click", () =>
  tree.querySelectorAll("details").forEach((d) => (d.open = false)));

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
  tree.querySelectorAll(".node").forEach((node) => {
    let visible = 0;
    node.querySelectorAll("li").forEach((li) => {
      const hit = !q || li.dataset.text.includes(q);
      li.style.display = hit ? "" : "none";
      if (hit) visible++;
    });
    node.style.display = visible ? "" : "none";
    if (q && visible) node.open = true;
  });
});

// Deep link (?repo=…) or the livedocs example on first visit.
const params = new URLSearchParams(location.search);
if (params.get("repo")) {
  input.value = params.get("repo");
  analyze(params.get("repo"));
} else {
  loadExample();
}
