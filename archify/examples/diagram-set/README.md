# Hierarchical drilldown examples

From `archify/`:

```sh
node bin/archify.mjs validate-set examples/diagram-set/set.json --json
node bin/archify.mjs bundle examples/diagram-set/set.json examples/diagram-set/output.html --json
node bin/archify.mjs bundle examples/diagram-set/many-relations.json examples/diagram-set/many-relations.html --json
node bin/archify.mjs bundle examples/diagram-set/cross-type.json examples/diagram-set/cross-type.html --json
node bin/archify.mjs bundle examples/diagram-set/canvas.json examples/diagram-set/canvas.html --json
```

Open `canvas.html` directly for the primary infinite-canvas demo. Click
**Backend** to unfold the four HTTPS facts into one-to-many groups, then open
**Web Frontend** to expose two clients connected to two backend endpoints.
Both children stay in the same draggable, zoomable world. Click **API Gateway**
for nested authentication. Use Fit or pan to reach other entrances; close an
entrance with its caption's `x`. Ancestors remain sharp and fully opaque.

The repository's `examples/diagram-set/output.html` mirrors this `canvas.html`.
The bundled `output.html` instead demonstrates the smaller three-layer fixture
from `set.json`; these two identically named outputs are not interchangeable.

In that smaller fixture, click **Backend**, then **API Gateway**.
The system connection expands to `POST /login`, `GET /orders` and `upload event`;
the third layer preserves the login fact's identity and adds the confirmed
Session-to-Orders fact. Breadcrumbs focus an ancestor without closing siblings.
Use a caption's `x`, or Escape with the inspector closed, to collapse a child.

`many-relations.html` demonstrates a 12-fact HTTP bundle. Open **Relations**
and use a group's separate/bundle action to expand or collapse its facts;
missing storage/authenticated-order detail stays explicitly unresolved at a
boundary. Offscreen endpoints remain in world space, not floating proxies.
Selecting a single fact while collapsed isolates that path and leaves the other
11 facts bundled. Expansion and reverse aggregation animate from the same IDs.

`cross-type.html` follows Architecture -> Dataflow -> Workflow -> Sequence ->
Lifecycle. Click each entrance node and inspect the fictional authored
correspondences in **Relations**. Native temporal/control semantics are never
silently converted to static dependencies.

For repeated builds, append `--cache-dir <private-empty-directory>` and compare
the receipt's `incremental` results. Editing one native source rerenders only
that diagram; source validation and native artifact checks still run.

Those four fixtures contain fictional, explicitly authored facts. The JSON files are the
authoritative inputs. HTML files are generated with the commands above. Each
native JSON can still be rendered individually.

[`repository/`](repository/README.md) is a separate, real-code fixture of
Archify's public CLI-to-renderer path. It has three layers, 13 snapshot-backed
facts, 1-to-3 / 1-to-5 conditional dispatch and named directed chains.
Its portable HTML reports unverified sources; its audit receipt records the
generation-time check against this checkout. It is not another root-gallery copy.
The [authoring recipes](../../references/diagram-set-recipes.md) show repository,
incremental and N-fact generation without guessing unknown detail.

See [Diagram Sets](../../references/diagram-sets.md) for the schema, source-path
limits, projection/evidence semantics, export scopes and capability matrix.
