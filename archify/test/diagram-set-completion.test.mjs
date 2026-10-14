import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { loadDiagramSet } from '../diagram-set/model.mjs';
import { compileDiagramSet, bundleDiagramSet } from '../diagram-set/compiler.mjs';
import { createRelationIndex, findRelationPath, relationChain, projectCanvasRelations } from '../diagram-set/relations.mjs';
import { verifyDiagramSetEvidence } from '../diagram-set/provenance.mjs';
import { defaultRelationSplit, routeCanvasBridge, placeCanvasCaption, checkCanvasQuality } from '../diagram-set/canvas-layout.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixture = path.join(root, 'archify', 'examples', 'diagram-set');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function scratch(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-completion-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function evidenced(t) {
  const directory = scratch(t), file = path.join(directory, 'proof.mjs'), bytes = Buffer.from('export function handler() {\n  return compile();\n}\n');
  fs.writeFileSync(file, bytes);
  const source = { path: 'proof.mjs', line: 1, endLine: 3, sha256: hash(bytes) };
  return { directory, file, source, manifest: { relations: [{ id: 'call', evidence: { mode: 'verified-source', sources: [source] } }] } };
}
function changedSet(t, mutate) {
  const directory = scratch(t);
  for (const name of ['set.json', 'system.json', 'backend.json', 'auth.json']) fs.copyFileSync(path.join(fixture, name), path.join(directory, name));
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'set.json'), 'utf8'));
  mutate(manifest, directory);
  fs.writeFileSync(path.join(directory, 'set.json'), JSON.stringify(manifest));
  return path.join(directory, 'set.json');
}
test('Evidence snapshots distinguish current, stale, missing, legacy strings and unverified offline sources', (t) => {
  const { directory, file, source, manifest } = evidenced(t);
  assert.equal(verifyDiagramSetEvidence(manifest, { repoRoot: directory }).verification.call.status, 'current');
  assert.equal(verifyDiagramSetEvidence(manifest, { repoRoot: null }).verification.call.status, 'unverified');
  fs.writeFileSync(file, 'changed\n');
  const stale = verifyDiagramSetEvidence(manifest, { repoRoot: directory });
  assert.equal(stale.verification.call.status, 'stale');
  assert.equal(stale.verification.call.sources[0].reason, 'file-changed');
  assert.equal(stale.diagnostics[0].code, 'diagram-set/evidence-stale');
  fs.unlinkSync(file);
  assert.equal(verifyDiagramSetEvidence(manifest, { repoRoot: directory }).verification.call.sources[0].reason, 'file-missing');
  manifest.relations[0].evidence = { mode: 'verified-source', references: ['proof.mjs:1'] };
  assert.equal(verifyDiagramSetEvidence(manifest, { repoRoot: directory }).verification.call.status, 'unverified');
  manifest.relations[0].evidence = { mode: 'assumption', sources: [source] };
  assert.equal(verifyDiagramSetEvidence(manifest, { repoRoot: null }).verification.call.status, 'assumption');
});
test('Evidence snapshots never publish source contents and reject invalid line ranges and administration paths', (t) => {
  const { manifest, directory } = evidenced(t);
  const result = verifyDiagramSetEvidence(manifest, { repoRoot: directory });
  assert.equal(JSON.stringify(result).includes('return compile'), false);
  for (const source of [
    { path: '../outside.mjs', line: 1 }, { path: '.git/config', line: 1 }, { path: 'x.mjs', line: 3, endLine: 1 },
  ]) {
    const file = changedSet(t, (set) => { set.relations[0].evidence = { mode: 'verified-source', sources: [{ ...source, sha256: 'a'.repeat(64) }] }; });
    assert.throws(() => loadDiagramSet(file), (error) => error.archifyDiagnostics.some((entry) => entry.code === 'diagram-set/evidence-source'));
  }
  manifest.relations[0].evidence.sources[0].endLine = 4;
  assert.equal(verifyDiagramSetEvidence(manifest, { repoRoot: directory }).verification.call.sources[0].reason, 'line-range-changed');
});
test('Evidence follows neither file nor directory symlinks', (t) => {
  const { directory, file, manifest } = evidenced(t), outside = scratch(t);
  fs.copyFileSync(file, path.join(outside, 'proof.mjs'));
  fs.mkdirSync(path.join(directory, 'linked'));
  fs.rmdirSync(path.join(directory, 'linked'));
  fs.symlinkSync(outside, path.join(directory, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  manifest.relations[0].evidence.sources[0].path = 'linked/proof.mjs';
  assert.throws(() => verifyDiagramSetEvidence(manifest, { repoRoot: directory }),
    (error) => error.archifyDiagnostics.some((entry) => entry.code === 'diagram-set/evidence-path'));
});
test('Pinned evidence verifies real commit blobs while separately reporting working-tree drift', (t) => {
  const { directory, file, manifest } = evidenced(t);
  const run = (...args) => {
    const result = spawnSync('git', ['-C', directory, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr); return result.stdout.trim();
  };
  run('init', '--quiet'); run('add', 'proof.mjs');
  run('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Evidence fixture');
  manifest.relations[0].evidence.sources[0].commit = run('rev-parse', 'HEAD');
  assert.equal(verifyDiagramSetEvidence(manifest, { repoRoot: directory }).verification.call.status, 'current');
  fs.writeFileSync(file, 'changed\n');
  assert.equal(verifyDiagramSetEvidence(manifest, { repoRoot: directory }).verification.call.status, 'stale');
  manifest.relations[0].evidence.sources[0].sha256 = hash('changed\n');
  assert.throws(() => verifyDiagramSetEvidence(manifest, { repoRoot: directory }),
    (error) => error.archifyDiagnostics.some((entry) => entry.code === 'diagram-set/evidence-commit-mismatch'));
});
test('Evidence links reject credentials and ambiguous repository URLs before publication', (t) => {
  for (const url of ['https://user:secret@github.com/a/b', 'https://github.com/a/b?token=x', 'https://example.com/a/b']) {
    const file = changedSet(t, (set) => { set.repository_url = url; });
    assert.throws(() => loadDiagramSet(file), (error) => error.archifyDiagnostics.some((entry) => entry.code === 'diagram-set/repository-url'));
  }
});
test('Directed chain traversal is bounded, handles cycles and does not invent a transitive edge', () => {
  const set = loadDiagramSet(path.join(fixture, 'set.json')), manifest = structuredClone(set.manifest);
  const from = { diagram: 'system', node: 'frontend' }, via = { diagram: 'backend', node: 'orders' }, to = { diagram: 'backend', node: 'upload' };
  manifest.relations = [
    { id: 'a', from, to: via, kind: 'call' },
    { id: 'b', from: via, to, kind: 'event' },
    { id: 'cycle', from: via, to: from, kind: 'call' },
  ];
  const index = createRelationIndex(manifest, set.documents);
  assert.deepEqual(findRelationPath(index, from, to).relation_ids, ['a', 'b']);
  assert.equal(findRelationPath(index, from, to, { maxHops: 1 }).status, 'no-path');
  assert.equal(findRelationPath(index, from, to, { kind: 'call' }).status, 'no-path');
  assert.equal(findRelationPath(index, to, from).status, 'no-path');
  assert.equal(findRelationPath(index, from, from).status, 'same-node');
  assert.throws(() => relationChain(index, ['b', 'a']), /do not join/);
  assert.throws(() => relationChain(index, ['a', 'a']), /distinct/);
  assert.equal(index.relations.size, 3);
  const projected = projectCanvasRelations(index, ['backend']);
  assert.equal(projected.some((group) => group.from.node === 'frontend' && group.to.node === 'upload'), false);
});
test('Named chains validate exact canonical endpoints, not visually folded owners', (t) => {
  const file = changedSet(t, (set) => {
    set.chains = [{ id: 'invalid', title: 'Not a path', relation_ids: set.relations.slice(0, 2).map((relation) => relation.id) }];
  });
  assert.throws(() => loadDiagramSet(file), (error) => error.archifyDiagnostics.some((entry) => entry.code === 'diagram-set/relation-chain'));
});
test('Bundle threshold is effective, with explicit mode taking precedence', () => {
  assert.equal(defaultRelationSplit({ count: 2 }), false);
  assert.equal(defaultRelationSplit({ count: 2 }, { bundle_threshold: 3 }), true);
  assert.equal(defaultRelationSplit({ count: 3 }, { bundle_threshold: 3 }), false);
  assert.equal(defaultRelationSplit({ count: 2 }, { bundle_threshold: 3, initial_relation_mode: 'bundled' }), false);
  assert.equal(defaultRelationSplit({ count: 30 }, { bundle_threshold: 3, initial_relation_mode: 'expanded' }), true);
});
test('Canvas routing reuses native obstacle avoidance and evaluates measurable quality', () => {
  const node = { key: 'blocked', x: 80, y: -20, width: 40, height: 40 };
  const route = routeCanvasBridge({ start: [0, 0], end: [200, 0], fromSide: 'right', toSide: 'left', obstacles: [node] });
  assert.equal(route.status, 'routed');
  assert.ok(route.points.some((point) => Math.abs(point[1]) > 20));
  const check = checkCanvasQuality({ nodes: [node], routes: [{ ...route, ids: ['fact'], endpoints: ['a', 'b'] }],
    foreground: '#075a7b', background: '#f4f6f8', opacity: .75 });
  assert.equal(check.ok, true, JSON.stringify(check));
  assert.ok(check.checks.contrastRatio >= 3);
  const bad = checkCanvasQuality({ nodes: [node], routes: [{ ids: ['fact'], points: [[0, 0], [200, 0]], endpoints: ['a', 'b'], status: 'routed' }],
    labels: [{ ...node, ids: ['fact'] }], foreground: '#ffffff', background: '#ffffff' });
  assert.deepEqual(bad.diagnostics.map((entry) => entry.code),
    ['diagram-set/canvas-node-obstruction', 'diagram-set/canvas-label-overlap', 'diagram-set/canvas-low-contrast']);
});
test('Caption placement avoids cards and previously placed text instead of obscuring components', () => {
  const nodes = [{ x: 80, y: -20, width: 40, height: 40 }];
  const first = placeCanvasCaption([[0, 0], [200, 0]], 70, 12, nodes);
  assert.ok(first);
  const next = placeCanvasCaption([[0, 0], [200, 0]], 70, 12, nodes, [first]);
  assert.ok(next);
  assert.equal(checkCanvasQuality({ nodes, labels: [{ ...first, ids: ['a'] }, { ...next, ids: ['b'] }] }).ok, true);
  const visible = placeCanvasCaption([[-200, 50], [200, 50]], 70, 12, [], [], { x: 0, y: 0, width: 100, height: 100 });
  assert.ok(visible && visible.x >= 0 && visible.x + visible.width <= 100, 'try other anchors instead of dropping the first offscreen caption');
});
test('Compiled standalone runtime has valid JavaScript and keeps external evidence fresh on cache hits', (t) => {
  const directory = scratch(t), cacheDir = path.join(directory, 'cache');
  const file = changedSet(t, (manifest, base) => {
    fs.writeFileSync(path.join(base, 'proof.mjs'), 'export const proof = true;\n');
    manifest.relations[0].evidence = { mode: 'verified-source', sources: [{
      path: 'proof.mjs', line: 1, sha256: hash('export const proof = true;\n'),
    }] };
  });
  const first = compileDiagramSet(file, { repoRoot: path.dirname(file), cacheDir });
  assert.equal(first.html.includes('\r'), false, 'inline routing helpers preserve canonical LF across checkouts');
  new vm.Script(first.html.match(/<script>\s*([\s\S]*?)<\/script>/)[1]);
  assert.equal(first.evidence[first.manifest.relations[0].id].status, 'current');
  fs.writeFileSync(path.join(path.dirname(file), 'proof.mjs'), 'changed\n');
  const second = compileDiagramSet(file, { repoRoot: path.dirname(file), cacheDir });
  assert.equal(second.evidence[first.manifest.relations[0].id].status, 'stale');
  assert.equal(second.incremental.nativeReused.length, 3, 'canonical source audits do not force unchanged native diagrams to render again');
  assert.notEqual(second.html, first.html);
  const offline = compileDiagramSet(file, { cacheDir });
  assert.equal(offline.evidence[first.manifest.relations[0].id].status, 'unverified');
});
test('Bundle publication cannot overwrite a cited code input and preserves source bytes', (t) => {
  const bytes = '<html>Source code, not a diagram artifact</html>\n';
  const file = changedSet(t, (manifest, directory) => {
    fs.writeFileSync(path.join(directory, 'proof.html'), bytes);
    manifest.relations[0].evidence = { mode: 'verified-source', sources: [{ path: 'proof.html', line: 1, sha256: hash(bytes) }] };
  });
  const output = path.join(path.dirname(file), 'proof.html');
  assert.throws(() => bundleDiagramSet(file, output, { repoRoot: path.dirname(file) }));
  assert.equal(fs.readFileSync(output, 'utf8'), bytes);
});
test('A missing cited file is a stale warning and does not prevent publishing to a safe output', (t) => {
  const file = changedSet(t, (manifest) => {
    manifest.relations[0].evidence = { mode: 'verified-source', sources: [{ path: 'missing.mjs', line: 1, sha256: 'a'.repeat(64) }] };
  });
  const output = path.join(path.dirname(file), 'safe.html');
  const result = bundleDiagramSet(file, output, { repoRoot: path.dirname(file) });
  assert.equal(result.evidence['rel-login'].status, 'stale');
  assert.ok(fs.existsSync(output));
});
test('Native repository evidence still bypasses cache and revalidates Git objects on every compile', (t) => {
  const file = changedSet(t, (_manifest, directory) => {
    fs.writeFileSync(path.join(directory, 'proof.mjs'), 'export const proof = true;\n');
    for (const args of [
      ['init', '--quiet'], ['remote', 'add', 'origin', 'git@github.com:example/fixture.git'], ['add', 'proof.mjs'],
      ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'Proof'],
    ]) {
      const result = spawnSync('git', ['-C', directory, ...args], { encoding: 'utf8' });
      assert.equal(result.status, 0, result.stderr);
    }
    const revision = spawnSync('git', ['-C', directory, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).stdout.trim();
    const native = JSON.parse(fs.readFileSync(path.join(directory, 'system.json'), 'utf8'));
    native.meta.repository = { url: 'https://github.com/example/fixture', revision };
    native.components[0].sources = [{ path: 'proof.mjs', line: 1 }];
    fs.writeFileSync(path.join(directory, 'system.json'), JSON.stringify(native));
  });
  const options = { repoRoot: path.dirname(file), cacheDir: path.join(path.dirname(file), 'cache') };
  compileDiagramSet(file, options);
  const second = compileDiagramSet(file, options);
  assert.equal(second.incremental.nativeCacheBypass, 'repository-evidence-revalidation');
  assert.deepEqual(second.incremental.nativeReused, []);
  const native = JSON.parse(fs.readFileSync(path.join(path.dirname(file), 'system.json'), 'utf8'));
  native.components[0].sources[0].path = 'missing.mjs';
  fs.writeFileSync(path.join(path.dirname(file), 'system.json'), JSON.stringify(native));
  assert.throws(() => compileDiagramSet(file, options),
    (error) => error.archifyDiagnostics.some((entry) => entry.code === 'repository-evidence/file-missing'));
});
test('Repository identity and invalid pinned objects fail without replacing last-good HTML', (t) => {
  const file = changedSet(t, (manifest, directory) => {
    fs.writeFileSync(path.join(directory, 'proof.mjs'), 'proof\n');
    spawnSync('git', ['-C', directory, 'init', '--quiet']);
    spawnSync('git', ['-C', directory, 'remote', 'add', 'origin', 'https://github.com/example/actual']);
    manifest.repository_url = 'https://github.com/example/wrong';
    manifest.relations[0].evidence = { mode: 'verified-source', sources: [{ path: 'proof.mjs', line: 1, sha256: hash('proof\n') }] };
  });
  const output = path.join(path.dirname(file), 'last-good.html');
  fs.writeFileSync(output, 'last good');
  assert.throws(() => bundleDiagramSet(file, output, { repoRoot: path.dirname(file) }),
    (error) => error.archifyDiagnostics.some((entry) => entry.code === 'diagram-set/evidence-repository'));
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  manifest.repository_url = 'https://github.com/example/actual';
  manifest.relations[0].evidence.sources[0].commit = 'a'.repeat(40);
  fs.writeFileSync(file, JSON.stringify(manifest));
  assert.throws(() => bundleDiagramSet(file, output, { repoRoot: path.dirname(file) }),
    (error) => error.archifyDiagnostics.some((entry) => entry.code === 'diagram-set/evidence-git'));
  assert.equal(fs.readFileSync(output, 'utf8'), 'last good');
});
test('Repository authoring example has current snapshots, real conditional dispatch and exact directed chains', () => {
  const set = loadDiagramSet(path.join(fixture, 'repository', 'set.json'));
  assert.equal(set.manifest.diagrams.length, 4);
  assert.equal(set.manifest.relations.length, 13);
  assert.equal(set.manifest.chains.length, 3);
  const verified = verifyDiagramSetEvidence(set.manifest, { repoRoot: root });
  assert.ok(Object.values(verified.verification).every((entry) => entry.status === 'current'));
  for (const chain of set.manifest.chains) assert.deepEqual(relationChain(set.index, chain.relation_ids).relation_ids, chain.relation_ids);
  assert.equal(set.projections.find((entry) => entry.relation_id === 'dispatch').derived_from.length, 3);
  assert.equal(set.projections.find((entry) => entry.relation_id === 'native-dispatch').derived_from.length, 5);
});
test('Incremental authoring wraps unchanged native IR, adds detail, and never fills unknown parent facts', (t) => {
  const file = changedSet(t, (manifest) => {
    manifest.diagrams = manifest.diagrams.slice(0, 1);
    manifest.drilldowns = []; manifest.relations = []; manifest.projections = []; delete manifest.interfaces;
  });
  const nativeBytes = fs.readFileSync(path.join(path.dirname(file), 'system.json'));
  let set = loadDiagramSet(file);
  assert.equal(set.manifest.diagrams.length, 1);
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  manifest.diagrams.push({ id: 'backend', type: 'architecture', source: 'backend.json' });
  manifest.drilldowns.push({ from: { diagram: 'system', node: 'backend' }, to_diagram: 'backend' });
  fs.writeFileSync(file, JSON.stringify(manifest));
  set = loadDiagramSet(file);
  assert.equal(set.manifest.relations.length, 0);
  assert.equal(set.projections.find((entry) => entry.relation_id === 'frontend_to_backend').status, 'unresolved');
  manifest.relations.push({ id: 'confirmed', from: { diagram: 'system', node: 'frontend' },
    to: { diagram: 'backend', node: 'orders' }, kind: 'http', evidence: { mode: 'authored' } });
  manifest.projections.push({ diagram: 'system', relation_id: 'frontend_to_backend', projectionPolicy: 'derived' });
  fs.writeFileSync(file, JSON.stringify(manifest));
  set = loadDiagramSet(file);
  assert.deepEqual(set.projections.find((entry) => entry.relation_id === 'frontend_to_backend').derived_from, ['confirmed']);
  assert.ok(fs.readFileSync(path.join(path.dirname(file), 'system.json')).equals(nativeBytes));
  compileDiagramSet(file);
});
test('N-fact authoring conserves declared source IDs across expansion without guessing unresolved details', () => {
  const set = loadDiagramSet(path.join(fixture, 'many-relations.json'));
  const projection = set.projections.find((entry) => entry.relation_id === 'frontend_to_backend');
  assert.equal(projection.derived_from.length, 12);
  for (const opened of [[], ['backend'], ['backend', 'auth']]) {
    const facts = projectCanvasRelations(set.index, opened).flatMap((group) => group.sourceRelationIds);
    assert.deepEqual([...facts].sort(), [...projection.derived_from].sort());
    assert.equal(new Set(facts).size, 12);
  }
  assert.ok(set.projections.some((entry) => entry.status === 'unresolved' && !entry.derived_from.length));
});
