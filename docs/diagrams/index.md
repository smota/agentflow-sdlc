# Diagrams

Maintained diagrams for AgentFlow SDLC, with the source material needed to refine them.

Each diagram is a committed asset in `assets/` plus a specification document here. The
specification is authoritative: it records the canonical values the diagram renders, the citation
for each value, and the render brief. Refine the specification first, then regenerate the asset, so
a diagram can never drift from the model it claims to describe without the drift being visible in a
diff.

| Diagram        | Asset                                 | Specification                       |
| -------------- | ------------------------------------- | ----------------------------------- |
| Governance map | `assets/agentflow-governance-map.svg` | [Governance map](governance-map.md) |

## Conventions

- Assets are standalone SVG: no external fonts, no scripts, no raster images, no `<foreignObject>`.
  They must render identically in a browser, in Inkscape, and in GitHub's Markdown renderer.
- The palette comes from `assets/agentflow-docs-banner.svg`: navy `#061943`, navy-mid `#0b2f61`,
  teal-deep `#0b796f`, teal `#159e8f`, teal-light `#36c7b2`, mint `#d8f6f1`, coral `#ff674d`.
  Coral is reserved for stops, gates, and anything a person must decide.
- Every string rendered in a diagram must be a canonical value traceable to a manifest, schema, or
  library module, cited in the specification. Diagrams do not paraphrase the model.
- No text below 8.5px. Diagrams are read at full width, but they are also read on a laptop.

## Refining a diagram

1. Edit the specification's canonical-values tables, re-verifying each citation against the current
   source. A value that no longer matches its citation is a bug in the diagram, not in the source.
2. Edit the render brief in the same document to describe the change.
3. Regenerate the asset from the brief and replace the file in `assets/`.
4. Check the rendered result at full width: no overlapping text, nothing outside the viewBox, and
   every column grid still aligned.
5. Run `pnpm validate:docs` and `pnpm format:check`.
