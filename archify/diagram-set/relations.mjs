export const adapters = Object.freeze({
  architecture: { nodes: 'components', edges: 'connections', projection: true, semantics: 'dependency' },
  workflow: { nodes: 'nodes', edges: 'edges', projection: false, semantics: 'control' },
  sequence: { nodes: 'participants', edges: 'messages', projection: false, semantics: 'interaction' },
  dataflow: { nodes: 'nodes', edges: 'flows', projection: false, semantics: 'data-flow' },
  lifecycle: { nodes: 'states', edges: 'transitions', projection: false, semantics: 'transition' },
});

export const nodeKey = (ref) => `${ref.diagram}:${ref.node}`;

export function relationChain(index, ids) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 32 || new Set(ids).size !== ids.length) {
    throw new Error('A relation chain needs 1-32 distinct canonical relation IDs.');
  }
  const relations = ids.map((id) => {
    const relation = index.relations.get(id);
    if (!relation) throw new Error(`Unknown chain relation: ${id}`);
    return relation;
  });
  for (let i = 1; i < relations.length; i += 1) {
    if (nodeKey(relations[i - 1].to) !== nodeKey(relations[i].from)) {
      throw new Error(`Chain hops ${ids[i - 1]} and ${ids[i]} do not join at the same canonical NodeRef.`);
    }
  }
  return { relation_ids: [...ids], from: { ...relations[0].from }, to: { ...relations.at(-1).to } };
}

export function findRelationPath(index, from, to, { kind = '', protocol = '', scope = '', maxHops = 32 } = {}) {
  for (const ref of [from, to]) {
    if (!ref || !index.nodes.get(ref.diagram)?.has(ref.node)) throw new Error('Trace endpoints must be existing canonical NodeRefs.');
  }
  if (!Number.isInteger(maxHops) || maxHops < 1 || maxHops > 32) throw new Error('Trace maxHops must be 1-32.');
  if (nodeKey(from) === nodeKey(to)) return { status: 'same-node', relation_ids: [], from: { ...from }, to: { ...to } };
  const queue = [{ ref: from, ids: [] }], visited = new Set([nodeKey(from)]);
  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    if (current.ids.length >= maxHops) continue;
    for (const id of [...(index.outgoing.get(nodeKey(current.ref)) || [])].sort()) {
      const relation = index.relations.get(id);
      if ((kind && kind !== relation.kind) || (protocol && protocol !== relation.protocol) || (scope && scope !== relation.scope)) continue;
      const ids = [...current.ids, id], key = nodeKey(relation.to);
      if (key === nodeKey(to)) return { status: 'found', ...relationChain(index, ids) };
      if (!visited.has(key)) { visited.add(key); queue.push({ ref: relation.to, ids }); }
    }
  }
  return { status: 'no-path', relation_ids: [], from: { ...from }, to: { ...to }, maxHops };
}

function directSelfAt(relation, diagram) {
  return relation.from.diagram === diagram && nodeKey(relation.from) === nodeKey(relation.to);
}

export function createRelationIndex(manifest, documents) {
  const diagrams = new Map(manifest.diagrams.map((diagram) => [diagram.id, diagram]));
  const parents = new Map((manifest.drilldowns || []).map((entry) => [entry.to_diagram, entry.from]));
  const nodes = new Map();
  const edges = new Map();
  for (const diagram of manifest.diagrams) {
    const document = documents.get(diagram.id);
    const adapter = adapters[diagram.type];
    nodes.set(diagram.id, new Map(document[adapter.nodes].map((node) => [node.id, node])));
    edges.set(diagram.id, new Map(document[adapter.edges].filter((edge) => edge.id).map((edge) => [edge.id, edge])));
  }
  const relations = new Map((manifest.relations || []).map((relation) => [relation.id, relation]));
  const ancestors = new Map();
  const paths = new Map();
  for (const diagram of diagrams.keys()) {
    const owners = new Map();
    const chain = [diagram];
    let owner = parents.get(diagram);
    while (owner && !chain.includes(owner.diagram)) {
      owners.set(owner.diagram, owner);
      chain.push(owner.diagram);
      owner = parents.get(owner.diagram);
    }
    ancestors.set(diagram, owners);
    paths.set(diagram, !owner && chain.at(-1) === manifest.root_diagram ? chain.reverse() : null);
  }
  const semanticMappings = new Map((manifest.semantic_mappings || []).map((entry) =>
    [`${entry.diagram}:${entry.relation_id}`, entry]));
  const incoming = new Map();
  const outgoing = new Map();
  for (const relation of relations.values()) {
    for (const [index, ref] of [[incoming, relation.to], [outgoing, relation.from]]) {
      const key = nodeKey(ref);
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(relation.id);
    }
  }
  return { manifest, diagrams, parents, nodes, edges, relations, incoming, outgoing,
    ancestors, paths, semanticMappings, projected: new Map() };
}

// A detail diagram has one owner. Folding changes identity only through that owner.
export function representativeAt(index, ref, diagramId) {
  const representative = ref.diagram === diagramId ? ref : index.ancestors.get(ref.diagram)?.get(diagramId);
  return representative ? { ...representative } : null;
}

export function navigationPath(index, diagramId) {
  const path = index.paths.get(diagramId);
  return path ? [...path] : null;
}

export function supportsProjection(index, diagramId) {
  return adapters[index.diagrams.get(diagramId)?.type]?.projection
    || [...index.semanticMappings.values()].some((entry) => entry.diagram === diagramId);
}

export function visibleRepresentative(index, ref, navPath) {
  for (const diagram of [...navPath].reverse()) {
    const representative = representativeAt(index, ref, diagram);
    if (representative) return representative;
  }
  return null;
}

export function projectRelations(index, navPath, filters = {}) {
  const cacheKey = JSON.stringify([navPath, filters.kind || '', filters.protocol || '', filters.scope || '', filters.direction || '']);
  if (index.projected.has(cacheKey)) return structuredClone(index.projected.get(cacheKey));
  const groups = new Map();
  const current = navPath.at(-1);
  for (const relation of index.relations.values()) {
    if (filters.kind && relation.kind !== filters.kind) continue;
    if (filters.protocol && relation.protocol !== filters.protocol) continue;
    if (filters.scope && relation.scope !== filters.scope) continue;
    const from = visibleRepresentative(index, relation.from, navPath);
    const to = visibleRepresentative(index, relation.to, navPath);
    if (!from || !to || (nodeKey(from) === nodeKey(to) && !directSelfAt(relation, current))) continue;
    if (from.diagram !== current && to.diagram !== current) continue;
    const direction = from.diagram === current && to.diagram === current ? 'internal'
      : to.diagram === current ? 'incoming' : 'outgoing';
    if (filters.direction && filters.direction !== direction) continue;
    const key = JSON.stringify([nodeKey(from), nodeKey(to), relation.kind, relation.protocol || '', relation.scope || '']);
    if (!groups.has(key)) groups.set(key, {
      key, from, to, kind: relation.kind, protocol: relation.protocol || '',
      scope: relation.scope || '', sourceRelationIds: [],
    });
    groups.get(key).sourceRelationIds.push(relation.id);
  }
  const result = [...groups.values()].map((group) => ({
    ...group, sourceRelationIds: [...new Set(group.sourceRelationIds)].sort(),
    count: new Set(group.sourceRelationIds).size,
  })).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  if (index.projected.size >= 64) index.projected.delete(index.projected.keys().next().value);
  index.projected.set(cacheKey, result);
  return structuredClone(result);
}

export function canvasRepresentative(index, ref, expanded) {
  const chain = navigationPath(index, ref.diagram);
  if (!chain) throw new Error(`Unknown diagram: ${ref.diagram}`);
  let visible = index.manifest.root_diagram;
  for (const diagram of chain.slice(1)) {
    if (!expanded.has(diagram)) break;
    visible = diagram;
  }
  return representativeAt(index, ref, visible);
}

// The frontier is a forest of open entrances, not a single active navigation path.
export function projectCanvasRelations(index, expandedDiagrams, filters = {}, focus = index.manifest.root_diagram) {
  const expanded = new Set(expandedDiagrams);
  for (const diagram of expanded) {
    const owner = index.parents.get(diagram);
    if (!owner || (owner.diagram !== index.manifest.root_diagram && !expanded.has(owner.diagram))) {
      throw new Error(`Invalid expanded entrance: ${diagram}`);
    }
  }
  if (!index.diagrams.has(focus)) throw new Error(`Unknown focus diagram: ${focus}`);
  const cacheKey = JSON.stringify(['canvas', [...expanded].sort(), focus, filters.kind || '',
    filters.protocol || '', filters.scope || '', filters.direction || '']);
  if (index.projected.has(cacheKey)) return structuredClone(index.projected.get(cacheKey));
  const groups = new Map();
  const inFocus = (ref) => index.paths.get(ref.diagram).includes(focus);
  for (const relation of index.relations.values()) {
    if (filters.kind && relation.kind !== filters.kind) continue;
    if (filters.protocol && relation.protocol !== filters.protocol) continue;
    if (filters.scope && relation.scope !== filters.scope) continue;
    const from = canvasRepresentative(index, relation.from, expanded);
    const to = canvasRepresentative(index, relation.to, expanded);
    if (nodeKey(from) === nodeKey(to)
      && !(nodeKey(relation.from) === nodeKey(relation.to) && nodeKey(from) === nodeKey(relation.from))) continue;
    const direction = inFocus(from) && inFocus(to) ? 'internal'
      : inFocus(to) ? 'incoming' : inFocus(from) ? 'outgoing' : null;
    if (filters.direction && filters.direction !== direction) continue;
    const key = JSON.stringify([nodeKey(from), nodeKey(to), relation.kind, relation.protocol || '', relation.scope || '']);
    if (!groups.has(key)) groups.set(key, { key, from, to, kind: relation.kind,
      protocol: relation.protocol || '', scope: relation.scope || '', sourceRelationIds: [] });
    groups.get(key).sourceRelationIds.push(relation.id);
  }
  const result = [...groups.values()].map((group) => ({ ...group,
    sourceRelationIds: [...new Set(group.sourceRelationIds)].sort(),
    count: new Set(group.sourceRelationIds).size,
  })).sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  if (index.projected.size >= 64) index.projected.delete(index.projected.keys().next().value);
  index.projected.set(cacheKey, result);
  return structuredClone(result);
}

export function resolveProjections(index, cache = null, incremental = null) {
  const declared = new Map((index.manifest.projections || []).map((projection) =>
    [`${projection.diagram}:${projection.relation_id}`, projection]));
  const results = [];
  for (const diagram of index.diagrams.values()) {
    if (!supportsProjection(index, diagram.id)) continue;
    const detailed = new Set((index.manifest.drilldowns || [])
      .filter((entry) => entry.from.diagram === diagram.id).map((entry) => entry.from.node));
    const folded = [...index.relations.values()].map((relation) => ({
      id: relation.id, from: representativeAt(index, relation.from, diagram.id),
      to: representativeAt(index, relation.to, diagram.id),
      kind: relation.kind, protocol: relation.protocol || '', scope: relation.scope || '',
    })).filter((relation) => relation.from && relation.to
      && (relation.from.node !== relation.to.node || directSelfAt(index.relations.get(relation.id), diagram.id)));
    const signature = JSON.stringify([
      diagram.id, [...index.edges.get(diagram.id).values()].map(({ id, from, to }) => ({ id, from, to })),
      [...detailed].sort(), [...declared.values()].filter((entry) => entry.diagram === diagram.id), folded,
      [...index.semanticMappings.values()].filter((entry) => entry.diagram === diagram.id),
    ]);
    const previous = cache?.read('projection', signature);
    if (previous) {
      results.push(...previous);
      incremental?.reused.push(diagram.id);
      continue;
    }
    const local = [];
    for (const edge of index.edges.get(diagram.id).values()) {
      const declaration = declared.get(`${diagram.id}:${edge.id}`);
      if (!declaration && !detailed.has(edge.from) && !detailed.has(edge.to)) continue;
      const candidates = folded.filter((relation) => {
        return relation.from.node === edge.from && relation.to.node === edge.to
          && (adapters[diagram.type].projection
            || index.semanticMappings.get(`${diagram.id}:${relation.id}`)?.edge_id === edge.id)
          && (!declaration?.kind || relation.kind === declaration.kind)
          && (!declaration?.protocol || relation.protocol === declaration.protocol)
          && (!declaration?.scope || relation.scope === declaration.scope);
      }).map((relation) => relation.id).sort();
      const policy = declaration?.projectionPolicy || 'declared';
      const ids = policy === 'derived' ? candidates : [...(declaration?.derived_from || [])].sort();
      const requested = declaration?.status;
      const status = policy === 'manual' ? 'unresolved'
        : requested === 'partial' ? 'partial'
          : requested === 'unresolved' || ids.length === 0 ? 'unresolved'
            : candidates.some((id) => !ids.includes(id)) ? 'partial'
            : 'resolved';
      local.push({
        diagram: diagram.id, relation_id: edge.id, from: edge.from, to: edge.to,
        derived_from: ids, candidates, status, projectionPolicy: policy,
      });
    }
    cache?.write('projection', signature, local);
    incremental?.recomputed.push(diagram.id);
    results.push(...local);
  }
  return results;
}

export function interfacePort(index, diagram, node, direction, kind) {
  const ports = (index.manifest.interfaces || []).find((entry) => entry.diagram === diagram)?.ports || [];
  return ports.find((port) => port.direction === direction && port.kind === kind && port.targets.includes(node)) || null;
}
