import path from 'node:path';
import { bundleDiagramSet, compileDiagramSet } from './compiler.mjs';
import { setDiagnostic } from './model.mjs';

export function commandDiagramSet(command, args) {
  const json = args.includes('--json');
  let input;
  let output;
  try {
    const positional = [];
    const options = {};
    const seen = new Set();
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i];
      if (arg === '--json') continue;
      if (arg === '--quality' || arg === '--repo-root' || arg === '--cache-dir') {
        if (seen.has(arg) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`${arg} needs exactly one value.`);
        seen.add(arg);
        options[arg === '--quality' ? 'quality' : arg === '--repo-root' ? 'repoRoot' : 'cacheDir'] = args[++i];
      } else if (arg.startsWith('--')) throw new Error(`Unknown ${command} option: ${arg}`);
      else positional.push(arg);
    }
    if (options.quality && !['standard', 'showcase'].includes(options.quality)) throw new Error('--quality must be standard or showcase.');
    if (options.repoRoot) options.repoRoot = path.resolve(options.repoRoot);
    [input, output] = positional;
    if (!input || positional.length !== (command === 'bundle' ? 2 : 1)) {
      throw new Error(command === 'bundle' ? 'Use: archify bundle <set.json> <output.html> [--json]' : 'Use: archify validate-set <set.json> [--json]');
    }
    const result = command === 'bundle'
      ? bundleDiagramSet(input, output, options)
      : compileDiagramSet(input, options);
    const receipt = {
      schemaVersion: 1, command, ok: true, input: path.resolve(input),
      set: result.manifest.id, root: result.manifest.root_diagram,
      diagrams: result.manifest.diagrams.length, relations: result.index.relations.size,
      projections: result.projections, diagnostics: result.diagnostics, checks: result.checks,
      incremental: result.incremental,
      sources: result.sources.map((source) => ({ path: source.path, sha256: source.sha256, bytes: source.bytes.length })),
      ...(result.artifact ? { artifact: result.artifact } : {}),
      offline: true, visualReview: 'not-requested',
    };
    if (json) console.log(JSON.stringify(receipt, null, 2));
    else {
      for (const diagnostic of result.diagnostics) console.error(`[${diagnostic.code}] ${diagnostic.message} ${JSON.stringify(diagnostic.subject)}`);
      console.log(`ok ${command}: ${result.manifest.id} (${receipt.diagrams} diagrams, ${receipt.relations} relation facts)${result.outputPath ? ` → ${result.outputPath}` : ''}`);
    }
  } catch (error) {
    const receipt = {
      schemaVersion: 1, command, ok: false, input: input ? path.resolve(input) : null,
      diagnostics: error.archifyDiagnostics || [setDiagnostic('command', error.message,
        { command, ...(output ? { output } : {}) }, { reason: error.code || error.name }, ['correct the command or input and retry'])],
    };
    if (json) console.log(JSON.stringify(receipt, null, 2));
    else for (const diagnostic of receipt.diagnostics) console.error(`[${diagnostic.code}] ${diagnostic.message}`);
    process.exitCode = 1;
  }
}
