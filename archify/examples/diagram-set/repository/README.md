# Real-code Diagram Set: Archify compilation

Open `output.html` offline. The authoritative inputs are `set.json` and the
four native Architecture JSON files. Root `CLI commands` opens the handler;
`Diagram Set engine` opens compilation; its `Five native renderer types` entrance
opens the third layer. The handler's three confirmed facts represent bundle,
validate and diagnostic **conditional branches**, not three simultaneous calls.
The compiler's five type dispatch facts are supported renderer alternatives,
not a claim that one native input invokes every renderer.

In Relations, select `Bundle an Architecture diagram`, then step through its
three exact directed facts: handler -> bundle -> compile -> Architecture renderer.
Other chains trace Workflow validation and atomic HTML delivery. Collapse/pan/
Fit operate on the same canvas. Fact evidence lives under Source and hierarchy.

From the repository root:

```sh
node scripts/build-drilldown-repo-example.mjs
```

The generator inspects actual call-site/type declarations, hashes complete files,
and pins only working files that byte-match HEAD. It derives repository identity
from the actual supported origin. A source change that removes the required
call-site proof fails generation rather than silently reusing a fictional fact.
`evidence-receipt.json` records all 13 source checks against the checkout at
generation. Matching hashes prove snapshot freshness, not automated call-graph
inference or semantic interpretation. The portable `output.html` is compiled
without a repository root and therefore marks those sources **unverified**.

From `archify/`, independently recheck or reproduce the artifact:

```sh
node bin/archify.mjs validate-set examples/diagram-set/repository/set.json --repo-root .. --json
node bin/archify.mjs bundle examples/diagram-set/repository/set.json repository.html --json
```

The second command needs no checkout/Git objects and byte-reproduces the shipped
HTML. Add `--repo-root ..` only to embed a fresh local source-audit result.
An immutable HTML never monitors future checkout changes. The receipt includes
relative paths, hashes, ranges and safe pinned links, not source file contents.
