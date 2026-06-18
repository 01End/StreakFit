# StreakFit — project instructions for Claude Code

StreakFit is a mobile-first, single-page fitness/calorie tracker. **Vanilla JS + HTML + CSS, no
build step, no backend, all state in `localStorage`.** Entry: `index.html` loads `js/*.js` (ordered;
`js/app.js` last and is the central `App` engine). Deployed to GitHub Pages.

## Always use graphify (this is required)

This repo has a persistent **graphify knowledge graph** in `graphify-out/` (gitignored) — nodes are
functions/concepts, edges are calls/shared-data/relationships, grouped into communities. Use it as
your map of the codebase instead of re-reading everything from scratch.

**Before you UNDERSTAND / explain / navigate anything** (how a feature works, what calls what, where
to make a change, tracing data flow): first query the graph —
```
/graphify query "<your question>"
```
Answer from what the graph returns (cite `source_location` when cited). Only fall back to reading
files directly if the graph is missing the detail.

**After you MODIFY code** (once a change or task's edits have landed): refresh the graph so it stays
true —
```
/graphify . --update
```
`--update` re-extracts only the changed files (AST for code is fast/free) and rebuilds `graph.json`
and `GRAPH_REPORT.md`. Don't rebuild after every keystroke — update once the edits for a unit of work
are in place.

**Quick lookups** (no full query needed):
```
python -m graphify explain "renderLogTab"      # a node + its neighbors
python -m graphify path "openPhotoLog" "App.state"   # shortest path between two nodes
```

Notes: the `graphify` CLI is not on PATH — run it as `python -m graphify …` (interpreter:
`C:\Python313\python.exe`, which has graphify installed). The graph already exists, so a query never
needs a rebuild.

## Project gotchas

- **Cache-busting:** local CSS/JS in `index.html` carry `?v=N` query params. When you edit an asset,
  **bump its `?v=`** — otherwise browsers (and the local preview server, which sends no cache headers)
  serve stale files. This has caused real "my code isn't updating" confusion.
- Food data is stored **per-100 g**; logged entries use the shape
  `{name, grams, kcal, protein, carbs, fats, sugar, fiber, sodium}` and `App.dayTotals()` sums them.
- `extractPlanJSON` (js/workouts.js) is the shared robust JSON parser reused by the photo + plan
  importers (strips ``` fences / prose).
