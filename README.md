# learn-the-code

Paste a GitHub repo link, learn how it was built. Framework, language, libraries,
structure and run instructions — as a hierarchy map, plus the answers a technical
interviewer would demand from whoever made it.

Live example: open the app and it loads `berlified/livedocsxyz` immediately.

## Run

```sh
node server.js
# → http://localhost:3000
```

Node 20+. No dependencies, no install, no API keys.

## How it works

1. You paste `https://github.com/owner/repo` (or `owner/repo`).
2. The server shallow-clones it to a temp dir (`git clone --depth 1`).
3. `analyzer.js` statically inspects it — manifests, lockfiles, configs, file tree.
   No code is ever executed.
4. You get a report: summary badges, a roadmap-style board (yellow spine
   categories with dotted branches to findings, badge-coded by importance)
   and a 9-question "grill the builder" sheet.
5. The clone is deleted. `?repo=` URLs are shareable.

## Structure

```text
server.js        HTTP server + /api/analyze + static files (node builtins only)
analyzer.js      the analysis engine — knowledge base + report builder
public/          UI — index.html, styles.css, app.js (vanilla, no framework)
data/livedocs.json  pre-baked analysis so first paint is instant
```

## API

```sh
GET  /api/example                  # pre-baked livedocsxyz report
GET  /api/analyze?repo=<url>        # analyze any public GitHub repo
POST /api/analyze  { "repo": "<url>" }
GET  /health
```

Only public `github.com` repos. Analysis of a small repo takes a few seconds.
