# Hierarchical Diagram Sets

A Diagram Set is an explicit, opt-in manifest around independently valid native
Archify diagrams. It does not change schema-v1 nodes, boundaries, guided views,
or the single-diagram render/deliver/finalize contracts.

## Commands and delivery

Run from your working directory using the installed Skill's CLI path:

```sh
node bin/archify.mjs validate-set examples/diagram-set/set.json --json
node bin/archify.mjs bundle examples/diagram-set/set.json platform.html --json
node bin/archify.mjs bundle examples/diagram-set/canvas.json canvas.html --json
node bin/archify.mjs bundle examples/diagram-set/many-relations.json dense.html --json
node bin/archify.mjs bundle examples/diagram-set/cross-type.json typed.html --json
node bin/archify.mjs bundle examples/diagram-set/set.json platform.html --cache-dir .archify-cache --json
```

Both commands accept `--quality standard|showcase` and `--repo-root <path>`.
They freeze the manifest and every native source, validate references, render
each diagram with its existing renderer, and check each native artifact before
reporting success. `validate-set` leaves no HTML output. `bundle` atomically
publishes one self-contained HTML only after every diagram passes. Failed
validation/render/check/publication returns a non-zero exit and `ok: false`;
the previous HTML remains intact. Output paths cannot alias an input.

The JSON receipt includes `diagnostics[]`, per-diagram `checks`, source hashes,
resolved `projections`, and (for bundle) the final artifact path, SHA-256 and byte
count. A successful bundle proves compilation and native artifact checks, not
browser or perceptual review. The set commands do not issue single-diagram
delivery provenance or a `finalize` receipt. Use them for set delivery, not the
single-SVG `check`/`finalize` commands on the outer Host HTML.

Open the HTML directly from disk. No web server, sibling JSON files, external
scripts, CDN, or live installation is required. Recompile to incorporate an
edited diagram or manifest; the delivered HTML is immutable data, not an editor.
Identical native script/style blocks (including embedded fonts, translations
and the bridge) are stored once in a shared resource table. Each diagram stores
its own markup and ordered resource references, not another full Viewer payload.
Opening an entrance restores its exact native `srcdoc` and injects a fresh
document credential. No external script/font URLs or relaxed sandbox permissions
are introduced. This reduces bundle size, not the number of isolated execution
contexts: every opened iframe still runs its native Viewer independently.

### Incremental recompilation

`--cache-dir <directory>` opts into a private local cache. The first run renders
all diagrams; an unchanged run reuses native HTML and projection results.
Changing one diagram rerenders only that diagram. Changing facts or declarations
invalidates only affected native-edge projections; the new manifest and bridge
data are always rebuilt. Native artifacts are checked even on cache hits.
Without this flag, compilation checks and renders every diagram.

Receipts expose `incremental.reused` / `recomputed` for per-diagram projections,
`nativeReused` / `nativeRendered`, `cacheEnabled` and `nativeCacheBypass`.
Renderer, schema, template, quality-profile and Node changes invalidate native
entries. `--repo-root` or `ARCHIFY_REPO_ROOT` bypasses native reuse to revalidate
repository evidence; a cached render never proves that external code stayed
unchanged.

Use a new or empty directory owned by the current user, not a shared or untrusted
cache. Non-empty unmanaged directories are refused. Entries are authenticated
against their kind and exact input/runtime signature with a private local key;
corruption, symlinks and hard-linked entries produce actionable errors, not
silent cache misses. Do not copy or publish the private identity file. Repair
only the named corrupt entry, or explicitly remove your managed cache before
recompiling. Bundle output must stay outside this cache namespace.

## Authoring and identities

Read [`diagram-set.schema.json`](../schemas/diagram-set.schema.json). The packaged
[`set.json`](../examples/diagram-set/set.json) is a three-layer example with three
Frontend-to-Backend facts and a second internal/outgoing chain. The
[`many-relations.json`](../examples/diagram-set/many-relations.json) example has a
12-fact bundle and deliberately unresolved parent edges. These are fictional
authored fixtures, not evidence about a real product.

[`canvas.json`](../examples/diagram-set/canvas.json) is the in-place canvas example.
Expand **Backend**, then **Web Frontend** (pan or use Fit to reach the other node).
Its four HTTPS facts start as one coarse Frontend-to-Backend group, split into two
endpoint groups when one side opens, and four Web Shell/Checkout App-to-Gateway/
Orders groups when both sides open. Gateway can then open authentication in the
same canvas. Collapsing either side refolds the same four source IDs; it never
invents or duplicates facts. [`canvas.html`](../examples/diagram-set/canvas.html)
is the packaged offline version; the repository's `examples/diagram-set/output.html`
opens this example.

1. Inventory entities and directed relationship facts first. Assign stable
   canonical `relations[].id` values and `NodeRef = { diagram, node }` endpoints.
   Use IDs, never labels, coordinates, or array indices, to join data.
2. Partition the diagrams into a rooted tree. Each detail diagram has exactly
   one entrance; each entrance opens at most one detail diagram. Root-only sets
   are valid. Cycles, shared children, missing diagrams and orphans fail.
3. Author each native diagram using its unchanged type schema and renderer.
   Give every edge incident to a drilldown entrance a durable authored `id`.
4. Declare parent `projections` and optional boundary `interfaces`; then
   validate, repair the diagnostics, and bundle. Do not invent detail endpoints
   to make a warning disappear.

Sources are portable, relative `.json` paths beneath the manifest directory.
Absolute/drive/UNC paths, URLs, backslashes, dot segments, device names, duplicate
physical sources and symlink escapes are rejected. Input limits are 32 diagrams,
1,000 semantic nodes per diagram, 5,000 canonical relations, 4 MiB per JSON file,
10,000 typed correspondences, 32 MiB total JSON and 96 MiB generated HTML.

`evidence.mode` is `authored`, `assumption` or `verified-source`.
`verified-source` requires non-empty `references` (such as a pinned commit and
file/line citation). These citations remain author-supplied provenance; the set
validator checks their structure, not the underlying repository claim. Native
repository evidence still uses the existing `--repo-root` verification contract.
Expose assumptions as assumptions. Missing detail is not verified evidence.

## Parent projections and boundary ports

```json
{
  "diagram": "system",
  "relation_id": "frontend_to_backend",
  "derived_from": ["rel-login", "rel-orders", "rel-upload"],
  "status": "resolved"
}
```

`relation_id` is an authored native edge ID in a supported semantic adapter. Each listed fact
must fold through legal owners to the parent edge's source and target, in that
direction. Optional `kind`, `protocol` and `scope` constrain compatibility.
Duplicate sources, missing endpoints, reversed mappings and conflicting owners
fail with actionable diagnostics.

`projectionPolicy: "derived"` computes sources from canonical facts instead of
maintaining a second authored list. It does not infer transitive calls: A→B→C
never becomes a new A→C fact. Reverse facts in the same scope need a separate
authored reverse parent edge. Different directions, kinds, protocols and scopes
stay separate in visible bundles. Each fact is counted once per view and its
source ID survives folding and expansion.
Only relationships collapsed into the same ancestor are hidden; direct local
self-relations retain their source IDs and native semantics.

`projectionPolicy: "manual"` means a conceptual relationship, not a verified
aggregation; it may not claim `derived_from`. Omitted declarations on parent
edges incident to detail entrances are explicitly `unresolved`.

| Status | Meaning |
| --- | --- |
| `resolved` | The non-empty mapping accounts for all compatible canonical facts. |
| `partial` | Known sources exist, but the author declares incompleteness or compatible facts are omitted. |
| `unresolved` | No detail mapping, or a manual conceptual edge. |

Legacy plan status `declared` is accepted as a request to resolve the supplied
mapping, not as a separate runtime status. Conflicts are errors, never a silently
corrected direction. `partial`/`unresolved` warnings are included in receipts and
shown in the Viewer. Unknown detail ends at an explicit boundary, not a guessed
internal node. Independent known facts may still be explored without claiming
they resolve an unrelated conceptual edge.

An `interfaces[]` entry names a child `diagram`, its exact parent `owner`, and
`ports` with stable IDs, `direction: "in"|"out"`, `kind`, `targets` and `side`.
One node/kind/direction selects at most one port. Ports control display anchoring;
they do not manufacture sources or relationship facts.

## Explicit cross-type correspondence

Architecture supports dependency folding directly. Other types remain
navigation-only unless the author declares `semantic_mappings` for every
canonical fact's non-Architecture endpoint:

```json
{
  "relation_id": "typed-dataflow",
  "diagram": "dataflow",
  "edge_id": "web-clickstream",
  "semantics": "data-flow",
  "explanation": "Authored boundary correspondence; this flow transports the declared input."
}
```

The canonical fact and stable native edge must exist; semantics must match the
diagram type and legal representatives must match the edge's directed endpoints.
An external endpoint is permitted only with an explicit explanation. Each fact
has at most one correspondence per diagram. A non-Architecture parent projection
also requires a per-fact correspondence to that exact edge; another mapping in
the diagram does not enable automatic equivalence.

This is authored correspondence, not verification of code or an inference from
similar labels. Workflow control, sequence message order, data-flow transport
and lifecycle transitions remain native. The five-kind
[`cross-type.json`](../examples/diagram-set/cross-type.json) demonstrates these
contracts and deliberately leaves unrelated native edges unresolved.

## Viewer behavior and export scope

- One world coordinate space and one unbounded-pan camera contain the main
  diagram and every open child. Clicking an entrance node (or pressing Enter on
  its canvas target) lazily initializes its native scene. The child is centered
  inside the original node rectangle with uniform scale
  `min(ownerWidth / childWidth, ownerHeight / childHeight)`. The shared camera
  magnifies the main graph by the inverse world scale, capped by viewport fit;
  authored parent positions do not move. This is in-place expansion, not a
  replacement page or a separate foreground panel.
- Multiple sibling entrances may stay open simultaneously. Nested children
  remain inside their owners, and all ancestors stay in the same world.
  Ancestors and children remain sharp and fully opaque; only the old entrance
  nodes and incident native edges are hidden so they cannot duplicate the new
  endpoints. Node targets and projected endpoints use the native card shape,
  not the SVG group's decorative bounds. Entrance badges are added only after
  fonts and native layout settle. Only opened scenes are mounted;
  closing an entrance unloads its descendants, not unrelated siblings.
- Drag anywhere in the canvas, including over a node or edge, to move the
  entire world. Wheel zoom is anchored under the pointer; touch supports pan
  and two-pointer pinch. `+`/`-`, the small camera controls and `F`/Fit use the
  same camera. Arrow keys pan when the canvas is focused. The `x` on an open
  node's caption, or Escape when the inspector is closed, collapses that
  entrance. Breadcrumbs focus an ancestor without discarding open siblings.
- URLs retain the focused hierarchy and the complete open forest:
  `#path=system%2Fbackend&open=backend%2Cfrontend`. Legacy path-only URLs still
  open their ancestor chain. Browser history and refresh restore entrances;
  invalid paths return to root with an explicit warning. Browser history also
  retains the shared camera. No network fetch is needed: lazy scene loading
  means initializing embedded, prevalidated native HTML on demand.
- Every canonical endpoint is folded only as far as its deepest exposed
  owner. Opening one side splits one-to-many; opening both sides exposes
  many-to-many. Direction, kind, protocol and scope remain separate. Internal
  facts hidden inside a collapsed owner appear when that owner opens, not as
  false ancestor self-edges. Counts and fact IDs stay conserved across every
  expansion state.
- Same-endpoint facts are bundled by default. Separating a group draws
  individual facts; selecting one fact shows only it plus the remainder.
  Existing unchanged native edges keep their authored routes, without a
  duplicate overlay. Unknown/partial native mappings end at the explicit
  owner boundary rather than a guessed child node. Expanded canonical edges
  move with the actual node rectangles through pan/zoom/resize. Offscreen
  endpoints remain in world space, not substituted by floating proxy nodes.
- **Relations** is optional and docked outside the canvas, never on top of
  components. On narrow screens it occupies a separate bottom row. Coarse
  endpoint groups contain exposed endpoint branches, then named facts.
  Stable IDs, evidence and mapping links are collapsed under **Source and
  hierarchy**, rather than repeated at every level. Filters and global search
  remain available without an always-visible developer toolbar. Unselected
  individual edge labels use hover titles; selected/bundled edges show captions.
  Filters affect canonical overlays and lists, not authored native SVG; badges
  still distinguish visible counts from full provenance (`x2 / 3`).
- Standalone Viewer toolbars, native indexes/legends and the old Host
  Back/Root/detail-picker/export/share/theme toolbar are not shown in canvas
  mode. Native single-diagram pages remain unchanged. Integrations can use
  `ArchifyDiagramSet.exportCurrent('svg'|'png')` for clean native exports or
  `exportComposite()` for the current canvas viewport, including clear ancestors
  and fact overlays but no inspector or controls. A composition is refused
  while the view is moving or changes during capture. Editable combined SVG
  remains unsupported.

The Host and child communicate over source-bound, per-instance token-checked
messages; opaque `file://` origins alone are never trusted. Child Viewers are
given their reply credential only inside their initial trusted `srcdoc`, never
in outbound messages that could reach a redirected document. Unexpected frame
navigation disables the scene with an explicit error. Saved relationship
restoration does not reset the canvas's canonical filters. Child Viewers are
sandboxed without `allow-same-origin`. All manifest display strings enter text
nodes or escaped JSON, not executable markup. Reduced-motion users get immediate
transitions. Legacy `viewer.transition: "frosted-glass"` and `viewer.blur_px`
remain accepted for input compatibility but no longer blur or dim scenes,
including composed exports.
Aggregate/detail transitions interpolate world endpoints for 220 ms using stable
source IDs, including reverse aggregation. The shared camera eases for 260 ms;
new gestures interrupt it. Reduced motion disables both animations. Unchanged
native edges are never temporarily redrawn as a different curve.

## Capability matrix and remaining boundaries

| Type | Semantic navigation entrance | Automatic cross-level relation expansion |
| --- | --- | --- |
| Architecture | `components[].id` | Dependency folding from explicit facts; declared/derived projections |
| Workflow | `nodes[].id` | Explicit `control` correspondences only |
| Sequence | `participants[].id` | Explicit `interaction` correspondences only; ordering is preserved |
| Data Flow | `nodes[].id` | Explicit `data-flow` correspondences only |
| Lifecycle | `states[].id` | Explicit `transition` correspondences only, including a non-Architecture root |

The implementation covers all three phases: navigation/packaging, canonical
directed folding and provenance, ancestor/view caches, incremental compilation,
typed opt-in correspondences and fact-preserving morphing. Shared-detail DAGs,
unconditional cross-type equivalence, automatic parent relayout and an interactive
editing API are outside this contract, not silently approximated.
No frame-rate guarantee, Safari/Firefox acceptance or real-business trial use is
implied by the Chrome regression.

## Maintainer checks

From `archify/`:

```sh
npm run generate:validators
npm run generate:viewer
node --test test/diagram-set.test.mjs test/generate-viewer.test.mjs
ARCHIFY_CHROME="/path/to/chrome" node --test test/diagram-set-browser.test.mjs
```

The browser suite is also part of the shared `npm run test:browser` gate. Set
`ARCHIFY_DIAGRAM_SET_EVIDENCE` to an output directory to retain
root/in-place/sibling/nested/docked-inspector/mobile, typed and medium-fixture screenshots,
plus a measured `benchmark.json`. The medium fixture has 100 nodes, 191 native
edges, 300 canonical facts and three layers; timing is environment-specific,
not an FPS guarantee. Source Host/Bridge assets
live in `viewer/`; their packaged assets are generated, not hand-edited.
