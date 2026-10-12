import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { validateSchema } from '../renderers/shared/validator.mjs';
import { validatePortablePath } from '../renderers/shared/portable-path.mjs';
import { validateCrossCollectionContracts } from '../renderers/shared/cli.mjs';
import { throwDiagnosticError } from '../renderers/shared/diagnostics.mjs';
import { adapters, createRelationIndex, navigationPath, nodeKey, representativeAt, resolveProjections, supportsProjection } from './relations.mjs';

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_SET_BYTES = 32 * 1024 * 1024;

export function setDiagnostic(code, message, subject = {}, evidence = {}, supportedFixes = [], severity = 'error') {
  return { code: `diagram-set/${code}`, severity, message, subject, evidence, supportedFixes };
}

function readJson(file) {
  try {
    const descriptor = fs.openSync(file, 'r');
    let bytes;
    try {
      const stat = fs.fstatSync(descriptor);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) {
        throw new Error(`Expected a regular JSON file of at most ${MAX_FILE_BYTES} bytes.`);
      }
      bytes = fs.readFileSync(descriptor);
      if (bytes.length > MAX_FILE_BYTES) throw new Error('JSON file grew beyond the size limit.');
    } finally {
      fs.closeSync(descriptor);
    }
    return { document: JSON.parse(bytes.toString('utf8')), bytes, path: file,
      sha256: createHash('sha256').update(bytes).digest('hex') };
  } catch (error) {
    throwDiagnosticError(`Could not load diagram-set input: ${error.message}`, [
      setDiagnostic('input', error.message, { input: file }, { reason: error.code || error.name },
        ['provide a readable, bounded regular file containing valid JSON']),
    ]);
  }
}

export function loadDiagramSet(manifestPath, { cache = null } = {}) {
  const input = path.resolve(manifestPath);
  const manifestInput = readJson(input);
  const manifest = manifestInput.document;
  try {
    validateSchema('diagramSet', manifest);
  } catch (error) {
    if (!error.archifyDiagnostics) throw error;
    throwDiagnosticError(error.message, error.archifyDiagnostics.map((entry) => ({
      ...entry,
      supportedFixes: entry.supportedFixes.length ? entry.supportedFixes
        : [entry.code === 'schema/uniqueItems' ? 'remove duplicate relation IDs or port targets'
          : 'satisfy the conditional field requirements in schemas/diagram-set.schema.json'],
    })));
  }
  const base = fs.realpathSync(path.dirname(input));
  const documents = new Map();
  const sources = [manifestInput];
  const diagnostics = [];
  let size = manifestInput.bytes.length;
  const diagramIds = new Set();
  const physicalSources = new Set();
  for (const [position, diagram] of manifest.diagrams.entries()) {
    const subject = { diagram: diagram.id, path: `/diagrams/${position}` };
    if (diagramIds.has(diagram.id)) {
      diagnostics.push(setDiagnostic('duplicate-id', 'Diagram IDs must be unique.', subject, { id: diagram.id }, ['rename the duplicate diagram ID and its references']));
    }
    diagramIds.add(diagram.id);
    let resolved;
    try {
      validatePortablePath(diagram.source, { profile: 'archive' });
      if (!/\.json$/i.test(diagram.source)) throw new Error('Diagram sources must have a .json extension.');
      resolved = fs.realpathSync(path.resolve(base, ...diagram.source.split('/')));
      const relative = path.relative(base, resolved);
      if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error('Diagram source escapes the manifest directory, including through a symlink.');
      }
      if (physicalSources.has(resolved)) throw new Error('Each diagram must have a distinct source file.');
      physicalSources.add(resolved);
    } catch (error) {
      diagnostics.push(setDiagnostic('source-path', error.message, { ...subject, source: diagram.source },
        { reason: error.reason || error.code || error.name },
        ['use a distinct portable relative JSON path inside the manifest directory; do not use remote URLs or escaping symlinks']));
      continue;
    }
    const source = readJson(resolved);
    size += source.bytes.length;
    if (size > MAX_SET_BYTES) {
      throwDiagnosticError('Diagram Set exceeds the total input size limit.', [
        setDiagnostic('size-limit', 'Diagram Set inputs exceed 32 MiB.', { input }, { bytes: size }, ['split the set into smaller sets']),
      ]);
    }
    try {
      validateSchema(diagram.type, source.document);
      validateCrossCollectionContracts(diagram.type, source.document);
      const ids = source.document[adapters[diagram.type].nodes].map((node) => node.id);
      if (new Set(ids).size !== ids.length) throw new Error('Semantic node IDs must be unique within each diagram.');
      if (ids.length > 1000) throw new Error('A diagram may contain at most 1000 semantic nodes in a Diagram Set.');
    } catch (error) {
      diagnostics.push(...(error.archifyDiagnostics || [setDiagnostic('node-id', error.message, subject, {}, ['use unique semantic node IDs'])])
        .map((entry) => ({ ...entry, subject: { ...entry.subject, diagram: diagram.id, source: diagram.source } })));
      continue;
    }
    sources.push(source);
    documents.set(diagram.id, source.document);
  }
  if (diagnostics.length) throwDiagnosticError('Diagram Set sources are invalid.', diagnostics);
  const index = createRelationIndex(manifest, documents);
  const problem = (code, message, subject, evidence, fix) =>
    diagnostics.push(setDiagnostic(code, message, subject, evidence, [fix]));
  const checkRef = (ref, subject) => {
    if (!index.nodes.get(ref.diagram)?.has(ref.node)) {
      problem('node-reference', 'NodeRef does not name an existing semantic node.', subject, ref, 'reference an existing diagram ID and semantic node ID');
      return false;
    }
    return true;
  };
  if (!index.diagrams.has(manifest.root_diagram)) {
    problem('root', 'root_diagram must exist.', { path: '/root_diagram' }, { root: manifest.root_diagram }, 'choose an existing root diagram ID');
  }
  const parents = new Set();
  const entrances = new Set();
  for (const [position, entry] of (manifest.drilldowns || []).entries()) {
    const subject = { path: `/drilldowns/${position}` };
    checkRef(entry.from, subject);
    if (!index.diagrams.has(entry.to_diagram)) {
      problem('child-reference', 'Detail diagram does not exist.', subject, entry, 'reference an existing detail diagram');
    }
    if (parents.has(entry.to_diagram) || entrances.has(nodeKey(entry.from))) {
      problem('shared-child', 'Each child and each entrance must have a unique owner.', subject, entry, 'use a tree with one detail diagram per parent node');
    }
    if (entry.to_diagram === manifest.root_diagram) {
      problem('cycle', 'The root diagram cannot have a parent.', subject, entry, 'remove the root drilldown entrance');
    }
    parents.add(entry.to_diagram);
    entrances.add(nodeKey(entry.from));
  }
  for (const diagram of manifest.diagrams) {
    if (!navigationPath(index, diagram.id)) {
      problem('unreachable', 'Diagram is orphaned or belongs to a drilldown cycle.', { diagram: diagram.id }, {}, 'connect the diagram to the root through an acyclic, unique-parent path');
    }
    const owners = (manifest.drilldowns || []).filter((entry) => entry.from.diagram === diagram.id).map((entry) => entry.from.node);
    for (const edge of documents.get(diagram.id)[adapters[diagram.type].edges]) {
      if ((owners.includes(edge.from) || owners.includes(edge.to)) && !edge.id) {
        problem('stable-edge-id', 'Relationships incident to drilldown entrances require authored IDs.', { diagram: diagram.id }, { from: edge.from, to: edge.to }, 'add a durable ID to the relationship; do not use an array index');
      }
    }
  }
  const mappingIds = new Set();
  for (const [position, mapping] of (manifest.semantic_mappings || []).entries()) {
    const subject = { path: `/semantic_mappings/${position}`, diagram: mapping.diagram, relation: mapping.relation_id };
    const key = `${mapping.diagram}:${mapping.relation_id}`;
    if (mappingIds.has(key)) problem('duplicate-semantic-mapping', 'Each fact has at most one semantic mapping per diagram.', subject, {},
      'use distinct fact IDs for distinct native interactions');
    mappingIds.add(key);
    const relation = index.relations.get(mapping.relation_id);
    const diagram = index.diagrams.get(mapping.diagram);
    const edge = index.edges.get(mapping.diagram)?.get(mapping.edge_id);
    if (!relation || !diagram || !edge || !mapping.explanation.trim() || mapping.semantics !== adapters[diagram.type].semantics) {
      problem('semantic-mapping', 'Semantic mapping must identify a canonical fact, a native edge and its actual diagram semantics.',
        subject, mapping, 'reference an existing authored edge and the capability matrix semantics; do not infer equivalence from labels');
      continue;
    }
    const from = representativeAt(index, relation.from, diagram.id);
    const to = representativeAt(index, relation.to, diagram.id);
    if ((!from && !to) || (from && from.node !== edge.from) || (to && to.node !== edge.to)) {
      problem('semantic-mapping', 'Native mapping contradicts the directed canonical endpoints or their legal ancestors.',
        subject, { edge: { from: edge.from, to: edge.to }, from, to },
        'correct the mapping direction or endpoints; explain the outside endpoint correspondence explicitly');
    }
  }
  const relationIds = new Set();
  for (const [position, relation] of (manifest.relations || []).entries()) {
    const subject = { relation: relation.id, path: `/relations/${position}` };
    if (relationIds.has(relation.id)) problem('duplicate-id', 'Relation IDs must be unique.', subject, {}, 'rename or remove the duplicate fact');
    relationIds.add(relation.id);
    checkRef(relation.from, subject);
    checkRef(relation.to, subject);
    if ([relation.from, relation.to].some((ref) => !adapters[index.diagrams.get(ref.diagram)?.type]?.projection
      && !index.semanticMappings.has(`${ref.diagram}:${relation.id}`))) {
      problem('unsupported-semantics', 'Non-Architecture endpoints require an explicit, typed native-edge correspondence.', subject, relation,
        'declare semantic_mappings for each non-Architecture endpoint, with an authored edge ID and an explanation; otherwise keep navigation-only');
    }
  }
  const projectionIds = new Set();
  for (const [position, projection] of (manifest.projections || []).entries()) {
    const subject = { diagram: projection.diagram, relation: projection.relation_id, path: `/projections/${position}` };
    const key = `${projection.diagram}:${projection.relation_id}`;
    const edge = index.edges.get(projection.diagram)?.get(projection.relation_id);
    if (projectionIds.has(key)) problem('duplicate-projection', 'A parent edge may have only one projection declaration.', subject, {}, 'combine or remove duplicate declarations');
    projectionIds.add(key);
    if (!edge || !supportsProjection(index, projection.diagram)) {
      problem('projection-reference', 'Projection must name an authored relationship in a semantically enabled diagram.', subject, {}, 'reference an Architecture edge or declare a typed semantic correspondence first');
      continue;
    }
    if (projection.projectionPolicy === 'manual' && (projection.derived_from || []).length) {
      problem('manual-projection', 'A manual conceptual edge cannot claim underlying relations.', subject, {}, 'remove derived_from or use a declared/derived policy');
    }
    if (projection.projectionPolicy === 'derived' && (projection.derived_from || []).length) {
      problem('derived-projection', 'Derived policy computes its sources; it must not contain a second authored list.', subject, {}, 'remove derived_from');
    }
    if (projection.projectionPolicy === 'derived' && projection.status === 'unresolved') {
      problem('projection-status', 'Derived policy cannot suppress known facts as unresolved.', subject, {}, 'omit status and let projection resolve from canonical facts');
    }
    if (projection.projectionPolicy === 'derived') {
      const reversed = [...index.relations.values()].filter((relation) => {
        const from = representativeAt(index, relation.from, projection.diagram);
        const to = representativeAt(index, relation.to, projection.diagram);
        return from?.node === edge.to && to?.node === edge.from
          && (!projection.kind || relation.kind === projection.kind)
          && (!projection.protocol || relation.protocol === projection.protocol)
          && (!projection.scope || relation.scope === projection.scope);
      });
      const reverseEdge = [...index.edges.get(projection.diagram).values()]
        .some((candidate) => candidate.from === edge.to && candidate.to === edge.from);
      if (reversed.length && !reverseEdge) problem('projection-conflict', 'Derived parent edge has unrepresented reverse-direction facts in the same semantic scope.',
        subject, { reverseRelations: reversed.map((relation) => relation.id) },
        'model reverse/request-response directions as separate parent edges and kinds; never treat them as undirected');
    }
    for (const id of projection.derived_from || []) {
      const relation = index.relations.get(id);
      if (!relation) {
        problem('relation-reference', 'Projection source relation is missing.', subject, { id }, 'reference an existing canonical relation ID');
        continue;
      }
      const from = representativeAt(index, relation.from, projection.diagram);
      const to = representativeAt(index, relation.to, projection.diagram);
      if (!adapters[index.diagrams.get(projection.diagram).type].projection
        && index.semanticMappings.get(`${projection.diagram}:${id}`)?.edge_id !== edge.id) {
        problem('unsupported-semantics', 'Typed parent projections require a per-fact correspondence to this exact native edge.',
          subject, { id, edge: edge.id }, 'declare the matching typed semantic mapping; do not infer equivalence through another mapping');
      }
      if (from?.node !== edge.from || to?.node !== edge.to
        || (projection.kind && relation.kind !== projection.kind)
        || (projection.protocol && relation.protocol !== projection.protocol)
        || (projection.scope && relation.scope !== projection.scope)) {
        problem('projection-conflict', 'Parent direction, endpoints or declared semantics contradict the underlying fact.', subject,
          { id, expected: { from: edge.from, to: edge.to }, actual: { from, to, kind: relation.kind, protocol: relation.protocol, scope: relation.scope } },
          'correct the parent edge or its mapping without reversing or inventing facts');
      }
    }
    if (projection.status === 'unresolved' && (projection.derived_from || []).length) {
      problem('projection-status', 'Unresolved projections cannot claim resolved sources.', subject, {}, 'use partial or resolved for known sources');
    }
    if (['resolved', 'partial', 'declared'].includes(projection.status) && projection.projectionPolicy !== 'derived'
      && !(projection.derived_from || []).length && projection.projectionPolicy !== 'manual') {
      problem('projection-status', 'A resolved/partial declaration needs at least one underlying fact.', subject, {}, 'supply known relation IDs or mark the mapping unresolved');
    }
  }
  const interfaceIds = new Set();
  for (const [position, entry] of (manifest.interfaces || []).entries()) {
    const subject = { diagram: entry.diagram, path: `/interfaces/${position}` };
    if (interfaceIds.has(entry.diagram)) problem('duplicate-interface', 'A diagram has at most one interface declaration.', subject, {}, 'combine interface ports');
    interfaceIds.add(entry.diagram);
    if (nodeKey(index.parents.get(entry.diagram) || {}) !== nodeKey(entry.owner)) {
      problem('interface-owner', 'Interface owner must match the child drilldown entrance.', subject, entry, 'use the exact declared parent NodeRef');
    }
    const portIds = new Set();
    const assignments = new Set();
    for (const port of entry.ports) {
      if (portIds.has(port.id)) problem('duplicate-port', 'Port IDs must be unique within an interface.', subject, { id: port.id }, 'rename the duplicate port');
      portIds.add(port.id);
      for (const node of port.targets) {
        checkRef({ diagram: entry.diagram, node }, subject);
        const assignment = `${port.direction}:${port.kind}:${node}`;
        if (assignments.has(assignment)) problem('ambiguous-port', 'A node/kind/direction may select only one port.', subject, { node, kind: port.kind }, 'remove the overlapping port assignment');
        assignments.add(assignment);
      }
    }
  }
  if (diagnostics.length) throwDiagnosticError('Diagram Set references are invalid.', diagnostics);
  const incremental = { reused: [], recomputed: [] };
  const projections = resolveProjections(index, cache, incremental);
  for (const projection of projections) {
    if (projection.status !== 'resolved') diagnostics.push(setDiagnostic('unresolved', 'Parent relationship has incomplete or manual detail mapping.',
      { diagram: projection.diagram, relation: projection.relation_id }, { status: projection.status, knownRelations: projection.derived_from },
      ['supply confirmed relation IDs or retain the explicit unresolved/partial status'], 'warning'));
  }
  return { manifest, documents, index, projections, diagnostics, sources, input, incremental };
}
