# DesignFlow AI

An AI-assisted garment design pipeline: turn a garment photo into a line sketch, apply a print/CAD fill, and render a 3D-looking product visual — with a human approval checkpoint at every stage.

**Garment photo → Line Sketch → CAD Fill → Minibody → Review**

> AI proposes; a human always decides. Nothing in the pipeline auto-advances — every AI output lands in front of a person before it becomes the input to the next stage.

Built as a local prototype for a Fullbeauty Brands (Woman Within) internship project, to validate the workflow end-to-end before investing in a production build.

## Why this exists

Garment design teams currently move from reference photo → hand sketch → CAD/print application → rendered visual across multiple disconnected tools, with no single place to see a design's history or branch off an earlier version. DesignFlow is a proof of concept for collapsing that into one pipeline where:

- Every stage keeps a **real generation history** (not just the latest state) — you can revert to any earlier sketch or render and branch from there.
- The two stages that benefit from generative AI (Sketch, Minibody) use it; the one stage that needs **exact, repeatable control** (CAD/print fill) deliberately does not.
- Every design is reusable at every stage — a past sketch, CAD fill, or garment photo can become the starting point for a new run instead of living in one linear pipeline.

## How the pipeline works

| Stage | What happens | AI involved? |
|---|---|---|
| **Garment** | Upload a product/reference photo, or reuse one from the library | No |
| **Line Sketch** | Converts the photo into a clean 2D line-art flat | Yes (Gemini) |
| **CAD Fill** | Applies a print/pattern onto the sketch, masked to the garment silhouette | No — parametric canvas compositing |
| **Minibody** | Renders the CAD-filled sketch as an image with realistic shading/drape/depth | Yes (Gemini) |
| **Review** | Keep or discard the run's outputs into the permanent library | No |

Each pipeline stage is a real page (`/sketch/[id]`, `/cad/[id]`, `/minibody/[id]`) that can be entered two ways: with an *upstream* asset as input (the normal forward flow), or with an asset that's *already* at that stage (arrived via "← Back", a library pick, or a direct upload). Both paths are fully editable — arriving at a stage never means a read-only dead end, you can always regenerate, add another CAD layer, or touch up further.

**Generation history is real, not cosmetic.** Sketch and Minibody keep every generation as a `parentId`-linked chain, not just an overwritten "current" image. Reverting to an earlier generation and regenerating again creates a real sibling branch — older branches aren't deleted, just no longer the active path (they're still reachable from that stage's Library page). This is what makes "keep 3 minibody variants from the same sketch" possible without extra plumbing.

## Design decisions, and why

**One interface and one design system across every stage.**
The whole system lives within one interface, collapsing four disconnected tools into a single workflow pipeline. Everything shares one design system: a dark navy background (#252525), cream text (#F2F2F2), the Geist typeface, and two accents (indigo #6366F1 for primary actions, orange #E87A3A for AI generations). These are defined once as reusable Tailwind tokens (tailwind.config.ts, globals.css) and reused on every screen instead of each page keeping its own variant. The layout is just as consistent: the same stage stepper across the top and the same keep/discard bar at the bottom of every stage. Moving from garment → sketch → CAD → minibody always feels like the same screen. Our prototype deliberately echoes the look of the internal tool the company already uses, reading as a cleaner, tidier version that can be easily adopted into the company’s existing workflows.

**No dead-ends: the UI is adapted to diverse user decisions (branch, revert, and/or re-enter).**
Every stage can be easily re-accessible and edited: no screen is a one-way dead end. You can move forward from the previous stage, step back with "← Back", or jump straight into any stage from the library or a new upload. However you get to a stage, there will always be the same controls: regenerating an AI output, adding another print layer, or going back to an earlier version. An earlier sketch or render in the library can be easily revisited and pulled back up as a live starting point instead of remaining in a frozen archive.

**Human checkpoint at every stage, no auto-advance.**
This is the core pitch, not an implementation detail — a brand team needs to approve a print placement or a rendered look before it becomes the next stage's input. Nothing in the app calls one AI stage and immediately feeds its output into the next.

**AI only where generation adds value; parametric tools where precision matters.**
Sketch and Minibody are generative because there's no ground truth to match — Gemini is proposing an interpretation. CAD Fill is the opposite: the print has to land *exactly* where placed, in the exact color, at the exact scale, every time. Generative image models can't currently guarantee that kind of pixel-precise, repeatable placement, so CAD Fill is deterministic canvas compositing (flood-fill masking + slider-controlled transforms) instead. This also makes CAD Fill instant and free — no API call, no generation latency.

**Minibody is a 2D image that *looks* 3D, not a 3D asset.**
It's a single Gemini call that adds shading/drape/depth to a flat CAD fill. It is explicitly **not** a 3D mesh, avatar, or output from a tool like CLO3D/Browzwear — that's a different (and much larger) scope of work. This prototype is testing whether a 2D "looks-3D" render is good enough for the early concept-review stage of the design process. This process is currently conducted in Creaitive Studio.

**Local JSON + flat files as the datastore.**
There's no multi-user or concurrent-access requirement in a single-person prototype, so a JSON file (`data/assets.json`) plus image files on disk was the fastest way to validate the pipeline logic itself. **This is the single biggest thing that needs to change before real deployment** — see [Known limitations](#known-limitations--production-gaps).

**Gemini called via direct REST, not the SDK.**
Kept the dependency surface small for a prototype with one call site (`lib/gemini.ts`). The model (`gemini-2.5-flash-image`) has a hard **~1024×1024px output cap** regardless of input resolution, and **zero free-tier quota** for image generation specifically (billing must be enabled on the Google Cloud project) — both are model constraints, not bugs, and both would need to be accounted for in any cost/quality planning for production.

**Prompts are deliberately short.**
`lib/prompts.ts` holds the default Sketch/Minibody prompts. A longer, more "detailed" version was tried and was worse in practice — it carried unfilled template placeholders (literal `[BRAND]`-style text) straight into the model. Short, concrete prompts outperformed a longer templated one here.

## Architecture

**Data model** — one `Asset` per generation/upload, chained via `parentId`:

```
Asset {
  id
  stage: 'garment' | 'sketch' | 'cad' | 'minibody'
  parentId          // links back through the pipeline; null at a chain root
  imageUrl           // derived — /api/images/{id}; bytes live at data/images/{stage}/{id}.png
  status: 'draft' | 'approved' | 'discarded'
  meta               // stage-specific (e.g. CAD layer summary), plus a `source` tag for provenance
  createdAt
}
```

Image bytes are never inlined as base64 in the store — `assets.json` holds only metadata and a relative path; actual files live under `data/images/{stage}/{id}.png` and are served through `/api/images/[id]`.

**CAD Fill masking** — the print has to stay inside the actual garment outline, not a bounding box. Each layer gets its own mask, built by BFS flood-fill over the sketch's enclosed white regions (bounded by the line art), with Brush/Erase tools writing to the same mask for manual touch-ups. A layer's print then composites onto its mask via `destination-in`, so multiple layers can carry completely different prints on different parts of the same garment (e.g. a tiled pattern on the body, a logo centered once on a sleeve).

**Print library** — prints aren't hardcoded; they're a small server-side library (`data/prints.json`) that anyone can add to by uploading an image from the CAD Fill picker. Seeded with a handful of flat placeholder SVGs plus a set of real product photos for demo variety.

**Chain-aware navigation** — `lib/chain.ts` walks the `parentId` graph to answer two different questions the UI needs: "what's the true upstream input for this stage's Source panel" (skip past same-stage regeneration hops) and "what's the furthest-along asset at each stage, for the stepper." Both the per-stage "← Back" targets and the dashboard's Recent Designs grouping are built on this.

## Tech stack

- **Next.js 14** (App Router) + **TypeScript** + **Tailwind CSS**
- **Gemini 2.5 Flash Image** (`gemini-2.5-flash-image`) for Sketch + Minibody generation, called via direct REST fetch
- Local JSON + flat image files as the store — no database
- No auth, no multi-user support (see limitations below)

## Getting started

```bash
npm install
```

Create `.env.local`:

```bash
GEMINI_API_KEY=your_key_here
```

Image generation requires **billing enabled** on the Google Cloud project — this model has no free-tier quota, unlike Gemini's text-only models.

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). If routes look stale after pulling changes that add new pages: `rm -rf .next && npm run dev`.

Optional seed scripts (all idempotent — safe to re-run):

```bash
npx tsx scripts/seed-sample-library.ts      # sample garment photos + print swatches
npx tsx scripts/seed-demo-placeholders.ts   # library placeholders + one full demo chain
npx tsx scripts/trim-cad-whitespace.ts      # trims margins on library CAD fill images
```

## Project layout

```
app/           # pages (one per pipeline stage) + API routes
components/    # shared UI (stepper, approval bar, tile rows, upload widgets)
lib/           # asset store, Gemini client, chain-walking helpers, flood-fill, prompts
data/          # assets.json (metadata), prints.json, images/{stage}/{id}.png
public/prints/ # default print SVGs + sample swatch images
scripts/       # seed data and one-off maintenance scripts
```

## Known limitations & production gaps

This is a prototype built to validate the workflow, not a hardened service — the following are known, not accidental, but they're exactly what would need to change before real deployment:

- **No database.** `data/assets.json` is read-modified-written on every change with no locking — concurrent requests can race and clobber each other's writes. Fine for one person clicking through a demo; not safe for concurrent users. This is the top priority for a production port (Postgres + real image storage/CDN, most likely).
- **No auth or multi-user model.** Anyone with the URL has full access to every asset. There's no concept of ownership, teams, or permissions.
- **No PLM / system-of-record integration.** This tool is scoped to create-and-approve; it doesn't push anywhere. A prior "Approval" stage with a mocked PLM badge was cut entirely because it implied an integration that doesn't exist.
- **CAD Fill's masks aren't persisted, only the flattened result.** Reopening a previously-filled CAD asset shows the prior fill as a flattened image plus a fresh empty layer on top — the original layer stack (per-layer masks, prints, placements) can't be reconstructed and re-edited individually.
- **No automated tests.** Verification so far has been manual, end-to-end, in-browser (including direct pixel-level canvas checks for the masking tools). There's no test suite to catch regressions.
- **No image processing pipeline for scale.** Every image round-trips as a full PNG; there's no thumbnailing, no lazy loading beyond what Next.js does by default, and library grids will get slow once asset counts grow well past demo volume.
- **Minor stale metadata:** a few older CAD assets reference print IDs from a since-replaced print set. Harmless — `meta.layers` is a non-authoritative summary, not something re-rendered from later — but worth a cleanup pass.
- **Gemini output is capped around 1024×1024px** regardless of input resolution — a model limitation, not something fixable via prompting. Any production use needs a plan for upscaling or accepting this ceiling.
- **Cost scales linearly with generations** (~$0.039/image at current Gemini pricing) — trivial at prototype volume, worth modeling explicitly before rolling out to a full design team.

## Explicitly out of scope

These were deliberately cut to keep the prototype focused on validating the pipeline shape itself:

- Real PLM/system-of-record integration
- Vector/Illustrator-style manual editing (Regenerate re-runs AI with an edited prompt; there's no node-level editing)
- ML-based garment segmentation (masking is user-driven flood-fill, not automatic)
- User accounts, auth, or permissions
