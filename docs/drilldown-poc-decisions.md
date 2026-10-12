# Hierarchical drilldown implementation decisions

The Diagram Set is an opt-in, offline infinite canvas. The initial implementation
used separate foreground and parent panels; the requested interaction now
supersedes that prototype with proportional, in-place expansion. The recorded
comparison base is `58ab0b9`. Native schemas and authored geometry remain
authoritative; ordinary single-diagram pages are unchanged.

## Canvas decisions

- Reuse all five native renderers in sandboxed `srcdoc` iframes. This is a scene
  placement/camera change, not another SVG renderer.
- Store identical complete script/style blocks once per bundle, including
  embedded fonts, translations and the Bridge. Native documents contain ordered
  resource references and are restored byte-for-byte on lazy mount before
  injecting fresh instance credentials. Do not introduce remote dependencies or
  cross-origin resource workarounds. Opened iframes still execute independently.
- Put the main graph and every opened sibling/nested child in one world.
  Child bounds uniformly fit their original entrance node rectangle; opening
  a child magnifies the shared camera by the inverse placement scale, capped
  by available viewport fit. Parent nodes never undergo automatic relayout.
- Initialize embedded native scenes on demand. Park loading iframes in the
  viewport by countering the current camera so offscreen animation-frame
  throttling cannot stall native initialization. Keep each iframe under the
  same DOM parent; reparenting can reload its document and revoke credentials.
- Pan, pointer-anchored zoom, touch pinch, Fit and keyboard controls operate on
  the same camera. Open siblings stay mounted; collapse removes only the
  selected entrance and its descendants. Ancestors and children remain sharp
  and fully opaque, both on screen and in composed exports. Legacy frosting
  options remain accepted but have no visual effect.
- Add entrance badges only after fonts and native layout settle. Early hidden
  SVGs can report empty bounds, placing a badge at the SVG origin and inflating
  its node group's rectangle. Canvas targets, expansion slots and bridge
  endpoints use the native card mask, excluding decorative group bounds.
- Project facts through the complete open-entrance forest, not just the focused
  hierarchy. Each endpoint has one deepest exposed representative. Counts and
  source IDs survive one-to-one, one-to-many and many-to-many transitions.
  Unchanged native relationships keep their authored routes without duplicate
  flashing curves. Unknown endpoints stay at an explicit boundary.
- Hide both standalone Viewer and old Host toolbars in canvas mode. The optional
  Relations inspector occupies a separate desktop column or mobile bottom row,
  never overlays components. Coarse groups contain exposed branches and facts;
  IDs, evidence and mappings are progressively disclosed.
- Retain document-bound reply credentials, opaque sandbox origins and validated
  message sources. Host history stores the open forest, focused path and camera;
  child hash state remains private. Legacy path-only deep links still work.
- Keep clean current-diagram SVG/PNG and composed canvas PNG available through
  the Host API without reinstating unwanted toolbar controls. Composed snapshots
  preserve hidden entrance nodes/incident edges and omit native grid/legends.
  Editable combined SVG is deliberately unsupported.

## Reproducible example and acceptance

Open [`output.html`](../examples/diagram-set/output.html). This mirrors packaged
`archify/examples/diagram-set/canvas.html`, compiled from `canvas.json`.
The fictional authored example connects two frontend clients to two backend
endpoints with four stable HTTPS facts. Open Backend for two groups, then
Web Frontend for four distinct endpoint pairs. Pan or Fit to reach the other
entrance; opening Gateway adds nested authentication in the same world.
Collapse either side to refold those facts. No code-verification claim is made
by this fixture.

The maintained browser suite exercises real offline `file://`, actual mouse
drag/wheel, proportional placement, sibling and nested expansion, endpoint
alignment, refolding, history/refresh/invalid paths, docked/mobile inspector,
search, touch pinch, keyboard, reduced motion, source counts, all five native
types, exports, forged-message rejection and unexpected iframe navigation.
`ARCHIFY_DIAGRAM_SET_EVIDENCE` captures the representative visual states and
`benchmark.json`. Screenshot inspection is separate from coordinate assertions;
there is no FPS, cross-browser or hardware performance guarantee.

Only opened scenes are live, at most the manifest's 32 diagrams. Same-endpoint
bundles remain collapsed unless explicitly separated; selecting one fact draws
it plus the remainder. The view cache is bounded to 64 projections. Native
compiler caching remains opt-in and authenticated; repository evidence bypasses
native reuse. Typed correspondence is explicit and direction-checked.
Fact endpoints morph for 220 ms and the camera eases for 260 ms; reduced motion
makes both immediate.

At the initial shared-resource packing checkpoint, the five-type example fell from 4,090,069 to
1,107,151 bytes (72.9%) and the four-diagram canvas example from 3,214,798 to
977,750 bytes (69.6%). Packing reconstructed every native page byte-for-byte;
the same invariant remains covered as the Viewer evolves. These are fixture measurements, not a
claim that separate iframes share execution memory. Regressions require the
five-type HTML to stay below 1.2 MiB and its serialized payload to be at least
65% smaller than storing the reconstructed documents independently.

The measured toolchain is official Node 22.23.2 and HeadlessChrome
155.0.8059.39 on Windows x64. The current 100-node/191-native-edge/300-fact
fixture keeps three scenes and 31 fact paths (30 distinct endpoints plus one
selected chain), counting all 300 source IDs once with endpoint error below
one CSS pixel. Compile and navigation/check timings are recorded by each run in
`benchmark.json`; explicit settling and screenshot time are included, so these
are not pure navigation-latency measurements.

The [earlier drilldown recording](assets/archify-drilldown.gif) is historical:
it shows the superseded foreground-panel interaction, not the current canvas.
Use the standalone example and current browser captures to evaluate this design.

Shared-child DAGs, automatic parent relayout and unconditional cross-type
equivalence are outside this delivery. The canonical
[Diagram Set contract](../archify/references/diagram-sets.md) owns authoring,
commands, limits, supported semantics and export boundaries.
