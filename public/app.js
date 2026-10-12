// app.js — fetches a report and renders the hierarchy map. No dependencies.
const $ = (id) => document.getElementById(id);
const form = $("form"), input = $("input"), results = $("results"),
      loading = $("loading"), step = $("step"), error = $("error"),
      tree = $("tree"), interview = $("interview"), scripts = $("scripts"),
      filter = $("filter");

const STEPS = ["Cloning repo…", "Counting files…", "Reading manifests…", "Detecting frameworks…", "Building map…"];
let stepTimer = null;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

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

  tree.innerHTML = report.tree.map((cat) => `
    <details class="node" open>
      <summary>${esc(cat.label)}<span class="count">${cat.children.length}</span></summary>
      <ul class="leaves">
        ${cat.children.map((k) => `
          <li data-text="${esc((k.t + " " + k.d + " " + k.e).toLowerCase())}">
            <span class="leaf-t">${esc(k.t)}</span>
            ${k.d ? `<span class="leaf-d"> — ${esc(k.d)}</span>` : ""}
            ${k.e ? `<span class="leaf-e">${esc(k.e)}</span>` : ""}
          </li>`).join("")}
      </ul>
    </details>`).join("");

  interview.innerHTML = report.interview.map((qa, i) => `
    <details${i < 2 ? " open" : ""}>
      <summary>${esc(qa.q)}</summary>
      <p>${esc(qa.a)}</p>
    </details>`).join("");

  const scriptCats = report.tree.filter((c) => c.label === "Scripts");
  const cmds = scriptCats.flatMap((c) => c.children);
  scripts.innerHTML = cmds.length
    ? cmds.map((c) => `<div class="cmd"><code>${esc(c.t)}</code><span>${esc(c.d)}</span></div>`).join("")
    : `<div class="cmd"><code>—</code><span>No runnable scripts detected. Check the README.</span></div>`;

  results.hidden = false;
  results.scrollIntoView({ behavior: "smooth", block: "start" });
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

$("example").addEventListener("click", loadExample);
$("expand").addEventListener("click", () =>
  tree.querySelectorAll("details").forEach((d) => (d.open = true)));
$("collapse").addEventListener("click", () =>
  tree.querySelectorAll("details").forEach((d) => (d.open = false)));

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
