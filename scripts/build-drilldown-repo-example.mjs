import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { bundleDiagramSet, compileDiagramSet } from '../archify/diagram-set/compiler.mjs';
import { parseRepositoryRemote } from '../archify/renderers/shared/repository-location.mjs';
import { sameEntry } from '../archify/renderers/shared/path-semantics.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const ref = (diagram, node) => ({ diagram, node });
const types = ['architecture', 'workflow', 'sequence', 'dataflow', 'lifecycle'];

export function buildRepositoryDrilldownExample({
  repoRoot = repositoryRoot,
  outputDir = path.join(repositoryRoot, 'archify', 'examples', 'diagram-set', 'repository'),
  bundle = true,
} = {}) {
  const inputs = new Map();
  const revision = spawnSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (revision.status !== 0 || !/^[a-f0-9]{40}\s*$/.test(revision.stdout)) throw new Error('The repository example needs a local Git checkout.');
  const commit = revision.stdout.trim();
  const origin = spawnSync('git', ['-C', repoRoot, 'remote', 'get-url', 'origin'], { encoding: 'utf8' });
  const repository = origin.status === 0 && parseRepositoryRemote(origin.stdout.trim());
  if (!repository?.provider || repository.endpoint !== 'standard') throw new Error('The repository example needs a supported standard Git forge origin.');
  const repositoryUrl = `https://${repository.provider === 'github' ? 'github.com' : 'gitee.com'}/${repository.path.split('/').map(encodeURIComponent).join('/')}`;
  function source(relative, pattern, occurrence = 0) {
    if (!inputs.has(relative)) {
      const bytes = fs.readFileSync(path.join(repoRoot, ...relative.split('/')));
      const pinned = spawnSync('git', ['-C', repoRoot, 'show', `${commit}:${relative}`], { maxBuffer: 4 * 1024 * 1024 });
      inputs.set(relative, { text: bytes.toString('utf8'), sha256: sha256(bytes),
        ...(pinned.status === 0 && pinned.stdout.equals(bytes) ? { commit } : {}) });
    }
    const input = inputs.get(relative), matches = [...input.text.matchAll(new RegExp(pattern.source, 'g'))];
    const match = matches[occurrence];
    if (!match) throw new Error(`The repository example's call-site proof no longer matches ${relative}: ${pattern}`);
    const line = input.text.slice(0, match.index).split('\n').length;
    return { path: relative, line, endLine: line + match[0].split('\n').length - 1, sha256: input.sha256,
      ...(input.commit ? { commit: input.commit } : {}) };
  }
  const cli = 'archify/diagram-set/cli.mjs', compiler = 'archify/diagram-set/compiler.mjs';
  const fact = (id, from, to, kind, label, sources, scope = 'compiler') => ({
    id, from, to, kind, label, protocol: kind === 'process' ? 'Node.js process' : kind === 'writes' ? 'HTML' : 'JavaScript',
    scope, evidence: { mode: 'verified-source', sources },
  });
  const relations = [
    fact('command-bundle', ref('commands', 'handler'), ref('engine', 'bundle'), 'call', 'bundleDiagramSet',
      [source(cli, /bundleDiagramSet\(input, output, options\)/)], 'cli'),
    fact('command-validate', ref('commands', 'handler'), ref('engine', 'validate'), 'call', 'compileDiagramSet',
      [source(cli, /compileDiagramSet\(input, options\)/)], 'cli'),
    fact('command-diagnostic', ref('commands', 'handler'), ref('engine', 'diagnostics'), 'call', 'setDiagnostic on failure',
      [source(cli, /setDiagnostic\('command', error\.message/)], 'cli'),
    fact('bundle-load', ref('engine', 'bundle'), ref('engine', 'loader'), 'call', 'Load and validate manifest',
      [source(compiler, /loadDiagramSet\(manifestPath, \{ cache \}\)/, 1)]),
    fact('validate-load', ref('engine', 'validate'), ref('engine', 'loader'), 'call', 'Load and validate manifest',
      [source(compiler, /loadDiagramSet\(manifestPath, \{ cache \}\)/)]),
    fact('bundle-compile', ref('engine', 'bundle'), ref('engine', 'compile'), 'call', 'Compile loaded set',
      [source(compiler, /compileLoadedSet\(loaded, \{ \.\.\.options, cache \}\)/)]),
    fact('validate-compile', ref('engine', 'validate'), ref('engine', 'compile'), 'call', 'Compile loaded set',
      [source(compiler, /compileLoadedSet\(loadDiagramSet\(manifestPath, \{ cache \}\)/)]),
    fact('bundle-html', ref('engine', 'bundle'), ref('root', 'artifact'), 'writes', 'Atomic standalone HTML publication',
      [source(compiler, /writeStandaloneHtml\(outputPath, compiled\.html, \{ outputGuard \}\)/)], 'delivery'),
    ...types.map((type) => fact(`render-${type}`, ref('engine', 'compile'), ref('native', type), 'process',
      `Dispatch ${type} renderer`, [
        source(compiler, /run\(\[path\.join\(skillRoot, 'renderers', diagram\.type, `render-\$\{diagram\.type\}\.mjs`\), source, output\]/),
        source('archify/diagram-set/relations.mjs', new RegExp(`  ${type}: \\{[^\\n]+`)),
        source(`archify/renderers/${type}/render-${type}.mjs`, new RegExp(`diagramType: '${type}'`)),
      ])),
  ];
  const component = (id, label, column, row, type = 'backend') => ({
    id, label, type, pos: [40 + column * 400, 40 + row * 200], size: [220, 80],
  });
  const edge = (id, from, to, label) => ({ id, from, to, ...(label ? { label } : {}) });
  const diagram = (id, title, components, connections) => ({
    schema_version: 1, diagram_type: 'architecture', meta: { title, output: `${id}.html` },
    components, connections, boundaries: [],
  });
  const documents = {
    root: diagram('root', 'Archify Diagram Set delivery', [
      component('cli', 'CLI commands', 0, 0, 'frontend'), component('engine', 'Diagram Set engine', 1, 0),
      component('artifact', 'Standalone HTML', 2, 0, 'external'),
    ], [edge('dispatch', 'cli', 'engine', 'Command dispatch'), edge('publication', 'engine', 'artifact', 'Atomic publication')]),
    commands: diagram('commands', 'Public Diagram Set command handler', [
      component('handler', 'commandDiagramSet', 0, 0, 'frontend'),
    ], []),
    engine: diagram('engine', 'Manifest validation and native compilation', [
      component('bundle', 'bundleDiagramSet', 0, 0), component('validate', 'compileDiagramSet', 0, 1),
      component('loader', 'loadDiagramSet', 1, 1), component('compile', 'compileLoadedSet', 1, 0),
      component('renderers', 'Five native renderer types', 2, 0), component('diagnostics', 'setDiagnostic', 2, 1),
    ], [edge('bundle-load-edge', 'bundle', 'loader'), edge('validate-load-edge', 'validate', 'loader'),
      edge('bundle-compile-edge', 'bundle', 'compile'), edge('validate-compile-edge', 'validate', 'compile'),
      edge('native-dispatch', 'compile', 'renderers', 'Dispatch by diagram.type')]),
    native: diagram('native', 'Existing typed native renderers', types.map((type, i) =>
      component(type, `render-${type}.mjs`, i % 3, Math.floor(i / 3))), []),
  };
  const manifest = {
    schema_version: 1, kind: 'archify-diagram-set', id: 'archify-repository-pipeline',
    title: 'Archify: code-backed hierarchical compilation', repository_url: repositoryUrl,
    root_diagram: 'root', diagrams: Object.keys(documents).map((id) => ({ id, type: 'architecture', source: `${id}.json` })),
    drilldowns: [
      { from: ref('root', 'cli'), to_diagram: 'commands' },
      { from: ref('root', 'engine'), to_diagram: 'engine' },
      { from: ref('engine', 'renderers'), to_diagram: 'native' },
    ],
    relations,
    projections: [
      { diagram: 'root', relation_id: 'dispatch', projectionPolicy: 'derived', kind: 'call', scope: 'cli' },
      { diagram: 'root', relation_id: 'publication', projectionPolicy: 'derived', kind: 'writes' },
      ...['bundle-load', 'validate-load', 'bundle-compile', 'validate-compile'].map((id) => ({
        diagram: 'engine', relation_id: `${id}-edge`, projectionPolicy: 'derived', kind: 'call',
      })),
      { diagram: 'engine', relation_id: 'native-dispatch', projectionPolicy: 'derived', kind: 'process' },
    ],
    chains: [
      { id: 'bundle-architecture', title: 'Bundle an Architecture diagram', relation_ids: ['command-bundle', 'bundle-compile', 'render-architecture'] },
      { id: 'validate-workflow', title: 'Validate a Workflow diagram', relation_ids: ['command-validate', 'validate-compile', 'render-workflow'] },
      { id: 'html-delivery', title: 'Publish the offline HTML', relation_ids: ['command-bundle', 'bundle-html'] },
    ],
    viewer: { initial_relation_mode: 'bundled', bundle_threshold: 5 },
  };
  fs.mkdirSync(outputDir, { recursive: true });
  for (const [id, document] of Object.entries(documents)) fs.writeFileSync(path.join(outputDir, `${id}.json`), `${JSON.stringify(document, null, 2)}\n`);
  fs.writeFileSync(path.join(outputDir, 'set.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  let result = null;
  if (bundle) {
    const checked = compileDiagramSet(path.join(outputDir, 'set.json'), { repoRoot });
    if (Object.values(checked.evidence).some((entry) => entry.status !== 'current')) throw new Error('Repository example sources changed during generation.');
    fs.writeFileSync(path.join(outputDir, 'evidence-receipt.json'), `${JSON.stringify({
      schemaVersion: 1, command: 'validate-set', ok: true, set: manifest.id,
      evidence: checked.evidence, diagnostics: checked.diagnostics, sourceScope: 'repository-at-generation',
    }, null, 2)}\n`);
    // The portable artifact reproduces without the Git checkout; the separate receipt records its source audit.
    result = bundleDiagramSet(path.join(outputDir, 'set.json'), path.join(outputDir, 'output.html'));
  }
  return { manifest, documents, result };
}

if (process.argv[1] && sameEntry(process.argv[1], fileURLToPath(import.meta.url)).status === 'match') {
  const result = buildRepositoryDrilldownExample();
  console.log(`Built repository example: ${result.manifest.diagrams.length} diagrams, ${result.manifest.relations.length} checked facts, ${result.manifest.chains.length} chains.`);
}
