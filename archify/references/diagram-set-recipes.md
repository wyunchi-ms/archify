# Diagram Set authoring recipes

Use these prompts with the [canonical contract](diagram-sets.md) and the native
type schemas. Commands below run from the Skill directory. Substitute actual
inputs and output paths; do not install or update a live Skill to run them.

## 1. Trace a repository into three layers

> Inspect the public command-to-artifact path in this checkout. Inventory real
> entities, conditional branches and directed call sites first. Create a root,
> module detail and function/renderer detail with stable IDs and a unique-parent
> hierarchy. Cite exact file bytes and line ranges for every code-backed fact;
> pin a full commit only when the working bytes match that blob. Mark unknown
> behavior unresolved and user assumptions as assumptions. Do not turn supported
> type alternatives into calls that supposedly all execute together. Define
> direct facts first, derive parent projections, and name one exact multi-hop
> chain. Author readable native layouts only after the facts are fixed. Validate
> with the checkout root, repair errors, report stale/unverified warnings, then
> deliver an offline HTML and the source-audit receipt.

The [repository example](../examples/diagram-set/repository/README.md) is the
concrete result: four diagrams, three levels, 13 real-code facts and three
chains. It includes 1-to-3 command dispatch and 1-to-5 type alternatives.

```sh
node bin/archify.mjs validate-set examples/diagram-set/repository/set.json --repo-root .. --json
node bin/archify.mjs bundle examples/diagram-set/repository/set.json repository.html --json
```

The second command intentionally produces a portable, unverified-source build.
To publish the local audit state inside the HTML instead, pass `--repo-root ..`
there too. Do not describe the portable HTML as continuously code-verified.

## 2. Add one detail to an existing single diagram

> Preserve the existing native diagram, node/edge IDs and authored positions.
> Wrap it as the Diagram Set root. Add one independent detail diagram beneath
> the selected node with exactly one entrance. Inventory confirmed detailed
> facts and stable internal IDs before layout. Declare compatible directed
> parent projections. When only a conceptual parent edge is known, keep its
> mapping unresolved; don't guess child endpoints. Existing non-entrance
> relationships and standalone rendering must remain unchanged. Validate and
> bundle; demonstrate expansion, pan and collapse in the same canvas.

`set.json` is the reference shape: `system:backend` owns `backend`, whose
`gateway` owns `auth`. Start with only `system` and empty `drilldowns`/`relations`;
then add the existing detail inputs and documented confirmed facts.

```sh
node bin/archify.mjs validate-set examples/diagram-set/set.json --json
node bin/archify.mjs bundle examples/diagram-set/set.json incremental.html --json
```

For repeat compilation append `--cache-dir <private-empty-directory>`. Compare
the receipt rather than assuming reuse. Never point live installation symlinks
at a disposable scratch directory.

## 3. Complete one parent edge with N confirmed facts

> For this parent edge, enumerate the actual directed input facts and their
> code/user sources. Use exact NodeRefs; retain distinct request/response, kind,
> protocol and scope semantics. Declare `projectionPolicy: "derived"` or an
> explicit source-ID list with no duplicate IDs. If evidence covers only some
> facts, mark partial; if none is known, mark unresolved and add zero invented
> facts. Show counts and source IDs at root, one endpoint expanded, both expanded
> and refolded. Define a chain only if exact adjacent canonical endpoints join.

`many-relations.json` has 12 explicitly authored facts and unresolved edges;
`canvas.json` has four HTTPS facts that refold from four endpoint pairs into one.
These are fictional data, not a substitute for inspecting the requested code.

```sh
node bin/archify.mjs validate-set examples/diagram-set/many-relations.json --json
node bin/archify.mjs bundle examples/diagram-set/canvas.json facts.html --json
```

Regression evidence for the recipe outcomes lives in
`test/diagram-set-completion.test.mjs` (repository snapshots, incremental wrapping,
unknown-detail preservation and N-fact accounting) and
`test/diagram-set-browser.test.mjs` (one-to-many, many-to-many, trace and refolding).
A prompt is guidance; passing these fixtures is not a controlled model-quality
benchmark or proof that an agent followed the prompt on another repository.
