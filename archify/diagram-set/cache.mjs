import fs from 'node:fs';
import path from 'node:path';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { writeStandaloneHtml } from '../renderers/shared/cli.mjs';
import { validateNativeOutputPath } from '../renderers/shared/output-path.mjs';
import { throwDiagnosticError } from '../renderers/shared/diagnostics.mjs';
import { setDiagnostic } from './model.mjs';

const skillRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const digest = (value) => createHash('sha256').update(value).digest('hex');

function failure(file, error) {
  throwDiagnosticError('Diagram Set cache could not be verified.', [
    setDiagnostic('cache', error instanceof SyntaxError ? 'Managed cache JSON is malformed.' : error.message,
      { cache: file }, { reason: error.code || error.name },
      ['use a private managed cache directory; repair or remove only the named cache file and retry']),
  ]);
}

function regularBytes(file, limit) {
  const metadata = fs.lstatSync(file);
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink !== 1 || metadata.size > limit) {
    throw new Error('Cache entry must be a bounded, single-link regular file.');
  }
  return fs.readFileSync(file);
}

export function openDiagramSetCache(directory) {
  if (!directory) return null;
  const requested = path.resolve(directory);
  const header = path.join(requested, '.archify-set-cache.json');
  try {
    validateNativeOutputPath(directory, { kind: 'directory' });
    fs.mkdirSync(requested, { recursive: true, mode: 0o700 });
    if (!fs.existsSync(header)) {
      if (fs.readdirSync(requested).length) throw new Error('Refusing to adopt a non-empty unmanaged cache directory.');
      fs.writeFileSync(header, JSON.stringify({ schemaVersion: 1, key: randomBytes(32).toString('hex') }),
        { flag: 'wx', mode: 0o600 });
    }
    const identity = JSON.parse(regularBytes(header, 4096).toString('utf8'));
    if (identity.schemaVersion !== 1 || !/^[a-f0-9]{64}$/.test(identity.key)) {
      throw new Error('Directory contains an unmanaged or incompatible cache identity.');
    }
    const root = fs.realpathSync(requested);
    const graphVersion = digest(fs.readFileSync(path.join(skillRoot, 'diagram-set', 'relations.mjs')));
    const sign = (kind, signature, payload) => createHmac('sha256', Buffer.from(identity.key, 'hex'))
      .update(`${kind}:${graphVersion}:${signature}\0`).update(payload).digest('hex');
    const location = (kind, signature) => path.join(root, `archify-${digest(`${kind}:${graphVersion}:${signature}`)}.json`);
    return {
      directory: root,
      read(kind, signature) {
        const file = location(kind, signature);
        try {
          if (!fs.existsSync(file)) return null;
          // The native HTML string is escaped once in the payload and again in its JSON envelope.
          const entry = JSON.parse(regularBytes(file, 192 * 1024 * 1024 + 4096).toString('utf8'));
          if (entry.kind !== kind || typeof entry.payload !== 'string' || !/^[a-f0-9]{64}$/.test(entry.mac)
            || !timingSafeEqual(Buffer.from(entry.mac, 'hex'), Buffer.from(sign(kind, signature, entry.payload), 'hex'))) {
            throw new Error('Cache entry integrity check failed.');
          }
          return JSON.parse(entry.payload);
        } catch (error) { failure(file, error); }
      },
      write(kind, signature, value) {
        const file = location(kind, signature);
        try {
          const payload = JSON.stringify(value);
          writeStandaloneHtml(file, JSON.stringify({ kind, payload, mac: sign(kind, signature, payload) }));
        } catch (error) { failure(file, error); }
      },
    };
  } catch (error) { failure(header, error); }
}

export function nativeRuntimeSignature() {
  const hash = createHash('sha256');
  function collect(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const file = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Runtime signature cannot follow symlinks: ${file}`);
      if (entry.isDirectory()) collect(file);
      else if (entry.isFile() && /\.(mjs|json|html)$/.test(entry.name)) {
        hash.update(path.relative(skillRoot, file).split(path.sep).join('/')); hash.update(fs.readFileSync(file));
      }
    }
  }
  collect(path.join(skillRoot, 'renderers'));
  collect(path.join(skillRoot, 'schemas'));
  for (const file of ['assets/template.html', 'scripts/check-render-output.mjs', 'package.json']) {
    hash.update(file); hash.update(fs.readFileSync(path.join(skillRoot, ...file.split('/'))));
  }
  hash.update(process.versions.node);
  return hash.digest('hex');
}
