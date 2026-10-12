// analyzer.js — static analysis of a cloned repo. No network, no dependencies.
// Input: a local directory containing a git checkout. Output: a report object
// the frontend renders as a hierarchy map + interview sheet.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

// ---------------------------------------------------------------------------
// Repo URL parsing
// ---------------------------------------------------------------------------

export function parseRepoUrl(raw) {
  const input = String(raw ?? "").trim().replace(/\/+$/, "");
  if (!input) throw new Error("Missing repo URL.");

  // Accept "owner/repo" shorthand.
  if (/^[\w.-]+\/[\w.-]+$/.test(input) && !input.includes(":")) {
    const [owner, repo] = input.split("/");
    return { owner, repo: repo.replace(/\.git$/, ""), url: `https://github.com/${owner}/${repo}` };
  }

  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error("That doesn't look like a valid repo URL.");
  }
  if (url.hostname !== "github.com") throw new Error("Only github.com repos are supported right now.");

  const [, owner, repoRaw] = url.pathname.split("/");
  if (!owner || !repoRaw) throw new Error("URL should look like https://github.com/owner/repo.");
  const repo = repoRaw.replace(/\.git$/, "");
  return { owner, repo, url: `https://github.com/${owner}/${repo}` };
}

// ---------------------------------------------------------------------------
// Small filesystem helpers
// ---------------------------------------------------------------------------

const exists = (dir, rel) => fs.existsSync(path.join(dir, rel));

function readText(dir, rel) {
  try {
    return fs.readFileSync(path.join(dir, rel), "utf8");
  } catch {
    return null;
  }
}

function readJson(dir, rel) {
  const text = readText(dir, rel);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function gitFiles(dir) {
  try {
    const out = execFileSync("git", ["-C", dir, "ls-files"], { encoding: "utf8" });
    return out.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Languages
// ---------------------------------------------------------------------------

const LANG_BY_EXT = {
  ts: "TypeScript", tsx: "TypeScript", mts: "TypeScript", cts: "TypeScript",
  js: "JavaScript", jsx: "JavaScript", mjs: "JavaScript", cjs: "JavaScript",
  py: "Python", go: "Go", rs: "Rust", rb: "Ruby", java: "Java", kt: "Kotlin",
  php: "PHP", swift: "Swift", dart: "Dart", cs: "C#", cpp: "C++", c: "C", h: "C/C++",
  css: "CSS", scss: "SCSS", less: "Less", html: "HTML", vue: "Vue SFC", svelte: "Svelte",
  json: "JSON", yml: "YAML", yaml: "YAML", toml: "TOML", xml: "XML", sql: "SQL",
  sh: "Shell", md: "Markdown", mdx: "MDX", svg: "SVG", prisma: "Prisma Schema",
  tf: "Terraform", dockerfile: "Docker",
};

function analyzeLanguages(files) {
  const counts = new Map();
  for (const f of files) {
    const base = f.split("/").pop().toLowerCase();
    let lang = null;
    if (base === "dockerfile") lang = "Docker";
    else {
      const ext = f.includes(".") ? f.split(".").pop().toLowerCase() : "";
      lang = LANG_BY_EXT[ext] ?? null;
    }
    if (lang) counts.set(lang, (counts.get(lang) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((a, b) => a + b, 0) || 1;
  return [...counts.entries()]
    .map(([name, files]) => ({ name, files, pct: Math.round((files / total) * 100) }))
    .sort((a, b) => b.files - a.files);
}

// ---------------------------------------------------------------------------
// Dependency knowledge base (dependency name -> label)
// ---------------------------------------------------------------------------

const FRAMEWORK_DEPS = {
  next: "Next.js", nuxt: "Nuxt", gatsby: "Gatsby", astro: "Astro",
  "@remix-run/react": "Remix", "@sveltejs/kit": "SvelteKit", svelte: "Svelte",
  vue: "Vue", "@angular/core": "Angular", "@angular/cli": "Angular",
  express: "Express", fastify: "Fastify", "@nestjs/core": "NestJS", hono: "Hono", koa: "Koa",
  react: "React", "react-dom": "React", "react-native": "React Native", expo: "Expo",
  electron: "Electron", "@tauri-apps/api": "Tauri",
  "solid-js": "SolidJS", preact: "Preact", lit: "Lit", qwik: "Qwik",
};

const UI_DEPS = {
  tailwindcss: "Tailwind CSS", "@tailwindcss/postcss": "Tailwind CSS v4 tooling",
  "@mui/material": "Material UI", antd: "Ant Design", "@chakra-ui/react": "Chakra UI",
  "framer-motion": "Framer Motion", "lucide-react": "Lucide icons",
  "next-themes": "next-themes (dark mode)", "class-variance-authority": "class-variance-authority",
  clsx: "clsx", "tailwind-merge": "tailwind-merge", "styled-components": "styled-components",
  "@emotion/react": "Emotion", "@radix-ui/react-slot": "Radix Slot",
};

const CHART_DEPS = {
  recharts: "Recharts", d3: "D3", "chart.js": "Chart.js", "react-chartjs-2": "react-chartjs-2",
  three: "Three.js", victory: "Victory", echarts: "ECharts", "@nivo/core": "Nivo",
  "react-spring": "react-spring",
};

const DATA_DEPS = {
  prisma: "Prisma ORM", "@prisma/client": "Prisma Client", "drizzle-orm": "Drizzle ORM",
  mongoose: "Mongoose (MongoDB)", pg: "node-postgres", mysql2: "MySQL2",
  "better-sqlite3": "SQLite", redis: "Redis", ioredis: "Redis (ioredis)",
  "@supabase/supabase-js": "Supabase", firebase: "Firebase", "firebase-admin": "Firebase Admin",
  "@vercel/kv": "Vercel KV", "@upstash/redis": "Upstash Redis", "@neondatabase/serverless": "Neon",
};

const AUTH_DEPS = {
  "next-auth": "Auth.js (NextAuth)", "@clerk/nextjs": "Clerk", "@clerk/clerk-react": "Clerk",
  lucia: "Lucia Auth", "better-auth": "Better Auth", "@auth0/nextjs-auth0": "Auth0",
};

const TEST_DEPS = {
  vitest: "Vitest", jest: "Jest", playwright: "Playwright", "@playwright/test": "Playwright",
  cypress: "Cypress", "@testing-library/react": "Testing Library",
};

const QUALITY_DEPS = {
  eslint: "ESLint", prettier: "Prettier", "@biomejs/biome": "Biome",
  husky: "Husky (git hooks)", "lint-staged": "lint-staged",
};

// ---------------------------------------------------------------------------
// Main analysis
// ---------------------------------------------------------------------------

export function analyzeRepoDir(dir, { owner, repo, url, branch = "HEAD" } = {}) {
  const files = gitFiles(dir);
  const fileSet = new Set(files);
  const has = (rel) => fileSet.has(rel) || exists(dir, rel);

  // ---- manifests -----------------------------------------------------------
  const pkgPaths = files.filter((f) => f.endsWith("package.json") && !f.includes("node_modules"));
  const pkgs = pkgPaths.map((p) => ({ path: p, json: readJson(dir, p) })).filter((p) => p.json);
  const rootPkg = pkgs.find((p) => p.path === "package.json")?.json ?? pkgs[0]?.json ?? null;

  // Merge every workspace package.json so monorepos report fully.
  const deps = new Map(); // name -> { version, from }
  for (const { path: p, json } of pkgs) {
    for (const section of ["dependencies", "devDependencies", "peerDependencies"]) {
      for (const [name, version] of Object.entries(json[section] ?? {})) {
        if (!deps.has(name)) deps.set(name, { version: String(version), from: p });
      }
    }
  }
  const depVersion = (name) => deps.get(name)?.version.replace(/^[\^~>=< ]+/, "") ?? "";
  const inDeps = (...names) => names.find((n) => deps.has(n));

  // ---- languages ------------------------------------------------------------
  const languages = analyzeLanguages(files);
  const primaryLang = languages[0]?.name ?? "Unknown";
  const codeFiles = files.filter((f) => /\.(tsx?|jsx?|mjs|cjs|py|go|rs|rb|java|kt|php|swift|dart|vue|svelte)$/.test(f)).length;

  // ---- runtime / package manager -------------------------------------------
  const nvmrc = readText(dir, ".nvmrc")?.trim();
  const enginesNode = rootPkg?.engines?.node ?? null;
  const pkgManagerField = rootPkg?.packageManager ?? null;
  const packageManager = pkgPaths.length
    ? has("pnpm-lock.yaml") ? `pnpm${pkgManagerField ? ` (${pkgManagerField})` : ""}`
      : has("yarn.lock") ? "Yarn"
        : has("bun.lockb") || has("bun.lock") ? "Bun"
          : has("package-lock.json") ? "npm" : "npm (no lockfile found)"
    : null;

  const isMonorepo = has("pnpm-workspace.yaml") || !!rootPkg?.workspaces || has("turbo.json") || has("lerna.json") || has("nx.json");
  const monorepoTool = has("pnpm-workspace.yaml") ? "pnpm workspaces"
    : rootPkg?.workspaces ? "npm workspaces"
      : has("turbo.json") ? "Turborepo" : has("nx.json") ? "Nx" : has("lerna.json") ? "Lerna" : null;
  const usesTurbo = has("turbo.json");

  // ---- frameworks ------------------------------------------------------------
  const frameworks = [];
  for (const [dep, label] of Object.entries(FRAMEWORK_DEPS)) {
    if (deps.has(dep) && !frameworks.some((f) => f.label === label)) {
      frameworks.push({ label, version: depVersion(dep), evidence: deps.get(dep).from });
    }
  }
  // The repo can BE the framework (express doesn't depend on express).
  const selfName = (rootPkg?.name ?? "").replace(/^@[^/]+\//, "");
  if (selfName && FRAMEWORK_DEPS[selfName] && !frameworks.some((f) => f.label === FRAMEWORK_DEPS[selfName])) {
    frameworks.unshift({
      label: FRAMEWORK_DEPS[selfName],
      version: rootPkg.version ?? "",
      evidence: "package.json → name (this repo is the framework)",
    });
  }
  // Non-JS frameworks via manifest text search.
  const manifestHits = (rel, keywords) => {
    const text = readText(dir, rel);
    if (!text) return [];
    return keywords.filter((k) => new RegExp(`\\b${k}\\b`, "i").test(text));
  };
  for (const hit of manifestHits("requirements.txt", ["django", "flask", "fastapi"])) {
    frameworks.push({ label: hit[0].toUpperCase() + hit.slice(1), version: "", evidence: "requirements.txt" });
  }
  if (has("pyproject.toml")) {
    for (const hit of manifestHits("pyproject.toml", ["django", "flask", "fastapi"])) {
      if (!frameworks.some((f) => f.label.toLowerCase() === hit)) {
        frameworks.push({ label: hit[0].toUpperCase() + hit.slice(1), version: "", evidence: "pyproject.toml" });
      }
    }
  }
  if (has("go.mod")) {
    for (const hit of manifestHits("go.mod", ["gin-gonic/gin", "labstack/echo", "gofiber/fiber"])) {
      frameworks.push({ label: hit.split("/").pop(), version: "", evidence: "go.mod" });
    }
  }

  const isNext = frameworks.some((f) => f.label === "Next.js");
  const appRouter = isNext && (has("app/layout.tsx") || has("apps/docs/app/layout.tsx") || files.some((f) => /(^|\/)app\/layout\.tsx$/.test(f)));
  const reactVersion = depVersion("react");
  const shadcn = readJson(dir, "components.json");
  const radixPkgs = [...deps.keys()].filter((d) => d.startsWith("@radix-ui/"));
  const tailwindVersion = depVersion("tailwindcss");

  // ---- workspace packages ------------------------------------------------------
  const workspaces = [];
  for (const { path: p, json } of pkgs) {
    if (p === "package.json") continue;
    workspaces.push({
      name: json.name ?? p,
      description: json.description ?? "",
      path: p.split("/").slice(0, -1).join("/"),
      isApp: /^(apps?)\//.test(p),
    });
  }

  // ---- CI / deploy / docker -------------------------------------------------------
  const ciWorkflows = files
    .filter((f) => f.startsWith(".github/workflows/") && f.endsWith(".yml") || f.startsWith(".github/workflows/") && f.endsWith(".yaml"))
    .map((f) => f.split("/").pop());
  const deploys = [];
  if (has("vercel.json") || inDeps("@vercel/analytics", "@vercel/kv")) deploys.push({ label: "Vercel", evidence: has("vercel.json") ? "vercel.json" : "uses @vercel/* packages" });
  if (has("netlify.toml")) deploys.push({ label: "Netlify", evidence: "netlify.toml" });
  if (has("Dockerfile")) deploys.push({ label: "Docker", evidence: "Dockerfile" });
  if (has("fly.toml")) deploys.push({ label: "Fly.io", evidence: "fly.toml" });
  if (has("render.yaml")) deploys.push({ label: "Render", evidence: "render.yaml" });
  if (has("wrangler.toml")) deploys.push({ label: "Cloudflare Workers", evidence: "wrangler.toml" });
  if (has("app.yaml")) deploys.push({ label: "Google App Engine", evidence: "app.yaml" });
  if (has("Procfile")) deploys.push({ label: "Heroku-style (Procfile)", evidence: "Procfile" });

  // ---- one-liner --------------------------------------------------------------------
  const readme = readText(dir, "README.md") ?? "";
  const readmeTitle = (readme.match(/^#\s+(.+)$/m) ?? [])[1]?.trim() ?? null;
  const oneLiner = rootPkg?.description
    ?? readme.split("\n").map((l) => l.trim()).find((l) => l && !l.startsWith("#") && !l.startsWith("[") && !l.startsWith("!") && !l.startsWith("<"))
    ?? readmeTitle ?? "No description provided.";

  // ---- repo type ----------------------------------------------------------------------
  let repoType = "Project";
  if (shadcn) repoType = "shadcn Component Registry";
  else if (has("action.yml") || has("action.yaml")) repoType = "GitHub Action";
  else if (selfName && FRAMEWORK_DEPS[selfName]) repoType = `${FRAMEWORK_DEPS[selfName]} (the framework itself)`;
  else if (isNext) repoType = appRouter ? "Next.js App (App Router)" : "Next.js App";
  else if (rootPkg?.bin) repoType = "CLI Tool";
  else if (inDeps("express", "fastify", "@nestjs/core", "hono", "koa")) repoType = "API Server";
  else if (has("go.mod")) repoType = "Go Module";
  else if (has("Cargo.toml")) repoType = "Rust Crate";
  else if (has("pyproject.toml") || has("setup.py")) repoType = "Python Package";

  // ---------------------------------------------------------------------------
  // Hierarchy tree
  // ---------------------------------------------------------------------------
  const pick = (map, evidenceLabel) =>
    Object.entries(map)
      .filter(([dep]) => deps.has(dep))
      .map(([dep, label]) => ({
        t: label,
        d: depVersion(dep) ? `v${depVersion(dep)}` : "declared",
        e: `${deps.get(dep).from}`,
      }));

  const tree = [];

  // 1. Runtime & language
  {
    const kids = [];
    if (enginesNode || nvmrc) kids.push({ t: `Node.js ${enginesNode ?? nvmrc}`, d: enginesNode ? "required engine" : "pinned via .nvmrc", e: enginesNode ? "package.json → engines" : ".nvmrc" });
    for (const l of languages.slice(0, 6)) {
      kids.push({ t: l.name, d: `${l.files} files · ${l.pct}%`, e: "counted from tracked files" });
    }
    const tsconfig = readJson(dir, "tsconfig.json") ?? readJson(dir, "tsconfig.base.json");
    if (tsconfig) kids.push({ t: `TypeScript (strict: ${tsconfig.compilerOptions?.strict ? "on" : "off"})`, d: "type safety config", e: "tsconfig*.json" });
    if (packageManager) kids.push({ t: packageManager, d: "package manager", e: "lockfile + packageManager field" });
    tree.push({ label: "Runtime & Language", children: kids });
  }

  // 2. Framework
  {
    const kids = frameworks.map((f) => ({
      t: f.version ? `${f.label} ${f.version}` : f.label,
      d: f.label === "Next.js" && appRouter ? "App Router + React Server Components" : f.label === "React" && reactVersion ? `v${reactVersion}` : "framework",
      e: f.evidence,
    }));
    if (isNext && appRouter) kids.push({ t: "App Router", d: "file-based routing, layouts, RSC", e: "app/layout.tsx" });
    if (shadcn?.rsc) kids.push({ t: "React Server Components", d: "shadcn configured for RSC", e: "components.json → rsc" });
    if (!kids.length) kids.push({ t: "No app framework detected", d: "library, tooling or static files", e: "no framework deps found" });
    tree.push({ label: "Framework", children: kids });
  }

  // 3. UI system
  {
    const kids = pick(UI_DEPS);
    if (inDeps("tailwindcss")) {
      const v4 = tailwindVersion.startsWith("4");
      kids.unshift({ t: `Tailwind CSS v${tailwindVersion}`, d: v4 ? "v4, CSS-first config (@import \"tailwindcss\")" : "utility-first styling", e: deps.get("tailwindcss").from });
    }
    if (shadcn) {
      kids.unshift({
        t: `shadcn (${shadcn.style ?? "default"} style)`,
        d: `base: ${shadcn.tailwind?.baseColor ?? "—"} · icons: ${shadcn.iconLibrary ?? "—"}`,
        e: "components.json",
      });
    }
    if (radixPkgs.length) {
      kids.push({ t: `Radix Primitives × ${radixPkgs.length}`, d: radixPkgs.map((r) => r.replace("@radix-ui/", "")).join(", "), e: "package.json deps" });
    }
    if (inDeps("@vercel/analytics")) kids.push({ t: "Vercel Analytics", d: "pageview tracking", e: deps.get("@vercel/analytics").from });
    if (kids.length) tree.push({ label: "UI System", children: kids });
  }

  // 4. Charts & visualization
  {
    const kids = pick(CHART_DEPS);
    if (kids.length) tree.push({ label: "Charts & Visualization", children: kids });
  }

  // 5. Backend / data / auth
  {
    const kids = [...pick(DATA_DEPS), ...pick(AUTH_DEPS)];
    if (has("prisma/schema.prisma")) kids.push({ t: "Prisma schema", d: "database models defined in-repo", e: "prisma/schema.prisma" });
    const honestNone = kids.length === 0;
    if (honestNone) {
      kids.push({
        t: "No backend, database or auth detected",
        d: isNext ? "static/SSR frontend — data ships as files or client-side state" : "no server-side persistence in this repo",
        e: "no db/auth deps, no schema files",
      });
    }
    tree.push({ label: "Backend · Data · Auth", children: kids });
  }

  // 6. Distribution — how other people consume this
  {
    const kids = [];
    const registryDir = has("registry") ? "registry" : files.some((f) => f.startsWith("apps/docs/public/r/")) ? "apps/docs/public/r" : null;
    if (shadcn) {
      kids.push({
        t: "shadcn registry (`npx shadcn add …`)",
        d: `consumers copy source into their own @/components/ui — vendor, don't depend`,
        e: registryDir ? `${registryDir}/ (+ components.json)` : "components.json",
      });
    }
    if (rootPkg?.bin) {
      kids.push({ t: `CLI (${Object.keys(rootPkg.bin).join(", ")})`, d: "installable command", e: "package.json → bin" });
    }
    if (rootPkg && rootPkg.private !== true && rootPkg.name && pkgPaths.length) {
      kids.push({ t: `${rootPkg.name}@${rootPkg.version ?? "0.0.0"}`, d: "publishable package", e: "package.json (not private)" });
    } else if (rootPkg?.private) {
      kids.push({ t: "Not published to npm", d: "private monorepo — consumed via git / deploy, not install", e: "package.json → private" });
    }
    if (kids.length) tree.push({ label: "Distribution", children: kids });
  }

  // 7. Workspace structure
  if (isMonorepo || workspaces.length) {
    const kids = [];
    if (monorepoTool) kids.push({ t: monorepoTool, d: usesTurbo ? "orchestrated with Turborepo" : "workspace layout", e: "pnpm-workspace.yaml / turbo.json" });
    for (const w of workspaces) {
      kids.push({ t: w.name, d: `${w.isApp ? "app" : "package"}${w.description ? ` — ${w.description}` : ""}`, e: w.path });
    }
    tree.push({ label: "Workspace Structure", children: kids });
  }

  // 8. Quality & automation
  {
    const kids = pick(QUALITY_DEPS);
    const hasTests = ["vitest", "jest", "playwright", "@playwright/test", "cypress", "@testing-library/react", "pytest", "phpunit", "rspec"].some((d) => deps.has(d))
      || ["test", "tests", "__tests__", "spec", "specs"].some((d) => has(d))
      || files.some((f) => /\.test\.(ts|tsx|js)$/.test(f) || /\.spec\.(ts|tsx|js)$/.test(f));
    kids.push(hasTests
      ? { t: "Tests present", d: "test runner or test files found", e: "deps / test files" }
      : { t: "No test runner configured", d: "quality rests on types + lint + CI", e: "no test deps or *.test.* files" });
    for (const w of ciWorkflows) kids.push({ t: `CI: ${w}`, d: "runs on push/PR", e: `.github/workflows/${w}` });
    if (!ciWorkflows.length && !has(".gitlab-ci.yml")) {
      kids.push({ t: "No CI config found", d: "no automated checks in-repo", e: "no .github/workflows" });
    }
    tree.push({ label: "Quality & Automation", children: kids });
  }

  // 9. Deployment
  {
    const kids = deploys.map((d) => ({ t: d.label, d: "hosting signal", e: d.e }));
    const homepage = rootPkg?.homepage;
    if (homepage) kids.unshift({ t: homepage.replace(/^https?:\/\//, "").replace(/\/$/, ""), d: "live site", e: "package.json → homepage" });
    if (kids.length) tree.push({ label: "Deployment", children: kids });
  }

  // 10. File structure
  {
    const topCounts = new Map();
    for (const f of files) {
      const top = f.includes("/") ? f.split("/")[0] : "(root)";
      topCounts.set(top, (topCounts.get(top) ?? 0) + 1);
    }
    const kids = [...topCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)
      .map(([dirName, count]) => ({ t: dirName, d: `${count} files`, e: "tracked file tree" }));
    tree.push({ label: `File Structure (${files.length} files)`, children: kids });
  }

  // 11. Scripts
  {
    const scripts = rootPkg?.scripts ?? {};
    const kids = Object.entries(scripts).slice(0, 10).map(([name, cmd]) => ({ t: `pnpm ${name}`, d: String(cmd).slice(0, 90), e: "package.json → scripts" }));
    const docsPkg = pkgs.find((p) => /apps\/.+\/package\.json$/.test(p.path))?.json;
    if (docsPkg?.scripts?.dev && !scripts.dev) {
      kids.unshift({ t: "pnpm dev", d: String(docsPkg.scripts.dev).slice(0, 90), e: "apps/*/package.json → scripts" });
    }
    if (kids.length) tree.push({ label: "Scripts", children: kids });
  }

  // ---------------------------------------------------------------------------
  // Interview sheet — what a technical person would grill the builder about
  // ---------------------------------------------------------------------------

  const interview = [
    {
      q: "What does this project actually do?",
      a: `${readmeTitle ? `“${readmeTitle}.” ` : ""}${oneLiner} It is a ${repoType.toLowerCase()}.`,
    },
    {
      q: "What language is it written in?",
      a: languages.length
        ? `Mostly ${languages[0].name} (${languages[0].pct}% of tracked files), with ${languages.slice(1, 4).map((l) => `${l.name} ${l.pct}%`).join(", ") || "nothing else significant"}. ~${codeFiles} source files.`
        : "Couldn't determine the language mix.",
    },
    {
      q: "What framework, and why does that choice matter?",
      a: frameworks.length
        ? `Built on ${frameworks.map((f) => `${f.label}${f.version ? ` ${f.version}` : ""}`).join(" + ")}. ${isNext ? "Next.js gives file-based routing, server components and a static-export-friendly docs site in one deployable unit." : "That choice defines the runtime and deployment model."}`
        : "No app framework — this is a library/tooling repo, so consumers bring their own runtime.",
    },
    {
      q: "How is the code organized?",
      a: isMonorepo
        ? `A ${monorepoTool} monorepo with ${workspaces.length} workspace(s): ${workspaces.map((w) => w.name).join(", ")}. Apps live under apps/, shared code under packages/ — classic separation of deployables vs. reusables.`
        : `A single package with ${files.length} tracked files. Top folders: ${[...new Set(files.map((f) => f.split("/")[0]))].slice(0, 6).join(", ")}.`,
    },
    {
      q: "How do I run it locally?",
      a: packageManager
        ? `Requires ${enginesNode ? `Node ${enginesNode}` : nvmrc ? `Node ${nvmrc}` : "Node 20+"} and ${packageManager.split(" ")[0]}. Install, then \`${Object.keys(rootPkg?.scripts ?? {})[0] ? `pnpm ${Object.keys(rootPkg.scripts)[0]}` : "pnpm dev"}\` — full commands are in the Scripts section below.`
        : "Check the README — no standard JS/Python/Go entry point was detected.",
    },
    {
      q: "Where does data come from? Is there a backend?",
      a: tree.find((c) => c.label.startsWith("Backend"))?.children[0]?.t.startsWith("No backend")
        ? "There is no backend, database or auth in this repo. It's a frontend/distribution project — data ships as static files or lives in client state."
        : `Persistence/auth layer: ${tree.find((c) => c.label.startsWith("Backend"))?.children.map((k) => k.t).join(", ")}.`,
    },
    {
      q: "How do other developers consume this?",
      a: tree.find((c) => c.label === "Distribution")
        ? tree.find((c) => c.label === "Distribution").children.map((k) => `${k.t} — ${k.d}`).join(" ")
        : "It's an end product, not a dependency: clone it or visit the deployed site.",
    },
    {
      q: "How is quality enforced?",
      a: `${tsconfigNote(dir, rootPkg)}${ciWorkflows.length ? ` CI runs ${ciWorkflows.join(", ")} on every push.` : " No CI workflows found — checks only run locally."}`,
    },
    {
      q: "Where does it deploy?",
      a: deploys.length
        ? `Hosting signals point to ${deploys.map((d) => d.label).join(", ")}${rootPkg?.homepage ? `, live at ${rootPkg.homepage}` : ""}.`
        : "No hosting config detected — likely deployed manually or via git-based hosting.",
    },
  ];

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------

  const summary = {
    name: owner && repo ? `${owner}/${repo}` : rootPkg?.name ?? "repo",
    url: url ?? null,
    oneLiner,
    type: repoType,
    badges: [
      { k: "Language", v: primaryLang },
      { k: "Framework", v: frameworks[0] ? `${frameworks[0].label}${frameworks[0].version ? ` ${frameworks[0].version}` : ""}` : "None (library)" },
      { k: "Type", v: repoType },
      ...(packageManager ? [{ k: "Package manager", v: packageManager.split(" (")[0] }] : []),
      ...(tailwindVersion ? [{ k: "Styling", v: `Tailwind v${tailwindVersion}${shadcn ? " + shadcn" : ""}` }] : []),
      ...(inDeps("recharts", "d3", "chart.js", "three") ? [{ k: "Visualization", v: pick(CHART_DEPS)[0]?.t ?? "charts" }] : []),
    ].slice(0, 6),
    stats: [
      { k: "Files", v: String(files.length) },
      { k: "Languages", v: String(languages.length) },
      { k: "Dependencies", v: String(deps.size) },
      { k: "Workspaces", v: String(workspaces.length || (isMonorepo ? "—" : "1")) },
    ],
  };

  return {
    meta: { owner, repo, url, branch, analyzedAt: new Date().toISOString(), totalFiles: files.length },
    summary,
    tree,
    interview,
  };
}

function tsconfigNote(dir, rootPkg) {
  const ts = readJson(dir, "tsconfig.json") ?? readJson(dir, "tsconfig.base.json") ?? readJson(dir, "apps/docs/tsconfig.json");
  const parts = [];
  if (ts) parts.push(`TypeScript with strict mode ${ts.compilerOptions?.strict ? "on" : "off"}`);
  else if (rootPkg) parts.push("no root tsconfig found");
  const hasEslint = exists(dir, "eslint.config.mjs") || exists(dir, ".eslintrc.json") || exists(dir, "eslint.config.js");
  if (hasEslint) parts.push("ESLint");
  const hasPrettier = exists(dir, ".prettierrc") || exists(dir, "prettier.config.js");
  if (hasPrettier) parts.push("Prettier");
  return parts.length ? parts.join(", ") + "." : "No type/lint config found.";
}
