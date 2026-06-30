# Quant Forge

Self-contained dark-themed practice + adaptive diagnostic tool for SQL, probability, statistics, and aptitude interview prep.

- **▶ Run** — correctness check. SQL executes for real in-browser via PGlite (no backend, no key). Quant answers checked numerically with tolerance.
- **⌕ Evaluate** — LLM judge diagnoses *method/reasoning*, returns verdict + progressive hint + weakness tags. Needs the Anthropic API key.
- Weakness profile, proficiency levels, trends, and "drill my weak spots" all run client-side in localStorage.

## Deploy (GitHub → Vercel)

1. Push this repo to GitHub.
2. In Vercel: **Add New → Project → Import** the repo. Framework preset: **Other**. No build command needed.
3. **Settings → Environment Variables**: add `ANTHROPIC_API_KEY`.
4. Deploy. Redeploy after adding the key so the serverless function picks it up.

SQL Run + quant Check work with no key — only ⌕ Evaluate calls the API.

## Local dev

```bash
vercel dev
```

Use `vercel dev` (or any static server) rather than opening `index.html` via `file://` — the PGlite ES-module CDN import is blocked under `file://`.

## Structure

```
index.html        # the whole app
api/judge.js       # Vercel serverless judge proxy (reads ANTHROPIC_API_KEY)
vercel.json        # function config
package.json       # ESM flag for the function
```
