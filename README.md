# Pipeline Truth

A free forecast health check for Salesforce opportunity exports. Drop in a CSV and see how much open pipeline sits on stale or missing data: past-due close dates, no next step, no recent activity, deals stuck in a stage, missing amounts. Results are broken down by stage, owner and forecast category, with a downloadable fix list.

- **Private by design:** the CSV is parsed in the browser (PapaParse) and never uploaded.
- **Transparent:** the checks are simple rules, documented on `build.html#method`.
- **Optional AI brief:** `api/summary.js` (Vercel function, Claude API) receives only aggregated numbers, with rep names replaced by labels.

## Run locally
Any static server works for the tool, for example `npx serve .`. The AI brief needs `ANTHROPIC_API_KEY` set on the Vercel project. Without it, the endpoint returns a clear 503 and the rest of the page works.

## Structure
- `index.html`, `assets/app.js`: the health check
- `assets/demo.js`: synthetic demo pipeline (all values generated)
- `build.html`: product notes (problem, users, spec, AI decisions, metrics, method)
- `api/summary.js`: AI brief endpoint

Independent project. Not affiliated with Salesforce or any CRM vendor.
