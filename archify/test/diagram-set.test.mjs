import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadDiagramSet } from '../diagram-set/model.mjs';
import { compileDiagramSet, bundleDiagramSet, packNativeDocuments } from '../diagram-set/compiler.mjs';
import { openDiagramSetCache } from '../diagram-set/cache.mjs';
import { adapters, createRelationIndex, navigationPath, projectRelations, projectCanvasRelations, representativeAt } from '../diagram-set/relations.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixture = path.join(root, 'archify', 'examples', 'diagram-set');
const cli = path.join(root, 'archify', 'bin', 'archify.mjs');

function sandbox(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-set-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const name of ['system.json', 'backend.json', 'auth.json', 'set.json']) {
    fs.copyFileSync(path.join(fixture, name), path.join(directory, name));
  }
  return directory;
}
function altered(t, mutate) {
  const directory = sandbox(t);
  const file = path.join(directory, 'set.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  mutate(manifest, directory);
  fs.writeFileSync(file, JSON.stringify(manifest));
  return file;
}
function fails(file, code) {
  assert.throws(() => loadDiagramSet(file), (error) => {
    assert.ok(error.archifyDiagnostics?.some((entry) => entry.code === code), JSON.stringify(error.archifyDiagnostics));
    for (const diagnostic of error.archifyDiagnostics) {
      assert.ok(diagnostic.subject);
      assert.ok(diagnostic.evidence);
      assert.ok(diagnostic.supportedFixes.length);
    }
    return true;
  });
}
function bundleData(html) {
  return JSON.parse(html.match(/<script id="diagram-set-data" type="application\/json">([\s\S]*?)<\/script>/)[1]);
}
function unpackDocument(data, id) {
  return data.rendered[id].map((part) => typeof part === 'string' ? part : data.runtime[part]).join('');
}
test('Native resource packing is byte-exact, deterministic and shares only identical complete blocks', () => {
  const fonts = '<style id="archify-fonts">@font-face{src:url(data:font/woff2;base64,AAAA)}</style>';
  const css = '<style>.node{fill:red}</style>';
  const js = '<script>const example="<style>not CSS</style>"; const replacement="$&";</script>';
  const documents = {
    first: `<html><head>${fonts}${css}</head><body><svg><text>&lt;script&gt;</text></svg>${js}</body></html>`,
    second: `<html><head>${fonts}${css}</head><body><svg><text>Other</text></svg>${js}</body></html>`,
    different: `<html><head>${fonts}<style>.node{fill:blue}</style></head><body>${js}</body></html>`,
    empty: '<html><body>No resources</body></html>',
  };
  const packed = packNativeDocuments(documents);
  assert.deepEqual(packNativeDocuments(documents), packed);
  assert.equal(packed.runtime.length, 4);
  assert.equal(packed.runtime.filter((resource) => resource === fonts).length, 1);
  for (const [id, original] of Object.entries(documents)) assert.equal(unpackDocument(packed, id), original);
});
test('Diagram Set stable identity, direction, provenance and count invariants', () => {
  const set = loadDiagramSet(path.join(fixture, 'set.json'));
  assert.deepEqual(navigationPath(set.index, 'auth'), ['system', 'backend', 'auth']);
  assert.deepEqual(representativeAt(set.index, { diagram: 'auth', node: 'verifier' }, 'system'), { diagram: 'system', node: 'backend' });
  const rootGroups = projectRelations(set.index, ['system']);
  const coarse = rootGroups.filter((group) => group.from.node === 'frontend' && group.to.node === 'backend');
  assert.equal(coarse.reduce((count, group) => count + group.count, 0), 3);
  assert.equal(rootGroups.flatMap((group) => group.sourceRelationIds).includes('rel-auth-orders'), false, 'folded internal relation is not a new root relation');
  const detailed = projectRelations(set.index, ['system', 'backend']);
  assert.deepEqual(detailed.filter((group) => group.from.node === 'frontend').map((group) => group.to.node).sort(), ['gateway', 'orders', 'upload']);
  assert.ok(detailed.some((group) => group.from.node === 'worker' && group.to.node === 'database'));
  const deepest = projectRelations(set.index, ['system', 'backend', 'auth']);
  assert.ok(deepest.some((group) => group.from.node === 'frontend' && group.to.node === 'verifier'));
  assert.ok(deepest.some((group) => group.from.node === 'session' && group.to.node === 'orders'));
  for (const groups of [rootGroups, detailed, deepest]) {
    const ids = groups.flatMap((group) => group.sourceRelationIds);
    assert.equal(new Set(ids).size, ids.length, 'each fact counts once per view');
    for (const group of groups) assert.equal(group.count, group.sourceRelationIds.length);
  }
  assert.deepEqual(projectRelations(set.index, ['system']), rootGroups, 'return to root preserves aggregation');
  assert.equal(set.diagnostics.length, 0);
});
test('Derived projections preserve mixed kinds, protocols, scopes and opposite directions', () => {
  const set = loadDiagramSet(path.join(fixture, 'set.json'));
  const manifest = structuredClone(set.manifest);
  const relation = manifest.relations[1];
  manifest.relations.push(
    { ...relation, id: 'response', from: relation.to, to: relation.from, kind: 'response' },
    { ...relation, id: 'grpc', protocol: 'gRPC' },
    { ...relation, id: 'other-scope', scope: 'audit' },
  );
  const index = createRelationIndex(manifest, set.documents);
  const groups = projectRelations(index, ['system']);
  assert.ok(groups.some((group) => group.from.node === 'backend' && group.to.node === 'frontend' && group.kind === 'response'));
  assert.ok(groups.some((group) => group.protocol === 'gRPC'));
  assert.ok(groups.some((group) => group.scope === 'audit'));
  assert.equal(projectRelations(index, ['system'], { kind: 'event' }).length, 1);
  assert.equal(projectRelations(index, ['system'], { protocol: 'gRPC' }).length, 1);
  assert.equal(projectRelations(set.index, ['system', 'backend'], { direction: 'incoming' }).length, 3);
  assert.equal(projectRelations(set.index, ['system', 'backend'], { direction: 'outgoing' }).length, 1);
  assert.equal(projectRelations(set.index, ['system', 'backend'], { direction: 'internal' }).length, 1);
});
test('Canvas frontier unfolds one-to-one into one-to-many and many-to-many without changing facts', () => {
  const set = loadDiagramSet(path.join(fixture, 'canvas.json'));
  const http = (open) => projectCanvasRelations(set.index, open, { kind: 'http', protocol: 'HTTPS' });
  const states = [[], ['backend'], ['backend', 'frontend'], ['backend', 'frontend', 'auth'], ['frontend'], []];
  const expected = ['checkout-login', 'checkout-orders', 'shell-login', 'shell-orders'];
  const views = states.map(http);
  assert.equal(views[0].length, 1);
  assert.equal(views[0][0].count, 4);
  assert.equal(views[1].length, 2);
  assert.ok(views[1].every((group) => group.from.diagram === 'system' && group.from.node === 'frontend'));
  assert.equal(views[2].length, 4);
  assert.equal(new Set(views[2].map((group) => group.from.node)).size, 2);
  assert.equal(new Set(views[2].map((group) => group.to.node)).size, 2);
  assert.ok(views[3].some((group) => group.to.diagram === 'auth' && group.to.node === 'verifier'));
  assert.equal(views[4].length, 2);
  for (const view of views) {
    assert.deepEqual(view.flatMap((group) => group.sourceRelationIds).sort(), expected);
    assert.ok(view.every((group) => group.count === group.sourceRelationIds.length));
  }
  assert.deepEqual(views[0], views.at(-1));
  assert.throws(() => projectCanvasRelations(set.index, ['auth']), /Invalid expanded entrance/);
  assert.throws(() => projectCanvasRelations(set.index, ['missing']), /Invalid expanded entrance/);
  const copy = http(['backend']);
  copy[0].sourceRelationIds.push('mutated');
  assert.deepEqual(http(['backend']), views[1], 'view cache is not exposed by reference');
});
test('Canvas groups preserve independent scopes, reverse facts and local self-relations across sibling expansion', () => {
  const set = loadDiagramSet(path.join(fixture, 'canvas.json'));
  const manifest = structuredClone(set.manifest);
  const source = manifest.relations[0];
  manifest.relations.push({ ...source, id: 'reverse', from: source.to, to: source.from },
    { ...source, id: 'audit', scope: 'audit' },
    { ...source, id: 'self', from: source.to, to: source.to });
  const index = createRelationIndex(manifest, set.documents);
  const collapsed = projectCanvasRelations(index, []);
  assert.ok(!collapsed.some((group) => group.sourceRelationIds.includes('self')));
  const expanded = projectCanvasRelations(index, ['frontend', 'backend', 'auth']);
  assert.ok(expanded.some((group) => group.from.diagram === 'auth' && group.to.diagram === 'frontend' && group.sourceRelationIds.includes('reverse')));
  assert.ok(expanded.some((group) => group.scope === 'audit' && group.sourceRelationIds.length === 1));
  assert.ok(expanded.some((group) => group.from.node === 'verifier' && group.to.node === 'verifier' && group.sourceRelationIds.includes('self')));
  const ids = expanded.flatMap((group) => group.sourceRelationIds);
  assert.equal(new Set(ids).size, ids.length);
  const incoming = projectCanvasRelations(index, ['frontend', 'backend', 'auth'], { direction: 'incoming' }, 'backend');
  assert.ok(incoming.every((group) => group.from.diagram === 'frontend' && ['backend', 'auth'].includes(group.to.diagram)));
});
test('Sibling detail diagrams with identical node IDs preserve unique endpoints and N-to-M facts', () => {
  const set = loadDiagramSet(path.join(fixture, 'set.json'));
  const manifest = structuredClone(set.manifest);
  manifest.diagrams.push({ id: 'frontend-detail', type: 'architecture', source: 'frontend.json' });
  manifest.drilldowns.push({ from: { diagram: 'system', node: 'frontend' }, to_diagram: 'frontend-detail' });
  const documents = new Map(set.documents);
  documents.set('frontend-detail', structuredClone(documents.get('backend')));
  manifest.relations = [
    { id: 'a', from: { diagram: 'frontend-detail', node: 'gateway' }, to: { diagram: 'backend', node: 'gateway' }, kind: 'http', evidence: { mode: 'authored' } },
    { id: 'b', from: { diagram: 'frontend-detail', node: 'orders' }, to: { diagram: 'backend', node: 'gateway' }, kind: 'http', evidence: { mode: 'authored' } },
    { id: 'c', from: { diagram: 'frontend-detail', node: 'orders' }, to: { diagram: 'backend', node: 'upload' }, kind: 'http', evidence: { mode: 'authored' } },
  ];
  const index = createRelationIndex(manifest, documents);
  const root = projectRelations(index, ['system']);
  assert.equal(root.length, 1);
  assert.equal(root[0].count, 3);
  const backend = projectRelations(index, ['system', 'backend']);
  assert.equal(backend.find((group) => group.to.node === 'gateway').count, 2);
  assert.ok(backend.every((group) => group.from.diagram === 'system' && group.from.node === 'frontend'));
  const frontend = projectRelations(index, ['system', 'frontend-detail']);
  assert.ok(frontend.every((group) => group.to.diagram === 'system' && group.to.node === 'backend'));
  assert.equal(index.incoming.get('backend:gateway').length, 2);
  assert.equal(index.outgoing.get('frontend-detail:orders').length, 2);
});
test('Unresolved and partial are disclosed without guessed detail edges', (t) => {
  const file = altered(t, (manifest) => {
    manifest.projections[0].status = 'partial';
    manifest.projections[0].derived_from.pop();
    manifest.projections[1] = { diagram: 'system', relation_id: 'backend_to_database', status: 'unresolved' };
  });
  const set = loadDiagramSet(file);
  assert.equal(set.projections[0].status, 'partial');
  assert.equal(set.projections[0].derived_from.length, 2);
  assert.equal(set.projections[1].status, 'unresolved');
  assert.deepEqual(set.projections[1].derived_from, []);
  assert.equal(set.diagnostics.length, 2);
  assert.ok(set.diagnostics.every((entry) => entry.severity === 'warning'));
});
test('Malformed references and mappings fail with actionable diagnostics', async (t) => {
  const cases = [
    ['duplicate diagram', (m) => { m.diagrams[1].id = 'system'; }, 'diagram-set/duplicate-id'],
    ['duplicate relation', (m) => { m.relations.push(m.relations[0]); }, 'diagram-set/duplicate-id'],
    ['missing endpoint', (m) => { m.relations[0].to.node = 'missing'; }, 'diagram-set/node-reference'],
    ['missing root', (m) => { m.root_diagram = 'missing'; }, 'diagram-set/root'],
    ['orphan', (m) => { m.drilldowns.pop(); }, 'diagram-set/unreachable'],
    ['cycle', (m) => { m.drilldowns.push({ from: { diagram: 'auth', node: 'session' }, to_diagram: 'system' }); }, 'diagram-set/cycle'],
    ['shared child', (m) => { m.drilldowns.push({ from: { diagram: 'system', node: 'frontend' }, to_diagram: 'backend' }); }, 'diagram-set/shared-child'],
    ['unknown relation', (m) => { m.projections[0].derived_from = ['missing']; }, 'diagram-set/relation-reference'],
    ['reverse fact', (m) => { [m.relations[0].from, m.relations[0].to] = [m.relations[0].to, m.relations[0].from]; }, 'diagram-set/projection-conflict'],
    ['wrong kind', (m) => { m.projections[0].kind = 'event'; }, 'diagram-set/projection-conflict'],
    ['unresolved with facts', (m) => { m.projections[0].status = 'unresolved'; }, 'diagram-set/projection-status'],
    ['wrong interface owner', (m) => { m.interfaces[0].owner.node = 'frontend'; }, 'diagram-set/interface-owner'],
    ['ambiguous port', (m) => { m.interfaces[0].ports.push({ ...m.interfaces[0].ports[0], id: 'duplicate-http' }); }, 'diagram-set/ambiguous-port'],
    ['duplicate projection', (m) => { m.projections.push(m.projections[0]); }, 'diagram-set/duplicate-projection'],
    ['unknown property', (m) => { m.viewer.untrustedScript = 'alert(1)'; }, 'schema/additionalProperties'],
    ['duplicate source', (m) => { m.projections[0].derived_from.push(m.projections[0].derived_from[0]); }, 'schema/uniqueItems'],
    ['no source evidence', (m) => { m.relations[0].evidence = { mode: 'verified-source' }; }, 'schema/required'],
    ['derived reverse conflict', (m) => { m.projections[0] = { diagram: 'system', relation_id: 'frontend_to_backend', projectionPolicy: 'derived' }; [m.relations[0].from, m.relations[0].to] = [m.relations[0].to, m.relations[0].from]; }, 'diagram-set/projection-conflict'],
  ];
  for (const [name, mutate, code] of cases) await t.test(name, (t) => fails(altered(t, mutate), code));
});
test('Known omitted sources normalize to partial, never resolved', (t) => {
  const file = altered(t, (manifest) => manifest.projections[0].derived_from.pop());
  const set = loadDiagramSet(file);
  assert.equal(set.projections[0].status, 'partial');
  assert.ok(set.diagnostics.some((entry) => entry.evidence.status === 'partial'));
});
test('Source paths reject escape, remote locations, native aliases and external symlinks', async (t) => {
  for (const source of ['../system.json', '/system.json', 'C:\\system.json', 'https://example.test/system.json', 'a\\b.json', 'system.json:stream', 'CON.json', './system.json', 'system.txt', '']) {
    await t.test(source || 'empty source', (t) => {
      const file = altered(t, (manifest) => { manifest.diagrams[0].source = source; });
      fails(file, source ? 'diagram-set/source-path' : 'schema/minLength');
    });
  }
  await t.test('external directory symlink', (t) => {
    const file = altered(t, (manifest, directory) => {
      fs.symlinkSync(fixture, path.join(directory, 'outside'), process.platform === 'win32' ? 'junction' : 'dir');
      manifest.diagrams[0].source = 'outside/system.json';
    });
    fails(file, 'diagram-set/source-path');
  });
});
test('All five native kinds retain navigation, non-Architecture semantics fail closed', (t) => {
  const directory = sandbox(t);
  const examples = {
    workflow: 'agent-tool-call.workflow.json', sequence: 'cache-miss-request.sequence.json',
    dataflow: 'product-analytics.dataflow.json', lifecycle: 'agent-run.lifecycle.json',
  };
  const documents = new Map();
  const diagrams = [];
  const drilldowns = [];
  let previous;
  for (const [type, example] of Object.entries({ architecture: 'web-app.architecture.json', ...examples })) {
    const document = JSON.parse(fs.readFileSync(path.join(root, 'archify', 'examples', example), 'utf8'));
    document[adapters[type].edges].forEach((edge, position) => { if (!edge.id) edge.id = `edge-${position}`; });
    documents.set(type, document);
    diagrams.push({ id: type, type, source: `${type}.json` });
    fs.writeFileSync(path.join(directory, `${type}.json`), JSON.stringify(document));
    if (previous) drilldowns.push({ from: { diagram: previous, node: documents.get(previous)[adapters[previous].nodes][0].id }, to_diagram: type });
    previous = type;
  }
  const manifest = { schema_version: 1, kind: 'archify-diagram-set', id: 'all-types', root_diagram: 'architecture', diagrams, drilldowns };
  const file = path.join(directory, 'all.json');
  fs.writeFileSync(file, JSON.stringify(manifest));
  const set = loadDiagramSet(file);
  assert.equal(navigationPath(set.index, 'lifecycle').length, 5);
  assert.ok(Object.values(adapters).every((adapter) => typeof adapter.projection === 'boolean'));
  manifest.relations = [{ id: 'invalid', from: drilldowns[1].from, to: drilldowns[2].from, kind: 'http', evidence: { mode: 'authored' } }];
  fs.writeFileSync(file, JSON.stringify(manifest));
  fails(file, 'diagram-set/unsupported-semantics');
});
test('Bundling is deterministic, injection-safe and leaves last-good output on every failed stage', (t) => {
  const directory = sandbox(t);
  const manifest = path.join(directory, 'set.json');
  const first = compileDiagramSet(manifest);
  const second = compileDiagramSet(manifest);
  assert.equal(first.html, second.html);
  assert.equal(first.html.replace(/\r\n?/g, '\n'), fs.readFileSync(path.join(fixture, 'output.html'), 'utf8').replace(/\r\n?/g, '\n'),
    'the packaged demo must be rebuilt from the current Viewer and compiler');
  assert.equal(first.checks.length, 3);
  const packed = bundleData(first.html);
  assert.ok(packed.runtime.every((resource, position) => packed.runtime.indexOf(resource) === position));
  assert.equal(packed.runtime.filter((resource) => resource.startsWith('<style id="archify-fonts">')).length, 1);
  assert.ok(Object.values(packed.rendered).every((parts) => Array.isArray(parts) && parts.some(Number.isInteger)));
  const output = path.join(directory, 'out.html');
  function command(...args) {
    const result = spawnSync(process.execPath, [cli, ...args, '--json'], { encoding: 'utf8' });
    return { status: result.status, receipt: JSON.parse(result.stdout) };
  }
  assert.equal(command('bundle', manifest, output).status, 0);
  const good = fs.readFileSync(output);
  const document = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  document.relations[0].to.node = 'missing';
  fs.writeFileSync(manifest, JSON.stringify(document));
  const bad = command('bundle', manifest, output);
  assert.equal(bad.status, 1);
  assert.equal(bad.receipt.ok, false);
  assert.deepEqual(fs.readFileSync(output), good);
  document.relations[0].to.node = 'verifier';
  fs.writeFileSync(manifest, JSON.stringify(document));
  const backend = JSON.parse(fs.readFileSync(path.join(directory, 'backend.json'), 'utf8'));
  backend.components[1].pos = backend.components[0].pos;
  fs.writeFileSync(path.join(directory, 'backend.json'), JSON.stringify(backend));
  assert.equal(command('bundle', manifest, output).status, 1);
  assert.deepEqual(fs.readFileSync(output), good);
  assert.equal(command('validate-set', manifest, '--unrecognized').status, 1);
  document.title = '</script><script>globalThis.injected=true</script>';
  fs.writeFileSync(manifest, JSON.stringify(document));
  fs.copyFileSync(path.join(fixture, 'backend.json'), path.join(directory, 'backend.json'));
  const injected = compileDiagramSet(manifest).html;
  assert.equal(injected.includes(document.title), false);
  assert.ok(injected.includes('\\u003c/script>'));
  assert.equal(command('bundle', manifest, path.join(directory, 'system.json')).status, 1);
});
test('The five-type bundle carries one runtime and fonts while retaining every native document', () => {
  const compiled = compileDiagramSet(path.join(fixture, 'cross-type.json'));
  const packed = bundleData(compiled.html);
  const native = Object.fromEntries(Object.keys(packed.rendered).map((id) => [id, unpackDocument(packed, id)]));
  const unshared = JSON.stringify({ ...packed, rendered: native, runtime: [] });
  const encoded = JSON.stringify(packed);
  assert.ok(Buffer.byteLength(encoded) < Buffer.byteLength(unshared) * .35,
    'five scenes must reduce serialized payload by at least 65%, not merely move duplicate strings');
  assert.ok(Buffer.byteLength(compiled.html) < 1.2 * 1024 * 1024, 'five-type offline HTML stays below 1.2 MiB');
  assert.equal(packed.runtime.filter((resource) => resource.startsWith('<style id="archify-fonts">')).length, 1);
  assert.equal(packed.runtime.filter((resource) => resource.startsWith('<script>') && resource.length > 300000).length, 1);
  assert.equal(packed.runtime.filter((resource) => resource.startsWith('<style>') && resource.length > 100000).length, 1);
  for (const [id, source] of Object.entries(native)) {
    assert.ok(source.startsWith('<!DOCTYPE html>') || source.startsWith('<!doctype html>'));
    const config = JSON.parse(source.match(/<script id="archify-diagram-bridge" type="application\/json">([\s\S]*?)<\/script>/)[1]);
    assert.equal(config.id, id);
    assert.ok(source.includes('id="archify-fonts"'));
    assert.equal(config.token, undefined, 'reply credentials are created per mounted document, never pooled');
  }
});

test('Incremental compilation reuses verified native artifacts and only affected projections', (t) => {
  const directory = sandbox(t);
  const file = path.join(directory, 'set.json');
  const cacheDir = path.join(directory, 'cache');
  const cold = compileDiagramSet(file, { cacheDir });
  if (process.platform !== 'win32') assert.equal(fs.statSync(cacheDir).mode & 0o077, 0, 'new cache directories must be private');
  assert.deepEqual(cold.incremental.nativeRendered, ['system', 'backend', 'auth']);
  const warm = compileDiagramSet(file, { cacheDir });
  assert.deepEqual(warm.incremental.nativeReused, ['system', 'backend', 'auth']);
  assert.deepEqual(warm.incremental.reused, ['system', 'backend', 'auth']);
  assert.equal(warm.html, cold.html);
  const auth = JSON.parse(fs.readFileSync(path.join(directory, 'auth.json'), 'utf8'));
  auth.meta.subtitle += ' / revised';
  fs.writeFileSync(path.join(directory, 'auth.json'), JSON.stringify(auth));
  const changed = compileDiagramSet(file, { cacheDir });
  assert.deepEqual(changed.incremental.nativeRendered, ['auth']);
  assert.deepEqual(changed.incremental.nativeReused, ['system', 'backend']);
  assert.deepEqual(changed.incremental.recomputed, []);
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  manifest.relations.find((relation) => relation.id === 'rel-auth-orders').scope = 'changed-scope';
  fs.writeFileSync(file, JSON.stringify(manifest));
  const facts = compileDiagramSet(file, { cacheDir });
  assert.deepEqual(facts.incremental.nativeRendered, []);
  assert.deepEqual(facts.incremental.recomputed, ['backend']);
  assert.deepEqual(facts.incremental.reused, ['system', 'auth'], 'only the diagram whose native projection uses this fact is invalidated');
  const cliWarm = spawnSync(process.execPath, [cli, 'validate-set', file, '--cache-dir', cacheDir, '--json'], { encoding: 'utf8' });
  assert.equal(cliWarm.status, 0, cliWarm.stderr);
  assert.deepEqual(JSON.parse(cliWarm.stdout).incremental.nativeReused, ['system', 'backend', 'auth']);
  const misuse = spawnSync(process.execPath, [cli, 'validate-set', file, '--cache-dir', '--json'], { encoding: 'utf8' });
  assert.equal(misuse.status, 1);
  assert.equal(JSON.parse(misuse.stdout).ok, false);
  const evidence = compileDiagramSet(file, { cacheDir, repoRoot: root });
  assert.equal(evidence.incremental.nativeCacheBypass, 'repository-evidence-revalidation');
  assert.deepEqual(evidence.incremental.nativeReused, []);
  const envEvidence = spawnSync(process.execPath, [cli, 'validate-set', file, '--cache-dir', cacheDir, '--json'], {
    encoding: 'utf8', env: { ...process.env, ARCHIFY_REPO_ROOT: root },
  });
  assert.equal(envEvidence.status, 0, envEvidence.stderr);
  assert.deepEqual(JSON.parse(envEvidence.stdout).incremental.nativeRendered, ['system', 'backend', 'auth']);
  const output = path.join(directory, 'last-good.html');
  bundleDiagramSet(file, output, { cacheDir });
  const lastGood = fs.readFileSync(output);
  fs.writeFileSync(path.join(directory, 'auth.json'), '{"invalid":true}');
  assert.throws(() => bundleDiagramSet(file, output, { cacheDir }));
  assert.deepEqual(fs.readFileSync(output), lastGood);
  fs.writeFileSync(path.join(directory, 'auth.json'), JSON.stringify(auth));
  assert.throws(() => bundleDiagramSet(file, path.join(cacheDir, 'out.html'), { cacheDir }),
    (error) => error.archifyDiagnostics.some((entry) => entry.code === 'diagram-set/cache-output'));
  const entry = fs.readdirSync(cacheDir).map((name) => path.join(cacheDir, name))
    .find((candidate) => {
      const value = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      return value.kind === 'native' && JSON.parse(value.payload).includes('System context / double-click Backend');
    });
  const saved = JSON.parse(fs.readFileSync(entry, 'utf8'));
  saved.payload += 'tampering';
  fs.writeFileSync(entry, JSON.stringify(saved));
  assert.throws(() => compileDiagramSet(file, { cacheDir }),
    (error) => error.archifyDiagnostics.some((item) => item.code === 'diagram-set/cache'));
});

test('Explicit typed correspondences enable all native kinds without temporal inference', (t) => {
  const file = path.join(fixture, 'cross-type.json');
  const set = loadDiagramSet(file);
  assert.equal(navigationPath(set.index, 'lifecycle').length, 5);
  for (const type of ['dataflow', 'workflow', 'sequence', 'lifecycle']) {
    const groups = projectRelations(set.index, navigationPath(set.index, type));
    assert.ok(groups.some((group) => group.sourceRelationIds.includes(`typed-${type}`)));
    assert.equal(set.index.semanticMappings.get(`${type}:typed-${type}`).semantics, adapters[type].semantics);
  }
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-adapters-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.cpSync(fixture, directory, { recursive: true });
  const manifest = structuredClone(set.manifest);
  const target = path.join(directory, 'cross-type.json');
  for (const [name, mutate, code] of [
    ['wrong semantics', (value) => { value.semantic_mappings[0].semantics = 'interaction'; }, 'semantic-mapping'],
    ['unknown edge', (value) => { value.semantic_mappings[0].edge_id = 'missing'; }, 'semantic-mapping'],
    ['unknown relation', (value) => { value.semantic_mappings[0].relation_id = 'missing'; }, 'semantic-mapping'],
    ['unknown diagram', (value) => { value.semantic_mappings[0].diagram = 'missing'; }, 'semantic-mapping'],
    ['empty explanation', (value) => { value.semantic_mappings[0].explanation = ' '; }, 'semantic-mapping'],
    ['reverse direction', (value) => {
      const relation = value.relations[0]; [relation.from, relation.to] = [relation.to, relation.from];
    }, 'semantic-mapping'],
    ['duplicate', (value) => { value.semantic_mappings.push(value.semantic_mappings[0]); }, 'duplicate-semantic-mapping'],
    ['missing mappings', (value) => { value.semantic_mappings = []; }, 'unsupported-semantics'],
  ]) {
    const value = structuredClone(manifest);
    mutate(value);
    fs.writeFileSync(target, JSON.stringify(value));
    assert.doesNotThrow(() => fails(target, `diagram-set/${code}`), name);
  }
  const rootManifest = structuredClone(manifest);
  const edge = set.documents.get('lifecycle').transitions[0];
  rootManifest.root_diagram = 'lifecycle';
  rootManifest.drilldowns = rootManifest.drilldowns.filter((entry) => entry.to_diagram !== 'lifecycle');
  rootManifest.drilldowns.unshift({ from: { diagram: 'lifecycle', node: edge.to }, to_diagram: 'system' });
  rootManifest.relations = [{ id: 'lifecycle-to-system', from: { diagram: 'lifecycle', node: edge.from },
    to: { diagram: 'system', node: 'frontend' }, kind: 'transition', evidence: { mode: 'authored' } }];
  rootManifest.semantic_mappings = [{ relation_id: 'lifecycle-to-system', diagram: 'lifecycle', edge_id: edge.id,
    semantics: 'transition', explanation: 'Fictional authored transition boundary opens the system detail; no static-call equivalence.' }];
  rootManifest.projections = [{ diagram: 'lifecycle', relation_id: edge.id, projectionPolicy: 'derived', kind: 'transition' }];
  fs.writeFileSync(target, JSON.stringify(rootManifest));
  const lifecycleRoot = loadDiagramSet(target);
  assert.equal(navigationPath(lifecycleRoot.index, 'sequence')[0], 'lifecycle');
  assert.deepEqual(lifecycleRoot.projections.find((entry) => entry.relation_id === edge.id).derived_from, ['lifecycle-to-system']);
  const output = compileDiagramSet(file);
  assert.equal(output.checks.length, 5);
});

test('Ten sibling N-to-M facts conserve their identity at root and each independently expanded side', () => {
  const set = loadDiagramSet(path.join(fixture, 'set.json'));
  const manifest = structuredClone(set.manifest);
  manifest.diagrams.push({ id: 'frontend-detail', type: 'architecture', source: 'frontend.json' });
  manifest.drilldowns.push({ from: { diagram: 'system', node: 'frontend' }, to_diagram: 'frontend-detail' });
  const documents = new Map(set.documents);
  documents.set('frontend-detail', structuredClone(documents.get('backend')));
  manifest.relations = ['gateway', 'orders'].flatMap((from, i) => ['gateway', 'orders', 'upload', 'queue', 'worker'].map((to, j) => ({
    id: `sibling-${i}-${j}`, from: { diagram: 'frontend-detail', node: from },
    to: { diagram: 'backend', node: to }, kind: 'http', evidence: { mode: 'authored' },
  })));
  const index = createRelationIndex(manifest, documents);
  for (const navPath of [['system'], ['system', 'backend'], ['system', 'frontend-detail'], ['system']]) {
    const groups = projectRelations(index, navPath);
    assert.equal(groups.reduce((sum, group) => sum + group.count, 0), 10);
    assert.equal(new Set(groups.flatMap((group) => group.sourceRelationIds)).size, 10);
  }
  assert.equal(projectRelations(index, ['system'])[0].count, 10);
  assert.equal(projectRelations(index, ['system', 'backend']).length, 5);
  assert.equal(projectRelations(index, ['system', 'frontend-detail']).length, 2);
});

test('Ancestor and view caches are bounded, deterministic and cannot be mutated by callers', () => {
  const { index } = loadDiagramSet(path.join(fixture, 'set.json'));
  assert.deepEqual(index.ancestors.get('auth').get('system'), { diagram: 'system', node: 'backend' });
  const navPath = navigationPath(index, 'auth');
  navPath.pop();
  assert.equal(navigationPath(index, 'auth').length, 3);
  const groups = projectRelations(index, ['system']);
  groups[0].sourceRelationIds.length = 0;
  assert.ok(projectRelations(index, ['system']).every((group) => group.count === group.sourceRelationIds.length));
  for (let i = 0; i < 80; i += 1) projectRelations(index, ['system'], { scope: `scope-${i}` });
  assert.ok(index.projected.size <= 64);
});

test('Direct self facts stay visible locally but never become fake ancestor self edges', () => {
  const set = loadDiagramSet(path.join(fixture, 'set.json'));
  const manifest = structuredClone(set.manifest);
  manifest.relations.push({ id: 'orders-self', from: { diagram: 'backend', node: 'orders' },
    to: { diagram: 'backend', node: 'orders' }, kind: 'retry', evidence: { mode: 'authored' } });
  const index = createRelationIndex(manifest, set.documents);
  assert.equal(projectRelations(index, ['system', 'backend']).find((group) => group.kind === 'retry').count, 1);
  assert.equal(projectRelations(index, ['system']).some((group) => group.kind === 'retry'), false);
});

test('Private cache rejects unmanaged directories, corruption and relocation between signatures', (t) => {
  const directory = sandbox(t);
  const cacheDir = path.join(directory, 'cache');
  fs.mkdirSync(cacheDir);
  fs.writeFileSync(path.join(cacheDir, 'unrelated.txt'), 'preserved');
  assert.throws(() => openDiagramSetCache(cacheDir), (error) => error.archifyDiagnostics?.[0].code === 'diagram-set/cache');
  assert.equal(fs.readFileSync(path.join(cacheDir, 'unrelated.txt'), 'utf8'), 'preserved');
  fs.unlinkSync(path.join(cacheDir, 'unrelated.txt'));
  const cache = openDiagramSetCache(cacheDir);
  cache.write('projection', 'first', [{ id: 'first' }]);
  cache.write('projection', 'second', [{ id: 'second' }]);
  assert.deepEqual(cache.read('projection', 'first'), [{ id: 'first' }]);
  const entries = fs.readdirSync(cacheDir).filter((name) => name.startsWith('archify-')).map((name) => path.join(cacheDir, name));
  fs.copyFileSync(entries[0], entries[1]);
  assert.throws(() => cache.read('projection', 'first') && cache.read('projection', 'second'),
    (error) => error.archifyDiagnostics?.[0].code === 'diagram-set/cache');
  fs.writeFileSync(path.join(cacheDir, '.archify-set-cache.json'), '{"key":"private-sentinel');
  assert.throws(() => openDiagramSetCache(cacheDir), (error) => {
    assert.equal(error.archifyDiagnostics[0].code, 'diagram-set/cache');
    assert.equal(error.archifyDiagnostics[0].message.includes('private-sentinel'), false);
    return true;
  });
});
