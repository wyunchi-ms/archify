import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { writeStandaloneHtml } from '../renderers/shared/cli.mjs';
import { resolveOutputPath } from '../renderers/shared/output-path.mjs';
import { throwDiagnosticError } from '../renderers/shared/diagnostics.mjs';
import { loadDiagramSet, setDiagnostic } from './model.mjs';
import { adapters } from './relations.mjs';
import { openDiagramSetCache, nativeRuntimeSignature } from './cache.mjs';
import { containedBy } from '../renderers/shared/path-semantics.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jsonForScript = (value) => JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const MAX_BUNDLE_BYTES = 96 * 1024 * 1024;

function run(args, env) {
  const result = spawnSync(process.execPath, args, {
    encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, timeout: 120000, env: { ...process.env, ...env },
  });
  if (result.status !== 0) {
    let receipt;
    try { receipt = JSON.parse(result.stderr); } catch { /* Native tools may fail before producing a receipt. */ }
    const diagnostics = receipt?.diagnostics || [setDiagnostic('render', result.error?.message || result.stderr.trim() || 'Native renderer/checker failed.',
      { executable: args[0] }, { status: result.status, signal: result.signal }, ['repair the native diagram using its renderer diagnostics and retry'])];
    throwDiagnosticError('Diagram Set native artifact verification failed.', diagnostics);
  }
  return result;
}

export function compileDiagramSet(manifestPath, { quality, repoRoot, cacheDir } = {}) {
  const cache = openDiagramSetCache(cacheDir);
  return compileLoadedSet(loadDiagramSet(manifestPath, { cache }), { quality, repoRoot, cache });
}

export function packNativeDocuments(documents) {
  const runtime = [];
  const resources = new Map();
  const rendered = {};
  for (const [id, source] of Object.entries(documents)) {
    const parts = [];
    let offset = 0;
    // Consume whole raw-text elements so script strings containing style tags stay intact.
    for (const block of source.matchAll(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi)) {
      parts.push(source.slice(offset, block.index));
      if (!resources.has(block[0])) {
        resources.set(block[0], runtime.length);
        runtime.push(block[0]);
      }
      parts.push(resources.get(block[0]));
      offset = block.index + block[0].length;
    }
    parts.push(source.slice(offset));
    rendered[id] = parts;
  }
  return { runtime, rendered };
}

function compileLoadedSet(set, { quality, repoRoot, cache = null } = {}) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-set-'));
  const rendered = {};
  const checks = [];
  const documents = {};
  const incremental = { ...set.incremental, nativeReused: [], nativeRendered: [],
    cacheEnabled: !!cache, nativeCacheBypass: repoRoot || process.env.ARCHIFY_REPO_ROOT ? 'repository-evidence-revalidation' : null };
  const runtime = cache ? nativeRuntimeSignature() : null;
  try {
    const bridge = fs.readFileSync(path.join(skillRoot, 'assets', 'diagram-bridge.js'), 'utf8');
    for (const diagram of set.manifest.diagrams) {
      const source = path.join(scratch, `${diagram.id}.json`);
      const output = path.join(scratch, `${diagram.id}.html`);
      fs.writeFileSync(source, JSON.stringify(set.documents.get(diagram.id)), { flag: 'wx' });
      let result;
      let checked;
      const signature = JSON.stringify([runtime, diagram.type, set.documents.get(diagram.id),
        quality || process.env.ARCHIFY_QUALITY_PROFILE || null]);
      let native = incremental.nativeCacheBypass ? null : cache?.read('native', signature);
      try {
        if (native !== null && native !== undefined) {
          if (typeof native !== 'string') throw new Error('Cached native artifact has an invalid shape.');
          fs.writeFileSync(output, native, { flag: 'wx' });
          incremental.nativeReused.push(diagram.id);
        } else {
          result = run([path.join(skillRoot, 'renderers', diagram.type, `render-${diagram.type}.mjs`), source, output], {
            ARCHIFY_DIAGNOSTIC_FORMAT: 'json',
            ...(quality ? { ARCHIFY_QUALITY_PROFILE: quality } : {}),
            ...(repoRoot ? { ARCHIFY_REPO_ROOT: repoRoot } : {}),
          });
          incremental.nativeRendered.push(diagram.id);
        }
        checked = run([path.join(skillRoot, 'scripts', 'check-render-output.mjs'), output], {});
      } catch (error) {
        if (error.archifyDiagnostics) error.archifyDiagnostics = error.archifyDiagnostics.map((entry) =>
          ({ ...entry, subject: { ...entry.subject, diagram: diagram.id, source: diagram.source } }));
        throw error;
      }
      if (result?.stderr) process.stderr.write(result.stderr);
      const receipt = JSON.parse(checked.stdout);
      checks.push({ diagram: diagram.id, type: diagram.type, ok: true, checks: receipt.checks, composition: receipt.composition });
      native = fs.readFileSync(output, 'utf8');
      if (!incremental.nativeReused.includes(diagram.id) && !incremental.nativeCacheBypass) cache?.write('native', signature, native);
      const config = {
        id: diagram.id, locale: set.manifest.locale || 'en',
        canClose: diagram.id !== set.manifest.root_diagram,
        drilldowns: (set.manifest.drilldowns || []).filter((entry) => entry.from.diagram === diagram.id).map((entry) => entry.from.node),
      };
      rendered[diagram.id] = native.replace('</body>', () =>
        `<script id="archify-diagram-bridge" type="application/json">${jsonForScript(config)}</script>\n<script>${bridge}</script>\n</body>`);
      const adapter = adapters[diagram.type];
      const document = set.documents.get(diagram.id);
      documents[diagram.id] = {
        [adapter.nodes]: document[adapter.nodes].map((node) => ({ id: node.id, label: node.label || node.id })),
        [adapter.edges]: document[adapter.edges].map((edge) => ({ id: edge.id, from: edge.from, to: edge.to, label: edge.label })),
      };
    }
    const manifest = { ...set.manifest, diagrams: set.manifest.diagrams.map((diagram) => ({
      ...diagram, title: diagram.title || set.documents.get(diagram.id).meta.title,
    })) };
    const data = { manifest, documents, ...packNativeDocuments(rendered), projections: set.projections };
    const relationsSource = fs.readFileSync(path.join(skillRoot, 'diagram-set', 'relations.mjs'), 'utf8').replace(/^export /gm, '');
    const template = fs.readFileSync(path.join(skillRoot, 'assets', 'diagram-set.html'), 'utf8');
    const html = template.replace('/* ARCHIFY:SET_DATA */', () => jsonForScript(data))
      .replace('/* ARCHIFY:SET_RELATIONS */', () => relationsSource);
    if (Buffer.byteLength(html) > MAX_BUNDLE_BYTES) throwDiagnosticError('Diagram Set output exceeds 96 MiB.',
      [setDiagnostic('size-limit', 'Bundle is too large.', { input: set.input }, { bytes: Buffer.byteLength(html) }, ['split the diagram set'])]);
    return { ...set, html, checks, incremental };
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

export function bundleDiagramSet(manifestPath, requestedOutput, options = {}) {
  // Resolve against every input, then repeat the guard immediately before atomic publication.
  const cache = openDiagramSetCache(options.cacheDir);
  const loaded = loadDiagramSet(manifestPath, { cache });
  const outputGuard = {
    requestedOutput, defaultOutput: `${loaded.manifest.id}.html`, cwd: process.cwd(),
    inputPaths: loaded.sources.map((source) => source.path),
  };
  const { outputPath } = resolveOutputPath(outputGuard);
  if (cache && containedBy(cache.directory, outputPath).status !== 'different') {
    throwDiagnosticError('Bundle output cannot use the managed cache namespace.',
      [setDiagnostic('cache-output', 'Output overlaps the managed cache directory.', { output: outputPath, cache: cache.directory }, {},
        ['choose an HTML output outside the cache directory'])]);
  }
  const compiled = compileLoadedSet(loaded, { ...options, cache });
  writeStandaloneHtml(outputPath, compiled.html, { outputGuard });
  return { ...compiled, outputPath, artifact: {
    path: outputPath, bytes: Buffer.byteLength(compiled.html),
    sha256: createHash('sha256').update(compiled.html).digest('hex'),
  } };
}
