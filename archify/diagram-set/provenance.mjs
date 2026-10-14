import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { captureRegularFileBinding, verifyRegularFileBinding, releaseRegularFileBinding } from '../renderers/shared/atomic-output.mjs';
import { parseRepositoryRemote, repositorySourceHref } from '../renderers/shared/repository-location.mjs';
import { throwDiagnosticError } from '../renderers/shared/diagnostics.mjs';
import { setDiagnostic } from './model.mjs';
import { validatePortablePath } from '../renderers/shared/portable-path.mjs';

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

function failure(code, message, subject, evidence = {}) {
  throwDiagnosticError(message, [setDiagnostic(`evidence-${code}`, message, subject, evidence,
    ['review the cited source, correct the evidence snapshot or repository root, and run validate-set again'])]);
}
function git(root, args) {
  const env = { ...process.env };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_COMMON_DIR', 'GIT_INDEX_FILE', 'GIT_OBJECT_DIRECTORY', 'GIT_ALTERNATE_OBJECT_DIRECTORIES']) delete env[key];
  const result = spawnSync('git', ['--no-pager', '-C', root, ...args], { env, maxBuffer: MAX_FILE_BYTES, timeout: 15000 });
  if (result.error || result.status !== 0) failure('git', 'Could not verify the requested repository object.', {},
    { operation: args[0], reason: result.error?.code || result.status });
  return result.stdout;
}
function readWorkingFile(root, source) {
  const parents = [];
  let resolved = root;
  const parts = source.path.split('/');
  for (const [i, part] of parts.entries()) {
    resolved = path.join(resolved, part);
    let stat;
    try { stat = fs.lstatSync(resolved); }
    catch (error) {
      if (error.code === 'ENOENT') return null;
      failure('file', 'Could not inspect cited code.', { source: source.path }, { reason: error.code });
    }
    if (stat.isSymbolicLink() || (i < parts.length - 1 ? !stat.isDirectory() : !stat.isFile())) {
      failure('path', 'Code evidence must use regular files and real directories, not symlinks.', { source: source.path });
    }
    if (i < parts.length - 1) parents.push({ path: resolved, dev: stat.dev, ino: stat.ino });
    else if (stat.size > MAX_FILE_BYTES) failure('size', 'Cited code exceeds the 4 MiB file limit.', { source: source.path });
  }
  const captured = captureRegularFileBinding(resolved, { subject: 'evidence', includeContent: true });
  if (captured.status !== 'captured') failure('binding', 'Could not bind cited code to a stable regular file.',
    { source: source.path }, { reason: captured.reason });
  try {
    const bytes = captured.content.buffer;
    if (bytes.length > MAX_FILE_BYTES) failure('size', 'Cited code exceeds the 4 MiB file limit.', { source: source.path });
    const verified = verifyRegularFileBinding(captured.binding);
    if (verified.status !== 'match') failure('changed-during-read', 'Cited code changed while it was being checked.',
      { source: source.path }, { reason: verified.reason });
    for (const parent of parents) {
      const stat = fs.lstatSync(parent.path);
      if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== parent.dev || stat.ino !== parent.ino) {
        failure('changed-during-read', 'A cited source directory changed while it was being checked.', { source: source.path });
      }
    }
    return bytes;
  } finally {
    const released = releaseRegularFileBinding(captured.binding);
    if (released.status !== 'released') failure('release', 'Could not release the cited source file.', { source: source.path },
      { reason: released.reason });
  }
}
function hasRange(bytes, source) {
  const value = bytes.toString('utf8');
  if (value.includes('\u0000')) return false;
  const lines = value.split(/\r\n|\n|\r/).length - (/(?:\r\n|\n|\r)$/.test(value) ? 1 : 0);
  return (source.endLine || source.line) <= lines;
}

export function verifyDiagramSetEvidence(manifest, { repoRoot = process.env.ARCHIFY_REPO_ROOT } = {}) {
  const verification = {}, diagnostics = [], files = new Map(), objects = new Map();
  const location = manifest.repository_url ? parseRepositoryRemote(manifest.repository_url, { authored: true }) : null;
  let root = null, total = 0;
  if (repoRoot) {
    try { root = fs.realpathSync(repoRoot); }
    catch (error) { failure('root', 'The evidence repository root is not readable.', {}, { reason: error.code }); }
    if (!fs.statSync(root).isDirectory()) failure('root', 'The evidence repository root must be a directory.', {});
    if (location || (manifest.relations || []).some((relation) => relation.evidence.sources?.some((source) => source.commit))) {
      const top = git(root, ['rev-parse', '--show-toplevel']).toString('utf8').trim();
      if (fs.realpathSync(top) !== root) failure('root', 'Pinned source evidence requires the Git top-level directory.', {});
    }
    if (location) {
      const remote = git(root, ['config', '--get', 'remote.origin.url']).toString('utf8').trim();
      if (parseRepositoryRemote(remote)?.identity !== location.identity) {
        failure('repository', 'The checkout origin does not match repository_url.', { path: '/repository_url' });
      }
    }
  }
  for (const relation of manifest.relations || []) {
    const evidence = relation.evidence;
    const sources = [];
    for (const source of evidence.sources || []) {
      try {
        validatePortablePath(source.path, { profile: 'archive' });
        if (source.path.split('/').some((part) => part.toLowerCase() === '.git')) throw new Error('Git administration paths are not code evidence.');
      } catch (error) { failure('path', error.message, { relation: relation.id, source: source.path }); }
      let state = 'unverified', reason = 'repository-root-required', currentSha256 = null;
      if (root) {
        if (!files.has(source.path)) {
          if (files.size >= 512) failure('size', 'Source verification allows at most 512 distinct working files.', {});
          const bytes = readWorkingFile(root, source);
          total += bytes?.length || 0;
          if (total > MAX_TOTAL_BYTES) failure('size', 'Cited working files exceed 32 MiB in total.', {});
          files.set(source.path, bytes);
        }
        const bytes = files.get(source.path);
        currentSha256 = bytes ? digest(bytes) : null;
        state = currentSha256 === source.sha256 && hasRange(bytes, source) ? 'current' : 'stale';
        reason = !bytes ? 'file-missing' : currentSha256 !== source.sha256 ? 'file-changed' : 'line-range-changed';
        if (state === 'current') reason = null;
        if (source.commit) {
          const key = `${source.commit}:${source.path}`;
          if (!objects.has(key)) {
            if (objects.size >= 512) failure('size', 'Source verification allows at most 512 distinct pinned blobs.', {});
            if (git(root, ['cat-file', '-t', source.commit]).toString('utf8').trim() !== 'commit') {
              failure('commit', 'Pinned evidence must identify a full Git commit object.', { relation: relation.id });
            }
            const blob = git(root, ['cat-file', 'blob', key]);
            total += blob.length;
            if (total > MAX_TOTAL_BYTES) failure('size', 'Cited working files and Git blobs exceed 32 MiB in total.', {});
            objects.set(key, blob);
          }
          const blob = objects.get(key);
          if (digest(blob) !== source.sha256 || !hasRange(blob, source)) {
            failure('commit-mismatch', 'The evidence digest or line range does not match its pinned Git blob.',
              { relation: relation.id, source: source.path, commit: source.commit });
          }
        }
      }
      sources.push({ ...source, status: state, reason, currentSha256,
        ...(location && source.commit ? { href: repositorySourceHref(location.provider, location.url, source.commit, source) } : {}) });
    }
    const state = evidence.mode !== 'verified-source' ? evidence.mode
      : sources.some((source) => source.status === 'stale') ? 'stale'
        : sources.length && sources.every((source) => source.status === 'current') ? 'current' : 'unverified';
    verification[relation.id] = { status: state, sources };
    if (['stale', 'unverified'].includes(state)) diagnostics.push(setDiagnostic(`evidence-${state}`,
      state === 'stale' ? 'Cited code changed or disappeared; review this relation mapping.'
        : 'Source references have not been checked against a local code snapshot.',
      { relation: relation.id }, { sources: sources.map(({ path, status, reason }) => ({ path, status, reason })) },
      ['cite SHA-256 snapshots and pass --repo-root; do not treat string references as verified code'], 'warning'));
  }
  return { verification, diagnostics, sourcePaths: root ? [...files.keys()].map((relative) => path.join(root, ...relative.split('/'))) : [] };
}
