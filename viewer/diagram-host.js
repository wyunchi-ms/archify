const data = JSON.parse(document.getElementById('diagram-set-data').textContent);
const manifest = data.manifest;
const index = createRelationIndex(manifest, new Map(Object.entries(data.documents)));
const byId = (id) => document.getElementById(id);
const stage = byId('stage');
const svg = byId('bridges');
const scenes = new Map();
const saved = new Map();
const opened = new Set();
const bundles = new Map();
const pending = new Map();
const nodeTargets = new Map();
const cameraBefore = new Map();
const routeCache = new Map();
let trace = null;
let canvasNodes = [];
let canvasRoutes = [];
let canvasLabels = [];
let paintLimit = 32;
let culledGroups = 0;
let deferredGroups = 0;
let qualitySignature = '';
const maxCameraScale = 100000;
let path = [manifest.root_diagram];
let kind = '';
let extraFilters = { protocol: '', scope: '', direction: '' };
let selected = null;
let selectedBucket = null;
let drawFrame = 0;
let requestNumber = 0;
let revision = 0;
let camera = { scale: 1, x: 0, y: 0 };
let baseScale = 1;
let initialFit = true;
let initialSharedCamera = null;
let cameraMotion = null;
let pendingFocus = null;
let visiblePoints = new Map();
let morphSeed = null;
let morphStart = null;
let gesture = null;
let suppressClick = false;
const pointers = new Map();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let theme = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
const words = {
  en: {
    relations: 'Relations', kind: 'Kind', protocol: 'Protocol', scope: 'Scope', direction: 'Direction',
    all: 'All kinds', allProtocols: 'All protocols', allScopes: 'All scopes', allDirections: 'All directions',
    incoming: 'Incoming', outgoing: 'Outgoing', internal: 'Within focused hierarchy',
    search: 'Find a node or relationship', filters: 'Filter relationships', fit: 'Fit',
    hint: 'Drag to explore · Scroll to zoom · Click a + node to expand',
    expand: 'Separate links', collapse: 'Bundle links', close: 'Collapse', links: 'links',
    visible: 'visible groups', empty: 'No relationships match this view.',
    provenance: 'Source and hierarchy', source: 'Evidence', loading: 'Loading',
    unresolved: 'Detail unknown', partial: 'Incomplete detail', resolved: 'Mapped',
    badPath: 'Invalid canvas hierarchy; returned to the root.',
    unexpectedNavigation: 'Unexpected diagram navigation. Reload this HTML to restore the canvas.',
    chains: 'Trace a directed chain', chooseChain: 'Choose a chain', clearChain: 'Clear trace',
    noPath: 'No confirmed directed path connects these endpoints.', quality: 'Canvas quality',
    current: 'Snapshot current', stale: 'Source changed: review mapping', unverified: 'Source not verified',
    authored: 'Authored fact', assumption: 'Explicit assumption', sourceBuild: 'Checked at build time, not continuously.',
    zoomIn: 'Zoom in', zoomOut: 'Zoom out', closeRelations: 'Close relationships', canvas: 'Architecture canvas',
  },
  'zh-CN': {
    relations: '关系', kind: '类型', protocol: '协议', scope: '范围', direction: '方向',
    all: '所有类型', allProtocols: '所有协议', allScopes: '所有范围', allDirections: '所有方向',
    incoming: '入站', outgoing: '出站', internal: '焦点层级内',
    search: '查找节点或关系', filters: '筛选关系', fit: '适应',
    hint: '拖动画布 · 滚动缩放 · 点击 + 节点原地展开',
    expand: '拆分连线', collapse: '合并连线', close: '收起', links: '条关系',
    visible: '个可见分组', empty: '当前视图没有匹配的关系。',
    provenance: '来源与层级', source: '证据', loading: '正在加载',
    unresolved: '细节未知', partial: '细节不完整', resolved: '已映射',
    badPath: '无效的画布层级，已返回主图。',
    unexpectedNavigation: '图页面发生了意外跳转。请重新加载 HTML 恢复画布。',
    chains: '追踪有向链路', chooseChain: '选择链路', clearChain: '清除追踪',
    noPath: '这些端点之间没有已确认的有向路径。', quality: '画布质量',
    current: '来源快照一致', stale: '来源已变化：请复核映射', unverified: '来源未验证',
    authored: '作者声明的事实', assumption: '明确假设', sourceBuild: '仅在构建时校验，不会持续检查代码。',
    zoomIn: '放大', zoomOut: '缩小', closeRelations: '关闭关系面板', canvas: '架构画布',
  },
};
const text = words[manifest.locale || 'en'];
document.documentElement.lang = manifest.locale || 'en';
document.title = `${manifest.title || manifest.id} — Archify`;
byId('set-title').textContent = manifest.title || manifest.id;
for (const [id, key] of Object.entries({
  'relations-toggle': 'relations', 'relations-heading': 'relations', 'kind-label': 'kind',
  'protocol-label': 'protocol', 'scope-label': 'scope', 'direction-label': 'direction',
  'search-label': 'search', 'filters-label': 'filters', fit: 'fit', 'canvas-hint': 'hint',
  'chains-label': 'chains', 'chain-select-label': 'chooseChain', 'quality-label': 'quality',
})) byId(id).textContent = text[key];
byId('global-search').placeholder = text.search;
for (const [id, key] of Object.entries({ 'zoom-in': 'zoomIn', 'zoom-out': 'zoomOut', 'relations-close': 'closeRelations', stage: 'canvas' })) {
  byId(id).setAttribute('aria-label', text[key]);
}
function status(message, error = false) {
  byId('set-status').textContent = message;
  byId('set-status').hidden = !error;
  byId('set-status').setAttribute('data-error', String(error));
}
function button(label, action) {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.addEventListener('click', action);
  return element;
}
function el(name, attrs, content) {
  const element = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [key, value] of Object.entries(attrs || {})) element.setAttribute(key, value);
  if (content !== undefined) element.textContent = content;
  return element;
}
function current() { return scenes.get(path.at(-1)); }
function filters() { return { kind, ...extraFilters }; }
function groups() { return projectCanvasRelations(index, opened, filters(), path.at(-1)); }
function labelRef(ref) { return index.nodes.get(ref.diagram).get(ref.node).label; }
function rootRef(ref) { return representativeAt(index, ref, manifest.root_diagram); }
function bucketRefs(group) {
  const chain = navigationPath(index, group.from.diagram);
  for (const diagram of chain) {
    const from = representativeAt(index, group.from, diagram), to = representativeAt(index, group.to, diagram);
    if (from && to && (nodeKey(from) !== nodeKey(to) || diagram === group.from.diagram)) return { from, to };
  }
  return { from: rootRef(group.from), to: rootRef(group.to) };
}
function bucketKey(group) {
  const { from, to } = bucketRefs(group);
  return JSON.stringify([nodeKey(from), nodeKey(to),
    group.kind, group.protocol, group.scope]);
}
function hierarchyLabel(ref) {
  const chain = navigationPath(index, ref.diagram);
  return [index.diagrams.get(chain[0]).title, ...chain.slice(1).map((id) => labelRef(index.parents.get(id))),
    labelRef(ref)].join(' / ');
}
function post(scene, type, payload = {}) {
  if (scene && !scene.ready && ['FOCUS_NODE', 'FOCUS_RELATION'].includes(type)) {
    scene.commands.push({ type, payload });
    return;
  }
  if (scene?.ready) scene.frame.contentWindow.postMessage({
    channel: 'archify-diagram-set', diagram: scene.id, type, payload,
  }, '*');
}
function nativeDocument(id) {
  const parts = data.rendered[id];
  if (!Array.isArray(parts) || !Array.isArray(data.runtime)) throw new Error(`Native document is not packed: ${id}`);
  return parts.map((part) => {
    if (typeof part === 'string') return part;
    if (!Number.isSafeInteger(part) || part < 0 || typeof data.runtime[part] !== 'string') {
      throw new Error(`Invalid shared native resource in diagram: ${id}`);
    }
    return data.runtime[part];
  }).join('');
}
function ensureScene(id) {
  if (scenes.has(id)) return scenes.get(id);
  const token = [...crypto.getRandomValues(new Uint8Array(16))].map((value) => value.toString(16).padStart(2, '0')).join('');
  const frame = document.createElement('iframe');
  frame.className = `diagram-layer${id !== manifest.root_diagram ? ' is-detail' : ''}`;
  frame.title = index.diagrams.get(id).title;
  frame.name = id;
  frame.setAttribute('sandbox', 'allow-scripts allow-downloads');
  frame.setAttribute('data-diagram', id);
  frame.tabIndex = -1;
  frame.setAttribute('aria-hidden', 'true');
  frame.style.width = `${Math.min(640, stage.clientWidth)}px`;
  frame.style.height = '480px';
  frame.style.opacity = '0';
  frame.style.transform = `translate(${(20 - camera.x) / camera.scale}px,${(80 - camera.y) / camera.scale}px) scale(${1 / camera.scale})`;
  const scene = { id, token, frame, ready: false, geometry: {}, edges: {}, bounds: null,
    layout: null, state: null, commands: [], visibility: '', timer: null };
  scenes.set(id, scene);
  let loaded = false;
  frame.addEventListener('load', () => {
    scene.ready = false;
    if (loaded) {
      scene.token = null;
      if (scene.timer) clearTimeout(scene.timer);
      status(text.unexpectedNavigation, true);
      return;
    }
    loaded = true;
    frame.contentWindow.postMessage({ channel: 'archify-diagram-set', diagram: id, type: 'INIT', payload: {} }, '*');
    scene.timer = setTimeout(() => {
      if (!scene.ready) status(`${text.loading}: ${frame.title} — timeout`, true);
    }, 15000);
  });
  const source = nativeDocument(id);
  const marker = '<script id="archify-diagram-bridge" type="application/json">';
  const start = source.indexOf(marker), end = source.indexOf('<\/script>', start + marker.length);
  if (start < 0 || end < 0) throw new Error('Native diagram bridge configuration is missing.');
  const configuration = JSON.parse(source.slice(start + marker.length, end));
  configuration.token = token;
  configuration.canvas = true;
  const configured = JSON.stringify(configuration).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  frame.srcdoc = source.slice(0, start + marker.length) + configured + source.slice(end);
  // Counter the camera while loading: browsers suspend layout rAFs in offscreen iframes.
  // Keep the same DOM parent, because reparenting an iframe can reload its document.
  byId('layers').appendChild(frame);
  return scene;
}
function removeScene(id) {
  const scene = scenes.get(id);
  if (!scene) return;
  saved.set(id, scene.state);
  post(scene, 'ACTIVATE', { active: false });
  scene.token = null;
  if (scene.timer) clearTimeout(scene.timer);
  for (const request of [...pending.values()]) if (request.scene === scene) request.reject(new Error('Diagram closed during export.'));
  scene.frame.remove();
  scenes.delete(id);
}
function validPath(candidate) {
  return Array.isArray(candidate) && candidate.length > 0 && candidate.length <= manifest.diagrams.length
    && candidate[0] === manifest.root_diagram
    && candidate.every((id, i) => index.diagrams.has(id) && (!i || index.parents.get(id)?.diagram === candidate[i - 1]));
}
function validCamera(value) {
  return value && [value.scale, value.x, value.y].every(Number.isFinite)
    && value.scale >= .02 && value.scale <= maxCameraScale && Math.abs(value.x) <= 1e12 && Math.abs(value.y) <= 1e12;
}
function worldPoint(scene, point) {
  return { x: scene.layout.x + point.x * scene.layout.scale, y: scene.layout.y + point.y * scene.layout.scale };
}
function nodeRect(ref) {
  const scene = scenes.get(ref.diagram), box = scene?.geometry[ref.node];
  if (!scene?.layout || !box) return null;
  return { ...worldPoint(scene, box), width: box.width * scene.layout.scale, height: box.height * scene.layout.scale };
}
function screenPoint(point) { return { x: camera.x + point.x * camera.scale, y: camera.y + point.y * camera.scale }; }
function screenRect(box) { return { ...screenPoint(box), width: box.width * camera.scale, height: box.height * camera.scale }; }
function intersects(box) {
  return box.x + box.width >= 0 && box.y + box.height >= 0 && box.x <= stage.clientWidth && box.y <= stage.clientHeight;
}
function entrance(diagram, node) {
  return (manifest.drilldowns || []).find((entry) => entry.from.diagram === diagram && entry.from.node === node);
}
function beginMorph() {
  morphSeed = reducedMotion.matches || !visiblePoints.size ? null : new Map(visiblePoints);
  morphStart = null;
}
function fitted(box, padding = 72) {
  const scale = Math.max(.02, Math.min(maxCameraScale, (Math.max(80, stage.clientWidth - padding)) / box.width,
    (Math.max(80, stage.clientHeight - padding)) / box.height));
  return { scale, x: stage.clientWidth / 2 - (box.x + box.width / 2) * scale,
    y: stage.clientHeight / 2 - (box.y + box.height / 2) * scale };
}
function moveCamera(next, animate = false) {
  if (!validCamera(next)) throw new Error('Invalid canvas camera.');
  cameraMotion = animate && !reducedMotion.matches ? { from: { ...camera }, to: next, start: performance.now() } : null;
  if (!cameraMotion) camera = { ...next };
  revision += 1;
  scheduleDraw();
}
function fit() {
  const root = scenes.get(manifest.root_diagram);
  if (!root?.bounds) return;
  const next = fitted({ x: 0, y: 0, ...root.bounds });
  baseScale = next.scale;
  moveCamera(next, true);
}
function focusScene(id, animate = true) {
  const scene = scenes.get(id);
  if (!scene?.layout || !scene.bounds) { pendingFocus = { id, animate }; return; }
  const box = { x: scene.layout.x, y: scene.layout.y,
    width: scene.bounds.width * scene.layout.scale, height: scene.bounds.height * scene.layout.scale };
  const natural = Math.max(.02, Math.min(maxCameraScale, baseScale / scene.layout.scale));
  const limit = fitted(box).scale;
  const scale = Math.min(natural, limit);
  moveCamera({ scale, x: stage.clientWidth / 2 - (box.x + box.width / 2) * scale,
    y: stage.clientHeight / 2 - (box.y + box.height / 2) * scale }, animate);
}
function saveLocation() {
  history.replaceState({ path: [...path], opened: [...opened], camera: { ...camera } }, '', location.href);
}
function locationUpdate(push = true, includeCamera = false) {
  const params = new URLSearchParams({ path: path.join('/') });
  if (opened.size) params.set('open', [...opened].sort().join(','));
  if (selected) params.set('relation', selected);
  if (trace) { params.set('trace', trace.relation_ids.join(',')); params.set('hop', String(trace.step)); }
  for (const [key, value] of Object.entries(filters())) if (value) params.set(key, value);
  if (includeCamera) params.set('camera', [camera.scale, camera.x, camera.y].join(','));
  const hash = `#${params}`;
  const state = { path: [...path], opened: [...opened], camera: { ...camera } };
  if (push) history.pushState(state, '', hash);
  else history.replaceState(state, '', hash);
}
function expand(diagram, node) {
  const child = entrance(diagram, node);
  if (!child || !scenes.get(diagram)?.ready) {
    status(`Cannot expand entrance: ${diagram}:${node}`, true);
    return false;
  }
  if (opened.has(child.to_diagram)) return true;
  saveLocation();
  cameraBefore.set(child.to_diagram, { ...camera });
  beginMorph();
  opened.add(child.to_diagram);
  ensureScene(child.to_diagram);
  path = navigationPath(index, child.to_diagram);
  pendingFocus = { id: child.to_diagram, animate: true };
  revision += 1;
  locationUpdate();
  updateChrome(); renderRelations(); scheduleDraw();
  status('', false);
  return true;
}
function collapse(id = path.at(-1)) {
  if (id === manifest.root_diagram || !opened.has(id)) return;
  saveLocation();
  beginMorph();
  const returnTo = index.parents.get(id).diagram;
  for (const open of [...opened]) if (navigationPath(index, open).includes(id)) {
    opened.delete(open); removeScene(open);
  }
  if (path.includes(id)) path = navigationPath(index, returnTo);
  pendingFocus = null;
  const previous = cameraBefore.get(id);
  if (previous) moveCamera(previous, true);
  else focusScene(returnTo);
  revision += 1;
  locationUpdate(); updateChrome(); renderRelations(); scheduleDraw();
  status('', false);
}
function navigate(next, push = true) {
  if (!validPath(next)) {
    next = [manifest.root_diagram];
    status(text.badPath, true);
  } else status('', false);
  if (push) saveLocation();
  beginMorph();
  if (next.length === 1) {
    for (const id of [...opened]) removeScene(id);
    opened.clear();
  } else for (const id of next.slice(1)) { opened.add(id); ensureScene(id); }
  ensureScene(manifest.root_diagram);
  path = [...next];
  pendingFocus = { id: next.at(-1), animate: push };
  revision += 1;
  locationUpdate(push); updateChrome(); renderRelations(); scheduleDraw();
}
function restoreLocation() {
  const params = new URLSearchParams(location.hash.slice(1));
  const candidate = (params.get('path') || manifest.root_diagram).split('/');
  const open = new Set(params.has('open') ? params.get('open').split(',').filter(Boolean) : candidate.slice(1));
  const valid = validPath(candidate) && [...open].every((id) => {
    const owner = index.parents.get(id);
    return owner && (owner.diagram === manifest.root_diagram || open.has(owner.diagram));
  }) && candidate.slice(1).every((id) => open.has(id));
  const allowed = new Set(['path', 'open', 'relation', 'trace', 'hop', 'kind', 'protocol', 'scope', 'direction', 'camera']);
  let restoredTrace = null;
  if (params.has('trace')) {
    try {
      restoredTrace = relationChain(index, params.get('trace').split(','));
      restoredTrace.step = Number(params.get('hop') || 0);
      if (!Number.isInteger(restoredTrace.step) || restoredTrace.step < 0 || restoredTrace.step >= restoredTrace.relation_ids.length) restoredTrace = null;
    } catch { /* Invalid authored URL state is reported below, never used as facts. */ }
  }
  const cameraSegments = params.has('camera') ? params.get('camera').split(',') : null;
  const sharedCamera = cameraSegments?.every((value) => value.trim()) ? cameraSegments.map(Number) : null;
  const restoredCamera = sharedCamera?.length === 3 ? { scale: sharedCamera[0], x: sharedCamera[1], y: sharedCamera[2] } : null;
  const relation = params.get('relation');
  const validFilters = ['kind', 'protocol', 'scope'].every((key) => !params.get(key)
    || [...index.relations.values()].some((entry) => entry[key] === params.get(key)))
    && ['', 'incoming', 'outgoing', 'internal'].includes(params.get('direction') || '');
  if (!valid || location.hash.length > 32768 || [...params.keys()].some((key) => !allowed.has(key))
    || (relation && !index.relations.has(relation)) || (params.has('trace') && !restoredTrace)
    || (params.has('hop') && !restoredTrace) || (restoredTrace && relation && relation !== restoredTrace.relation_ids[restoredTrace.step])
    || !validFilters || (params.has('camera') && !validCamera(restoredCamera))) {
    trace = null; selected = null; kind = ''; extraFilters = { protocol: '', scope: '', direction: '' };
    navigate([manifest.root_diagram], false); status(text.badPath, true); return;
  }
  trace = restoredTrace; selected = relation || trace?.relation_ids[trace.step] || null;
  kind = params.get('kind') || '';
  extraFilters = Object.fromEntries(['protocol', 'scope', 'direction'].map((key) => [key, params.get(key) || '']));
  beginMorph();
  for (const id of [...opened]) if (!open.has(id)) removeScene(id);
  opened.clear();
  for (const id of open) { opened.add(id); ensureScene(id); }
  ensureScene(manifest.root_diagram);
  path = candidate;
  pendingFocus = null;
  if (restoredCamera) { initialSharedCamera = restoredCamera; moveCamera(restoredCamera); }
  else if (validCamera(history.state?.camera)) { initialSharedCamera = history.state.camera; moveCamera(history.state.camera); }
  else pendingFocus = { id: candidate.at(-1), animate: false };
  revision += 1;
  updateChrome(); renderRelations(); scheduleDraw(); status('', false);
}
function updateChrome() {
  const crumbs = byId('breadcrumbs');
  crumbs.replaceChildren();
  if (path.length > 1) path.forEach((id, i) => {
    if (i) crumbs.appendChild(document.createTextNode('/'));
    const crumb = button(i ? labelRef(index.parents.get(id)) : index.diagrams.get(id).title, () => {
      saveLocation();
      path = navigationPath(index, id); focusScene(id); locationUpdate();
      updateChrome(); renderRelations();
    });
    if (i === path.length - 1) crumb.setAttribute('aria-current', 'page');
    crumbs.appendChild(crumb);
  });
  for (const [key, label] of [['kind', 'all'], ['protocol', 'allProtocols'], ['scope', 'allScopes']]) {
    const select = byId(`relation-${key}`);
    select.replaceChildren(new Option(text[label], ''));
    [...new Set([...index.relations.values()].map((relation) => relation[key]).filter(Boolean))]
      .sort().forEach((value) => select.add(new Option(value, value)));
    select.value = key === 'kind' ? kind : extraFilters[key];
  }
  const direction = byId('relation-direction');
  direction.replaceChildren(new Option(text.allDirections, ''));
  for (const value of ['incoming', 'outgoing', 'internal']) direction.add(new Option(text[value], value));
  direction.value = extraFilters.direction;
}
function panel(open) {
  byId('relations-panel').hidden = !open;
  byId('relations-toggle').setAttribute('aria-expanded', String(open));
  document.documentElement.setAttribute('data-inspector', String(open));
  if (open) renderRelations();
}
function splitGroup(group) {
  return bundles.has(group.key) ? bundles.get(group.key) : canvasLayout.defaultRelationSplit(group, manifest.viewer);
}
function toggleGroup(group) {
  beginMorph(); bundles.set(group.key, !splitGroup(group));
  revision += 1; renderRelations(); scheduleDraw();
}
function highlightedIds() { return new Set(trace?.relation_ids || (selected ? [selected] : [])); }
function chooseRelation(id, keepTrace = false) {
  const relation = index.relations.get(id);
  if (!relation) { status(`Unknown relation: ${id}`, true); return; }
  beginMorph();
  if (!keepTrace) trace = null;
  selected = id;
  if (kind && kind !== relation.kind) kind = '';
  if (extraFilters.protocol && extraFilters.protocol !== relation.protocol) extraFilters.protocol = '';
  if (extraFilters.scope && extraFilters.scope !== relation.scope) extraFilters.scope = '';
  extraFilters.direction = '';
  const from = canvasRepresentative(index, relation.from, opened);
  const to = canvasRepresentative(index, relation.to, opened);
  const local = opened.has(to.diagram) ? to : from;
  post(scenes.get(local.diagram), 'FOCUS_RELATION', { node: local.node });
  const box = nodeRect(local);
  if (box && !intersects(screenRect(box))) {
    moveCamera({ ...camera, x: stage.clientWidth / 2 - (box.x + box.width / 2) * camera.scale,
      y: stage.clientHeight / 2 - (box.y + box.height / 2) * camera.scale }, true);
  }
  const group = groups().find((entry) => entry.sourceRelationIds.includes(id));
  selectedBucket = group ? bucketKey(group) : null;
  locationUpdate(false); updateChrome(); renderRelations(); scheduleDraw();
}
function setTrace(value) {
  const chain = typeof value === 'string' ? (manifest.chains || []).find((entry) => entry.id === value) : null;
  const ids = Array.isArray(value) ? value : chain?.relation_ids;
  trace = { ...relationChain(index, ids), step: 0, ...(chain ? { id: chain.id } : {}) };
  kind = ''; extraFilters = { protocol: '', scope: '', direction: '' };
  chooseRelation(trace.relation_ids[0], true);
  byId('chain-controls').open = true;
  panel(true);
  return structuredClone(trace);
}
function traceStep(step) {
  if (!trace || !Number.isInteger(step) || step < 0 || step >= trace.relation_ids.length) throw new Error('Invalid trace hop.');
  trace.step = step;
  const relation = index.relations.get(trace.relation_ids[step]);
  const paths = [relation.from, relation.to].map((ref) => navigationPath(index, ref.diagram));
  for (const next of paths.filter((entry) => entry.length > 1)) navigate(next);
  chooseRelation(relation.id, true);
}
function renderTrace() {
  byId('chain-controls').hidden = !trace && !(manifest.chains || []).length;
  const select = byId('chain-select');
  select.replaceChildren(new Option(text.chooseChain, ''));
  for (const chain of manifest.chains || []) select.add(new Option(chain.title, chain.id));
  select.value = trace?.id || '';
  const steps = byId('chain-steps'); steps.replaceChildren();
  if (!trace) { byId('chain-status').textContent = ''; return; }
  byId('chain-controls').open = true;
  trace.relation_ids.forEach((id, i) => {
    const relation = index.relations.get(id), step = document.createElement('li');
    const action = button(`${hierarchyLabel(relation.from)} → ${hierarchyLabel(relation.to)}`, () => traceStep(i));
    action.dataset.traceStep = String(i); action.dataset.traceRelation = id;
    action.setAttribute('aria-current', String(trace.step === i));
    const detail = document.createElement('small');
    detail.textContent = `${id} · ${relation.kind}${relation.protocol ? ` / ${relation.protocol}` : ''} · ${text[data.evidence[id]?.status || relation.evidence.mode]}`;
    step.append(action, detail); steps.appendChild(step);
  });
  const clear = button(text.clearChain, () => { trace = null; selected = null; locationUpdate(false); renderRelations(); scheduleDraw(); });
  const clearRow = document.createElement('li'); clearRow.className = 'trace-clear'; clearRow.appendChild(clear); steps.appendChild(clearRow);
  byId('chain-status').textContent = `${trace.step + 1} / ${trace.relation_ids.length}`;
}
function renderQuality() {
  const quality = visualCheck(), warnings = byId('quality-list');
  const signature = JSON.stringify(quality.diagnostics);
  if (signature === qualitySignature) return;
  qualitySignature = signature;
  warnings.replaceChildren();
  byId('canvas-quality').hidden = !quality.diagnostics.length;
  for (const diagnostic of quality.diagnostics) {
    const warning = document.createElement('p'); warning.textContent = `${diagnostic.message} ${diagnostic.supportedFixes.join('; ')}`;
    warning.dataset.qualityCode = diagnostic.code; warnings.appendChild(warning);
  }
}
function renderRelations() {
  renderTrace(); renderQuality();
  const list = byId('relation-list');
  const previous = new Map([...list.querySelectorAll('.relation-tree')].map((tree) => [tree.dataset.bucket, tree.open]));
  list.replaceChildren();
  const projected = groups(), buckets = new Map();
  for (const group of projected) {
    const key = bucketKey(group);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(group);
  }
  byId('relation-summary').textContent = `${projected.reduce((n, group) => n + group.count, 0)} ${text.links} · ${projected.length} ${text.visible}`;
  for (const [key, entries] of buckets) {
    const first = entries[0], { from, to } = bucketRefs(first);
    const tree = document.createElement('details');
    tree.className = 'relation-tree'; tree.dataset.bucket = key;
    tree.open = key === selectedBucket || previous.get(key) === true;
    const summary = document.createElement('summary');
    summary.appendChild(document.createTextNode(`${labelRef(from)} → ${labelRef(to)}`));
    const count = document.createElement('small');
    count.textContent = `${entries.reduce((n, group) => n + group.count, 0)} ${text.links} · ${first.kind}${first.protocol ? ` / ${first.protocol}` : ''}${first.scope ? ` / ${first.scope}` : ''}`;
    summary.appendChild(count); tree.appendChild(summary);
    for (const group of entries) {
      const branch = document.createElement('section');
      branch.className = 'relation-branch';
      const heading = document.createElement('h3');
      heading.textContent = `${labelRef(group.from)} → ${labelRef(group.to)} · ${group.count}`;
      branch.appendChild(heading);
      if (group.count > 1) {
        const toggle = button(splitGroup(group) ? text.collapse : text.expand, () => toggleGroup(group));
        toggle.className = 'bundle-action'; toggle.dataset.bundle = group.key; branch.appendChild(toggle);
      }
      for (const id of group.sourceRelationIds) {
        const relation = index.relations.get(id);
        const row = document.createElement('article'); row.className = 'relation-row';
        const item = button('', () => chooseRelation(id)); item.className = 'relation-select';
        item.dataset.relationId = id; item.setAttribute('aria-pressed', String(highlightedIds().has(id)));
        const label = document.createElement('strong'); label.textContent = relation.label || relation.kind;
        const endpoints = document.createElement('small');
        endpoints.textContent = `${hierarchyLabel(relation.from)} → ${hierarchyLabel(relation.to)}`;
        item.append(label, endpoints); row.appendChild(item);
        const detail = document.createElement('details'); detail.className = 'relation-provenance';
        const detailTitle = document.createElement('summary'); detailTitle.textContent = text.provenance;
        const evidence = document.createElement('p');
        evidence.textContent = `${id} · ${text.source}: ${relation.evidence.mode}${relation.evidence.references ? ` · ${relation.evidence.references.join(', ')}` : ''}`;
        detail.append(detailTitle, evidence);
        const verified = data.evidence[id];
        const state = document.createElement('p');
        state.dataset.evidenceStatus = verified?.status || relation.evidence.mode;
        state.textContent = `${text[verified?.status || relation.evidence.mode]} · ${text.sourceBuild}`;
        detail.appendChild(state);
        for (const source of verified?.sources || []) {
          const line = document.createElement('p');
          const label = `${source.path}:${source.line}${source.endLine ? `-${source.endLine}` : ''}`;
          if (source.href) {
            const link = document.createElement('a');
            const url = new URL(source.href);
            if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Unsafe evidence link.');
            link.href = source.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = label;
            line.appendChild(link);
          } else line.textContent = label;
          line.appendChild(document.createTextNode(` · ${text[source.status]}${source.commit ? ` · ${source.commit.slice(0, 12)}` : ''}`));
          detail.appendChild(line);
        }
        for (const projection of data.projections.filter((entry) => entry.derived_from.includes(id))) {
          detail.appendChild(button(`${index.diagrams.get(projection.diagram).title} / ${projection.relation_id} · ${text[projection.status]}`, () => {
            navigate(navigationPath(index, projection.diagram));
            post(scenes.get(projection.diagram), 'FOCUS_RELATION', { edge: projection.relation_id });
          }));
        }
        for (const mapping of manifest.semantic_mappings || []) if (mapping.relation_id === id) {
          const explanation = document.createElement('p'); explanation.textContent = `${mapping.semantics} · ${mapping.explanation}`;
          detail.appendChild(explanation);
          detail.appendChild(button(`${index.diagrams.get(mapping.diagram).title} / ${mapping.edge_id}`, () => {
            navigate(navigationPath(index, mapping.diagram));
            post(scenes.get(mapping.diagram), 'FOCUS_RELATION', { edge: mapping.edge_id });
          }));
        }
        row.appendChild(detail); branch.appendChild(row);
      }
      tree.appendChild(branch);
    }
    list.appendChild(tree);
  }
  for (const projection of data.projections.filter((entry) => scenes.has(entry.diagram) && entry.status !== 'resolved')) {
    const row = document.createElement('p'); row.className = 'mapping-status'; row.dataset.status = projection.status;
    row.textContent = `${index.diagrams.get(projection.diagram).title} · ${projection.relation_id}: ${text[projection.status]}`;
    list.appendChild(row);
  }
  if (!list.childNodes.length) list.textContent = text.empty;
}
function nativeEdge(group) {
  if (group.from.diagram !== group.to.diagram) return null;
  const id = group.from.diagram;
  if (entrance(id, group.from.node) && opened.has(entrance(id, group.from.node).to_diagram)) return null;
  if (entrance(id, group.to.node) && opened.has(entrance(id, group.to.node).to_diagram)) return null;
  return [...index.edges.get(id).values()].find((edge) => edge.from === group.from.node && edge.to === group.to.node
    && (adapters[index.diagrams.get(id).type].projection
      || group.sourceRelationIds.every((fact) => index.semanticMappings.get(`${id}:${fact}`)?.edge_id === edge.id))) || null;
}
function layoutScenes() {
  const ordered = [...scenes.values()].sort((a, b) => navigationPath(index, a.id).length - navigationPath(index, b.id).length);
  const highlighted = highlightedIds();
  const tracedGroups = highlighted.size ? groups().filter((group) => group.sourceRelationIds.some((id) => highlighted.has(id))) : [];
  for (const scene of ordered) {
    if (!scene.bounds) {
      scene.frame.style.transform = `translate(${(20 - camera.x) / camera.scale}px,${(80 - camera.y) / camera.scale}px) scale(${1 / camera.scale})`;
      continue;
    }
    if (scene.id === manifest.root_diagram) scene.layout = { x: 0, y: 0, scale: 1 };
    else {
      const box = nodeRect(index.parents.get(scene.id));
      if (!box) continue;
      const scale = Math.min(box.width / scene.bounds.width, box.height / scene.bounds.height);
      scene.layout = { x: box.x + (box.width - scene.bounds.width * scale) / 2,
        y: box.y + (box.height - scene.bounds.height * scale) / 2, scale };
    }
    scene.frame.style.width = `${scene.bounds.width}px`;
    scene.frame.style.height = `${scene.bounds.height}px`;
    scene.frame.style.removeProperty('opacity');
    scene.frame.style.transform = `translate(${scene.layout.x}px,${scene.layout.y}px) scale(${scene.layout.scale})`;
    scene.frame.style.zIndex = String(navigationPath(index, scene.id).length);
    const children = [...opened].filter((id) => index.parents.get(id).diagram === scene.id);
    const hiddenNodes = children.map((id) => index.parents.get(id).node);
    const hiddenEdges = [...index.edges.get(scene.id).values()]
      .filter((edge) => hiddenNodes.includes(edge.from) || hiddenNodes.includes(edge.to)).map((edge) => edge.id);
    const visibility = JSON.stringify([hiddenNodes, hiddenEdges]);
    if (visibility !== scene.visibility && scene.ready) {
      scene.visibility = visibility;
      post(scene, 'CANVAS_VISIBILITY', { nodes: hiddenNodes, edges: hiddenEdges });
    }
    const tracedNodes = new Set(), tracedEdges = new Set();
    for (const id of highlighted) {
      const fact = index.relations.get(id);
      for (const endpoint of [fact.from, fact.to]) {
        const ref = canvasRepresentative(index, endpoint, opened);
        if (ref.diagram === scene.id) tracedNodes.add(ref.node);
      }
    }
    for (const group of tracedGroups) {
      const edge = nativeEdge(group);
      if (edge && group.from.diagram === scene.id) tracedEdges.add(edge.id);
    }
    const traced = JSON.stringify([[...tracedNodes], [...tracedEdges]]);
    if (scene.ready && traced !== scene.traced) {
      scene.traced = traced; post(scene, 'CANVAS_TRACE', { nodes: [...tracedNodes], edges: [...tracedEdges] });
    }
  }
}
function suspendOffscreenScenes() {
  for (const scene of scenes.values()) if (scene.ready && scene.layout && scene.bounds) {
    const hidden = new Set([...opened].filter((id) => index.parents.get(id).diagram === scene.id)
      .map((id) => index.parents.get(id).node));
    const visibleNode = [...index.nodes.get(scene.id).keys()].some((node) =>
      !hidden.has(node) && intersects(screenRect(nodeRect({ diagram: scene.id, node }))));
    const visibleEdge = [...index.edges.get(scene.id).values()].some((edge) =>
      !hidden.has(edge.from) && !hidden.has(edge.to) && scene.edges[edge.id]?.length
      && routeOnscreen(scene.edges[edge.id].map((point) => screenPoint(worldPoint(scene, point)))));
    const active = visibleNode || visibleEdge;
    // Let the browser cull offscreen paint; hiding live iframe documents can stall teardown.
    if (scene.active !== active) { scene.active = active; post(scene, 'ACTIVATE', { active }); }
  }
}
function frontierNodes() {
  return [...scenes.values()].flatMap((scene) => [...index.nodes.get(scene.id).keys()].flatMap((node) => {
    const child = entrance(scene.id, node);
    if (child && opened.has(child.to_diagram)) return [];
    const ref = { diagram: scene.id, node }, box = nodeRect(ref);
    return box ? [{ key: nodeKey(ref), ...screenRect(box) }] : [];
  }));
}
function routeOnscreen(points, padding = 32) {
  const xs = points.map((point) => point.x), ys = points.map((point) => point.y);
  return intersects({ x: Math.min(...xs) - padding, y: Math.min(...ys) - padding,
    width: Math.max(...xs) - Math.min(...xs) + padding * 2, height: Math.max(...ys) - Math.min(...ys) + padding * 2 });
}
function routedBridge(points, offset) {
  const [a, b] = points.map(screenPoint);
  const round = (value) => Math.round(value * 1000) / 1000;
  const obstacles = canvasNodes.filter((node) => {
    const margin = 180 + Math.abs(offset);
    return node.x <= Math.max(a.x, b.x) + margin && node.x + node.width >= Math.min(a.x, b.x) - margin
      && node.y <= Math.max(a.y, b.y) + margin && node.y + node.height >= Math.min(a.y, b.y) - margin;
  }).map((node) => ({ x: round(node.x - a.x), y: round(node.y - a.y), width: round(node.width), height: round(node.height) }));
  const request = { start: [0, 0], end: [round(b.x - a.x), round(b.y - a.y)], fromSide: points[0].side,
    toSide: points[1].side, obstacles, offset };
  const key = JSON.stringify(request);
  let route = routeCache.get(key);
  if (!route) {
    route = canvasLayout.routeCanvasBridge(request);
    if (routeCache.size >= 256) routeCache.delete(routeCache.keys().next().value);
    routeCache.set(key, route);
  }
  const mapped = route.points.map(([x, y]) => [x + a.x, y + a.y]);
  return { ...route, points: mapped, path: canvasGeometry.roundedPath(mapped, 7) };
}
function routePoints(group) {
  const fromBox = nodeRect(group.from), toBox = nodeRect(group.to);
  if (!fromBox || !toBox) return null;
  const a = { x: fromBox.x + fromBox.width / 2, y: fromBox.y + fromBox.height / 2 };
  const b = { x: toBox.x + toBox.width / 2, y: toBox.y + toBox.height / 2 };
  const horizontal = Math.abs(a.x - b.x) >= Math.abs(a.y - b.y);
  const fromSide = interfacePort(index, group.from.diagram, group.from.node, 'out', group.kind)?.side
    || (horizontal ? a.x <= b.x ? 'right' : 'left' : a.y <= b.y ? 'bottom' : 'top');
  const toSide = interfacePort(index, group.to.diagram, group.to.node, 'in', group.kind)?.side
    || (horizontal ? a.x <= b.x ? 'left' : 'right' : a.y <= b.y ? 'top' : 'bottom');
  const point = (box, side) => ({ x: box.x + (side === 'left' ? 0 : side === 'right' ? box.width : box.width / 2),
    y: box.y + (side === 'top' ? 0 : side === 'bottom' ? box.height : box.height / 2), side });
  return [point(fromBox, fromSide), point(toBox, toSide)];
}
function animatedPoints(points, ids) {
  const seeds = ids.map((id) => morphSeed?.get(id)).filter(Boolean);
  let result = points;
  if (seeds.length && morphStart !== null) {
    const ease = 1 - (1 - Math.min(1, (performance.now() - morphStart) / 220)) ** 3;
    result = points.map((point, i) => {
      const average = (axis) => seeds.reduce((n, pair) => n + pair[i][axis], 0) / seeds.length;
      return { ...point, x: average('x') + (point.x - average('x')) * ease,
        y: average('y') + (point.y - average('y')) * ease };
    });
  }
  for (const id of ids) visiblePoints.set(id, result);
  return result;
}
function curve(points, offset = 0) {
  const [a, b] = points.map(screenPoint);
  const distance = Math.max(32, Math.min(160, Math.hypot(b.x - a.x, b.y - a.y) * .4));
  const control = (p, side) => ({ x: p.x + (side === 'right' ? distance : side === 'left' ? -distance : 0),
    y: p.y + (side === 'bottom' ? distance : side === 'top' ? -distance : 0) + offset });
  const c = control(a, points[0].side), d = control(b, points[1].side);
  return `M ${a.x} ${a.y} C ${c.x} ${c.y}, ${d.x} ${d.y}, ${b.x} ${b.y}`;
}
function hitPath(d, label, action) {
  const hit = el('path', { d, class: 'bridge-hit', tabindex: '0', role: 'button', 'aria-label': label });
  hit.appendChild(el('title', {}, label));
  hit.addEventListener('click', () => { if (!suppressClick) action(); });
  hit.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); action(); }
  });
  svg.appendChild(hit);
}
function inspectGroup(group) {
  selectedBucket = bucketKey(group);
  if (group.count === 1) chooseRelation(group.sourceRelationIds[0]);
  panel(true); renderRelations();
}
function caption(point, label, attrs = {}, route = null, ids = []) {
  const screen = screenPoint(point);
  const element = el('text', { x: 0, y: 0, 'text-anchor': 'middle', class: 'bridge-caption', ...attrs }, label);
  svg.appendChild(element);
  const measured = element.getBBox();
  const placed = canvasLayout.placeCanvasCaption(route || [[screen.x, screen.y]], measured.width, measured.height,
    canvasNodes, canvasLabels, { x: 0, y: 0, width: stage.clientWidth, height: stage.clientHeight });
  if (!placed || !intersects(placed)) { element.remove(); return; }
  element.setAttribute('x', placed.x - measured.x); element.setAttribute('y', placed.y - measured.y);
  canvasLabels.push({ ...placed, ids });
}
function drawGroup(group) {
  const points = routePoints(group);
  if (!points) return;
  const edge = nativeEdge(group);
  if (edge) {
    const scene = scenes.get(group.from.diagram), route = scene.edges[edge.id];
    const mapped = route?.map((point) => worldPoint(scene, point));
    const pair = mapped?.length ? [mapped[0], mapped.at(-1)] : points;
    group.sourceRelationIds.forEach((id) => visiblePoints.set(id, pair));
    const screenRoute = mapped?.map(screenPoint);
    if (!routeOnscreen(screenRoute || points.map(screenPoint))) { culledGroups += 1; return; }
    const d = screenRoute?.map((point, i) => `${i ? 'L' : 'M'} ${point.x} ${point.y}`).join(' ') || curve(points);
    hitPath(d, `${labelRef(group.from)} → ${labelRef(group.to)} · ${group.count}`, () => inspectGroup(group));
    return;
  }
  const ids = group.sourceRelationIds;
  const highlighted = highlightedIds();
  const preferred = ids.filter((id) => highlighted.has(id));
  const separated = splitGroup(group) ? [...preferred, ...ids.filter((id) => !highlighted.has(id)).slice(0, Math.max(0, paintLimit - preferred.length))]
    : preferred;
  const remainder = ids.filter((id) => !separated.includes(id));
  const rows = [...(remainder.length ? [remainder] : []), ...separated.map((id) => [id])];
  if (!routeOnscreen(points.map(screenPoint), 320)) { culledGroups += 1; return; }
  rows.forEach((sourceIds, row) => {
    const animated = animatedPoints(points, sourceIds);
    let route = routedBridge(animated, (row - (rows.length - 1) / 2) * 16);
    if (nodeKey(group.from) === nodeKey(group.to)) {
      const box = screenRect(nodeRect(group.from)), a = screenPoint(animated[0]), b = screenPoint(animated[1]);
      const loop = [[a.x, a.y], [box.x + box.width + 24, a.y], [box.x + box.width + 24, box.y - 24],
        [box.x - 24, box.y - 24], [box.x - 24, b.y], [b.x, b.y]];
      route = { points: loop, path: canvasGeometry.roundedPath(loop, 7), status: 'routed' };
    }
    if (!routeOnscreen(route.points.map(([x, y]) => ({ x, y })))) return;
    canvasRoutes.push({ ...route, ids: sourceIds, endpoints: [nodeKey(group.from), nodeKey(group.to)] });
    const stale = sourceIds.some((id) => data.evidence[id]?.status === 'stale');
    const d = route.path;
    svg.appendChild(el('path', { d, class: `bridge-line${sourceIds.some((id) => highlighted.has(id)) ? ' is-selected' : ''}${stale ? ' is-stale' : ''}`,
      'marker-end': 'url(#set-arrow)', 'data-source-relations': sourceIds.join(' '),
      'data-from': nodeKey(group.from), 'data-to': nodeKey(group.to) }));
    hitPath(d, `${labelRef(group.from)} → ${labelRef(group.to)} · ${sourceIds.length}`, () => {
      if (sourceIds.length === 1) chooseRelation(sourceIds[0]);
      else selectedBucket = bucketKey(group);
      panel(true);
    });
    const midpoint = { x: (animated[0].x + animated[1].x) / 2, y: (animated[0].y + animated[1].y) / 2 };
    if (sourceIds.length > 1 || sourceIds.includes(selected)) {
      caption({ ...midpoint, y: midpoint.y + row * 16 / camera.scale },
        sourceIds.length > 1 ? `${group.protocol || group.kind} ×${sourceIds.length}` : index.relations.get(sourceIds[0]).label || group.kind,
        {}, route.points, sourceIds);
    }
  });
}
function drawProjections(projected) {
  const ids = new Set(projected.flatMap((group) => group.sourceRelationIds));
  for (const projection of data.projections) {
    if (!scenes.get(projection.diagram)?.layout) continue;
    const from = { diagram: projection.diagram, node: projection.from }, to = { diagram: projection.diagram, node: projection.to };
    const replaced = [from, to].some((ref) => {
      const child = entrance(ref.diagram, ref.node); return child && opened.has(child.to_diagram);
    });
    const points = routePoints({ from, to, kind: '' });
    if (!points) continue;
    if (!routeOnscreen(points.map(screenPoint), 320)) continue;
    if (!replaced) {
      const visible = projection.derived_from.filter((id) => ids.has(id)).length;
      const total = projection.derived_from.length;
      if (total) caption({ x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 + 18 / camera.scale },
        `×${visible}${visible !== total ? ` / ${total}` : ''}`, { 'data-projection-id': projection.relation_id });
    } else if (projection.status !== 'resolved') {
      const route = routedBridge(points, 0), d = route.path;
      if (!routeOnscreen(route.points.map(([x, y]) => ({ x, y })))) continue;
      canvasRoutes.push({ ...route, ids: projection.derived_from, endpoints: [nodeKey(from), nodeKey(to)] });
      svg.appendChild(el('path', { d, class: 'bridge-line is-unresolved', 'marker-end': 'url(#set-arrow)',
        'data-unresolved-projection': `${projection.diagram}:${projection.relation_id}` }));
      caption({ x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 },
        text[projection.status], {}, route.points, projection.derived_from);
    }
  }
}
function drawTargets() {
  const used = new Set();
  for (const scene of scenes.values()) {
    if (!scene.layout) continue;
    for (const [node] of index.nodes.get(scene.id)) {
      const child = entrance(scene.id, node);
      if (child && opened.has(child.to_diagram)) continue;
      const box = nodeRect({ diagram: scene.id, node });
      if (!box) continue;
      const key = `${scene.id}:${node}`, screen = screenRect(box);
      if (!intersects(screen)) continue;
      used.add(key);
      let target = nodeTargets.get(key);
      if (!target) {
        target = button('', () => {
          if (suppressClick) return;
          if (child) expand(scene.id, node);
          else {
            path = navigationPath(index, scene.id);
            post(scene, 'FOCUS_NODE', { node }); updateChrome(); renderRelations();
          }
        });
        target.className = 'canvas-node'; target.dataset.nodeRef = key;
        target.dataset.openable = String(!!child);
        target.setAttribute('aria-label', `${labelRef({ diagram: scene.id, node })}${child ? ` · ${text.expand}` : ''}`);
        byId('node-targets').appendChild(target); nodeTargets.set(key, target);
      }
      target.hidden = !intersects(screen);
      for (const [name, value] of Object.entries({ left: screen.x, top: screen.y, width: screen.width, height: screen.height })) target.style[name] = `${value}px`;
      target.style.zIndex = String(navigationPath(index, scene.id).length);
    }
  }
  for (const [key, target] of nodeTargets) if (!used.has(key)) { target.remove(); nodeTargets.delete(key); }
  byId('anchors').replaceChildren();
  for (const id of opened) {
    const owner = nodeRect(index.parents.get(id));
    if (!owner) continue;
    const box = screenRect(owner);
    if (!intersects(box)) continue;
    const scene = scenes.get(id), caption = document.createElement('div');
    caption.className = 'scene-caption'; caption.dataset.sceneCaption = id;
    caption.style.left = `${box.x}px`; caption.style.top = `${box.y - 30}px`;
    const label = document.createElement('strong');
    label.textContent = `${labelRef(index.parents.get(id))}${scene?.bounds ? '' : ` · ${text.loading}`}`;
    caption.dataset.loading = String(!scene?.bounds);
    caption.appendChild(label);
    const close = button('×', () => collapse(id));
    close.setAttribute('aria-label', `${text.close} ${labelRef(index.parents.get(id))}`);
    close.dataset.collapse = id; caption.appendChild(close); byId('anchors').appendChild(caption);
  }
}
function scheduleDraw() { if (!drawFrame) drawFrame = requestAnimationFrame(draw); }
function draw() {
  drawFrame = 0;
  layoutScenes();
  const root = scenes.get(manifest.root_diagram);
  if (!root?.bounds) return;
  if (initialFit) {
    const next = fitted({ x: 0, y: 0, ...root.bounds });
    baseScale = next.scale;
    camera = initialSharedCamera || next; initialSharedCamera = null; initialFit = false;
  }
  const ready = [...scenes.values()].every((scene) => scene.ready && scene.layout && scene.bounds);
  if (ready && pendingFocus) {
    const focus = pendingFocus; pendingFocus = null; focusScene(focus.id, focus.animate);
  }
  if (cameraMotion) {
    const t = Math.min(1, (performance.now() - cameraMotion.start) / 260), ease = 1 - (1 - t) ** 3;
    camera = Object.fromEntries(['scale', 'x', 'y'].map((key) => [key, cameraMotion.from[key] + (cameraMotion.to[key] - cameraMotion.from[key]) * ease]));
    if (t === 1 || reducedMotion.matches) { camera = cameraMotion.to; cameraMotion = null; }
  }
  byId('world').style.transform = `translate(${camera.x}px,${camera.y}px) scale(${camera.scale})`;
  suspendOffscreenScenes();
  byId('zoom-level').textContent = `${Math.round(camera.scale * 100)}%`;
  drawTargets();
  if (!ready) { if (cameraMotion) scheduleDraw(); return; }
  if (morphSeed && reducedMotion.matches) morphSeed = null;
  if (morphSeed && morphStart === null) morphStart = performance.now();
  visiblePoints = new Map();
  canvasNodes = frontierNodes(); canvasRoutes = []; canvasLabels = []; culledGroups = 0; deferredGroups = 0;
  svg.replaceChildren();
  svg.setAttribute('viewBox', `0 0 ${stage.clientWidth} ${stage.clientHeight}`);
  const defs = el('defs'), marker = el('marker', { id: 'set-arrow', viewBox: '0 0 10 10',
    refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto-start-reverse' });
  marker.appendChild(el('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: 'var(--set-accent)' }));
  defs.appendChild(marker); svg.appendChild(defs);
  const projected = groups();
  paintLimit = Math.max(1, Math.floor(256 / Math.max(1, projected.length)) - 1);
  const highlighted = highlightedIds();
  let painted = 0;
  for (const group of [...projected].sort((a, b) =>
    Number(b.sourceRelationIds.some((id) => highlighted.has(id))) - Number(a.sourceRelationIds.some((id) => highlighted.has(id))))) {
    if (painted >= 256) { deferredGroups += 1; continue; }
    const before = svg.childElementCount;
    drawGroup(group);
    if (svg.childElementCount !== before) painted += 1;
  }
  drawProjections(projected);
  const morphing = !!morphSeed && performance.now() - morphStart < 220;
  document.documentElement.toggleAttribute('data-edge-morph', morphing);
  if (!morphing) { morphSeed = null; morphStart = null; }
  document.documentElement.setAttribute('data-canvas-ready', 'true');
  if (!cameraMotion && !morphing && !byId('relations-panel').hidden) renderQuality();
  if (cameraMotion || morphing) scheduleDraw();
}
function visualCheck() {
  const computed = getComputedStyle(document.documentElement);
  const result = canvasLayout.checkCanvasQuality({ routes: canvasRoutes, labels: canvasLabels, nodes: canvasNodes,
    foreground: computed.getPropertyValue('--set-accent').trim(), background: computed.getPropertyValue('--set-bg').trim(), opacity: .75 });
  if (deferredGroups) {
    result.ok = false;
    result.diagnostics.push({ code: 'diagram-set/canvas-visible-group-budget', severity: 'warning',
      message: `${deferredGroups} additional groups remain available in Relations.`, subject: {},
      evidence: { deferredGroups, maximumPaintedGroups: 256 },
      supportedFixes: ['filter or bundle relationships; use the complete relationship inspector for the remaining facts'] });
  }
  const settled = !cameraMotion && !morphSeed && [...scenes.values()].every((scene) => scene.ready && scene.bounds && scene.layout);
  return { ...result, ok: result.ok && settled, status: settled ? 'checked' : 'pending',
    scope: 'visible-host-overlay', nativeArtifacts: 'checked-by-compiler',
    performance: { routeCache: routeCache.size, culledGroups,
      activeScenes: [...scenes.values()].filter((scene) => scene.active).length } };
}
function validState(state, id) {
  const view = state?.viewport;
  return view && [view.scale, view.x, view.y].every(Number.isFinite) && view.scale >= 1 && view.scale <= 3
    && ['overview', 'manual', 'semantic'].includes(view.mode)
    && state.scroll && [state.scroll.x, state.scroll.y].every(Number.isFinite)
    && (!state.selection || [].concat(state.selection).every((node) => index.nodes.get(id).has(node)));
}
addEventListener('message', (event) => {
  const message = event.data;
  if (!message || message.channel !== 'archify-diagram-set' || typeof message.diagram !== 'string') return;
  const scene = scenes.get(message.diagram);
  if (!scene?.token || event.source !== scene.frame.contentWindow || message.token !== scene.token) return;
  if (!['READY', 'VIEW_STATE', 'GEOMETRY_CHANGED', 'OPEN_CHILD', 'CLOSE_CHILD', 'RELATION_SELECTED', 'ERROR', 'EXPORTED', 'SNAPSHOT'].includes(message.type)) return;
  const payload = message.payload;
  if (!payload || typeof payload !== 'object' || JSON.stringify(payload).length > (message.type === 'SNAPSHOT' ? 16000000 : 4000000)) return;
  if (payload.state && validState(payload.state, scene.id)) scene.state = payload.state;
  switch (message.type) {
    case 'READY':
      if (scene.timer) clearTimeout(scene.timer);
      scene.ready = true;
      post(scene, 'THEME', { theme });
      if (saved.get(scene.id)) post(scene, 'RESTORE_STATE', { state: saved.get(scene.id) });
      post(scene, 'ACTIVATE', { active: true });
      for (const command of scene.commands.splice(0)) post(scene, command.type, command.payload);
      scheduleDraw(); break;
    case 'VIEW_STATE':
      if (validState(payload, scene.id)) scene.state = payload;
      break;
    case 'GEOMETRY_CHANGED':
      if (!payload.nodes || Object.keys(payload.nodes).length > 1000
        || !Object.entries(payload.nodes).every(([node, rect]) => index.nodes.get(scene.id).has(node)
          && rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) && rect.width >= 0 && rect.height >= 0)) return;
      if (!payload.bounds || ![payload.bounds.width, payload.bounds.height].every((n) => Number.isFinite(n) && n > 0 && n <= 100000)) return;
      if (payload.edges && (Object.keys(payload.edges).length > 10000
        || !Object.entries(payload.edges).every(([id, points]) => index.edges.get(scene.id).has(id)
          && Array.isArray(points) && points.length <= 48 && points.every((point) => point && [point.x, point.y].every(Number.isFinite))))) return;
      scene.geometry = payload.nodes; scene.edges = payload.edges || {}; scene.bounds = payload.bounds;
      scheduleDraw(); break;
    case 'OPEN_CHILD': if (typeof payload.node === 'string') expand(scene.id, payload.node); break;
    case 'CLOSE_CHILD': collapse(scene.id); break;
    case 'RELATION_SELECTED':
      if (typeof payload.id !== 'string') return;
      {
        const ids = [...(data.projections.find((entry) => entry.diagram === scene.id && entry.relation_id === payload.id)?.derived_from || []),
          ...(manifest.semantic_mappings || []).filter((entry) => entry.diagram === scene.id && entry.edge_id === payload.id).map((entry) => entry.relation_id)];
        if (ids.length) { selected = ids.includes(selected) ? selected : ids[0]; chooseRelation(selected); panel(true); }
      }
      break;
    case 'ERROR':
      status(String(payload.message || 'Viewer error').slice(0, 400), true);
      if (pending.has(payload.request)) pending.get(payload.request).reject(new Error(payload.message));
      break;
    case 'EXPORTED': status(`${scene.frame.title} — ${payload.format}`); break;
    case 'SNAPSHOT':
      if (typeof payload.svgString !== 'string' || !payload.svgString.startsWith('<?xml')
        || ![payload.width, payload.height].every((n) => Number.isFinite(n) && n > 0)
        || !payload.rect || ![payload.rect.x, payload.rect.y, payload.rect.width, payload.rect.height].every(Number.isFinite)) return;
      if (pending.has(payload.request) && pending.get(payload.request).scene === scene) pending.get(payload.request).resolve(payload);
      break;
  }
});
function zoom(factor, anchor = { x: stage.clientWidth / 2, y: stage.clientHeight / 2 }) {
  if (!Number.isFinite(factor) || factor <= 0 || ![anchor.x, anchor.y].every(Number.isFinite)) throw new Error('Invalid canvas zoom.');
  const scale = Math.max(.02, Math.min(maxCameraScale, camera.scale * factor)), gain = scale / camera.scale;
  moveCamera({ scale, x: anchor.x - (anchor.x - camera.x) * gain, y: anchor.y - (anchor.y - camera.y) * gain });
}
function pan(x, y) { moveCamera({ ...camera, x: camera.x + x, y: camera.y + y }); }
function localPointer(event) {
  const bounds = stage.getBoundingClientRect();
  return { x: event.clientX - bounds.x, y: event.clientY - bounds.y };
}
function pinch() {
  const [a, b] = [...pointers.values()];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, distance: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
}
stage.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || event.target.closest('.camera-controls,.canvas-heading,.inspector-toggle,.scene-caption')) return;
  cameraMotion = null;
  pointers.set(event.pointerId, localPointer(event));
  if (pointers.size > 1) {
    gesture = { pinch: pinch(), camera: { ...camera }, moved: true }; suppressClick = true;
  } else gesture = { start: localPointer(event), camera: { ...camera }, moved: false };
});
stage.addEventListener('pointermove', (event) => {
  if (!pointers.has(event.pointerId) || !gesture) return;
  pointers.set(event.pointerId, localPointer(event));
  if (pointers.size > 1 && gesture.pinch) {
    const now = pinch(), gain = now.distance / gesture.pinch.distance;
    const scale = Math.max(.02, Math.min(maxCameraScale, gesture.camera.scale * gain)), actual = scale / gesture.camera.scale;
    moveCamera({ scale, x: now.x - (gesture.pinch.x - gesture.camera.x) * actual,
      y: now.y - (gesture.pinch.y - gesture.camera.y) * actual });
  } else {
    const point = localPointer(event), x = point.x - gesture.start.x, y = point.y - gesture.start.y;
    if (!gesture.moved && Math.hypot(x, y) < 4) return;
    gesture.moved = true; suppressClick = true;
    stage.setPointerCapture(event.pointerId);
    moveCamera({ ...gesture.camera, x: gesture.camera.x + x, y: gesture.camera.y + y });
  }
  stage.classList.add('is-panning');
});
function endPointer(event) {
  pointers.delete(event.pointerId);
  if (stage.hasPointerCapture(event.pointerId)) stage.releasePointerCapture(event.pointerId);
  if (pointers.size === 1) gesture = { start: [...pointers.values()][0], camera: { ...camera }, moved: true };
  else if (!pointers.size) {
    gesture = null; stage.classList.remove('is-panning');
    setTimeout(() => { suppressClick = false; }, 0);
  }
}
stage.addEventListener('pointerup', endPointer);
stage.addEventListener('pointercancel', endPointer);
stage.addEventListener('wheel', (event) => {
  if (event.target.closest('.camera-controls,.canvas-heading,.inspector-toggle,.scene-caption')) return;
  event.preventDefault(); zoom(Math.exp(-Math.max(-120, Math.min(120, event.deltaY)) * .0025), localPointer(event));
}, { passive: false });
byId('zoom-in').addEventListener('click', () => zoom(1.25));
byId('zoom-out').addEventListener('click', () => zoom(.8));
byId('fit').addEventListener('click', fit);
byId('relations-toggle').addEventListener('click', () => panel(byId('relations-panel').hidden));
byId('relations-close').addEventListener('click', () => { panel(false); byId('relations-toggle').focus(); });
byId('chain-select').addEventListener('change', (event) => {
  if (event.target.value) setTrace(event.target.value);
  else { trace = null; selected = null; locationUpdate(false); renderRelations(); scheduleDraw(); }
});
for (const key of ['kind', 'protocol', 'scope', 'direction']) byId(`relation-${key}`).addEventListener('change', (event) => {
  beginMorph();
  if (key === 'kind') kind = event.target.value;
  else extraFilters[key] = event.target.value;
  if (selected && !groups().some((group) => group.sourceRelationIds.includes(selected))) selected = null;
  trace = null; locationUpdate(false); revision += 1; renderRelations(); scheduleDraw();
});
byId('global-search').addEventListener('input', (event) => {
  const query = event.target.value.trim().toLowerCase(), results = byId('search-results');
  results.replaceChildren();
  if (!query) return;
  let count = 0;
  for (const [diagram, nodes] of index.nodes) for (const node of nodes.values()) {
    if (count >= 30 || !`${diagram}:${node.id} ${node.label}`.toLowerCase().includes(query)) continue;
    count += 1;
    results.appendChild(button(hierarchyLabel({ diagram, node: node.id }), () => {
      navigate(navigationPath(index, diagram)); post(scenes.get(diagram), 'FOCUS_NODE', { node: node.id }); panel(false);
    }));
  }
  for (const relation of index.relations.values()) {
    if (count >= 30 || !`${relation.id} ${relation.label || ''}`.toLowerCase().includes(query)) continue;
    count += 1;
    results.appendChild(button(relation.label || relation.id, () => {
      navigate(navigationPath(index, relation.to.diagram)); chooseRelation(relation.id);
    }));
  }
});
addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
    event.preventDefault(); panel(true); byId('global-search').focus(); return;
  }
  if (event.key === 'Escape' && event.target === byId('global-search')) {
    event.preventDefault(); panel(false); stage.focus(); return;
  }
  if (event.target.closest('input,textarea,select,[contenteditable="true"]')) return;
  if (event.altKey && event.key === 'Enter') {
    event.preventDefault(); fullscreen().catch((error) => status(error.message, true)); return;
  }
  if (event.key === 'Escape') {
    if (!byId('relations-panel').hidden) { panel(false); byId('relations-toggle').focus(); }
    else collapse();
  } else if (event.key.toLowerCase() === 'f') fit();
  else if (event.key === '+' || event.key === '=') zoom(1.25);
  else if (event.key === '-') zoom(.8);
  else if (event.target === stage && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
    event.preventDefault();
    pan(event.key === 'ArrowLeft' ? 80 : event.key === 'ArrowRight' ? -80 : 0,
      event.key === 'ArrowUp' ? 80 : event.key === 'ArrowDown' ? -80 : 0);
  }
});
async function fullscreen() {
  if (document.fullscreenElement) return document.exitFullscreen();
  if (!document.fullscreenEnabled) throw new Error('Canvas fullscreen is unavailable in this browser.');
  return document.documentElement.requestFullscreen();
}
function snapshot(scene) {
  return new Promise((resolve, reject) => {
    if (!scene?.ready) return reject(new Error('Diagram is not ready.'));
    const request = ++requestNumber;
    const timer = setTimeout(() => { pending.delete(request); reject(new Error('Snapshot timed out.')); }, 10000);
    pending.set(request, { scene,
      resolve: (value) => { clearTimeout(timer); pending.delete(request); resolve(value); },
      reject: (error) => { clearTimeout(timer); pending.delete(request); reject(error); } });
    post(scene, 'SNAPSHOT', { request });
  });
}
function image(source) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' })), image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('SVG snapshot could not be decoded.')); };
    image.src = url;
  });
}
async function composite() {
  if (cameraMotion || morphSeed) throw new Error('Wait for the canvas transition before exporting.');
  const capturedRevision = revision;
  const visible = [...scenes.values()].filter((scene) => scene.layout)
    .sort((a, b) => navigationPath(index, a.id).length - navigationPath(index, b.id).length);
  const snapshots = await Promise.all(visible.map(snapshot));
  if (revision !== capturedRevision) throw new Error('Canvas changed during export.');
  const canvas = document.createElement('canvas'), width = stage.clientWidth, height = stage.clientHeight;
  const scale = Math.min(2, Math.sqrt(16000000 / (width * height)));
  canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas export is unavailable.');
  context.scale(scale, scale);
  const computed = getComputedStyle(document.documentElement);
  context.fillStyle = computed.getPropertyValue('--set-bg'); context.fillRect(0, 0, width, height);
  const bounds = stage.getBoundingClientRect();
  for (let i = 0; i < visible.length; i += 1) {
    const scene = visible[i], snapshot = snapshots[i], raster = await image(snapshot.svgString);
    const frame = scene.frame.getBoundingClientRect(), gain = scene.layout.scale * camera.scale;
    context.save(); context.beginPath();
    context.rect(frame.x - bounds.x, frame.y - bounds.y, frame.width, frame.height); context.clip();
    if (scene.id !== manifest.root_diagram) {
      context.fillStyle = computed.getPropertyValue('--set-panel');
      context.fillRect(frame.x - bounds.x, frame.y - bounds.y, frame.width, frame.height);
    }
    context.drawImage(raster, frame.x - bounds.x + snapshot.rect.x * gain, frame.y - bounds.y + snapshot.rect.y * gain,
      snapshot.rect.width * gain, snapshot.rect.height * gain);
    context.restore();
  }
  const overlay = svg.cloneNode(true), styles = el('style');
  overlay.querySelectorAll('.bridge-hit').forEach((element) => element.remove());
  overlay.setAttribute('width', width); overlay.setAttribute('height', height);
  styles.textContent = `svg { --set-accent:${computed.getPropertyValue('--set-accent')}; --set-text:${computed.getPropertyValue('--set-text')}; --set-bg:${computed.getPropertyValue('--set-bg')}; --set-muted:${computed.getPropertyValue('--set-muted')}; }\n`
    + [...document.styleSheets[0].cssRules].filter((rule) => rule.selectorText?.includes('bridge-')).map((rule) => rule.cssText).join('\n');
  overlay.prepend(styles);
  context.drawImage(await image(new XMLSerializer().serializeToString(overlay)), 0, 0, width, height);
  if (revision !== capturedRevision) throw new Error('Canvas changed during export.');
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('PNG encoding failed.');
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = `${manifest.id}-canvas.png`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  const receipt = { format: 'png', scope: 'combined', diagram: path.at(-1), width: canvas.width, height: canvas.height, bytes: blob.size };
  document.documentElement.dataset.setExport = JSON.stringify(receipt);
  return receipt;
}
let stageSize = { width: stage.clientWidth, height: stage.clientHeight };
new ResizeObserver(() => {
  const dx = (stage.clientWidth - stageSize.width) / 2, dy = (stage.clientHeight - stageSize.height) / 2;
  camera.x += dx; camera.y += dy;
  if (cameraMotion) for (const value of [cameraMotion.from, cameraMotion.to]) { value.x += dx; value.y += dy; }
  for (const value of cameraBefore.values()) { value.x += dx; value.y += dy; }
  stageSize = { width: stage.clientWidth, height: stage.clientHeight };
  revision += 1;
  scheduleDraw();
}).observe(stage);
document.documentElement.setAttribute('data-theme', theme);
addEventListener('hashchange', (event) => {
  if (new URL(event.newURL).hash === location.hash) restoreLocation();
});
addEventListener('popstate', restoreLocation);
restoreLocation();
window.ArchifyDiagramSet = {
  state: () => structuredClone({ path: [...path], opened: [...opened].sort(), camera, selected, kind, filters: filters(),
    trace, activeScenes: [...scenes.values()].filter((scene) => scene.active).length,
    scenes: scenes.size, ready: [...scenes.values()].every((scene) => scene.ready && scene.bounds && scene.layout),
    morphing: document.documentElement.hasAttribute('data-edge-morph'), moving: !!cameraMotion,
    view: current()?.state || null, geometry: current()?.geometry || {},
    worldGeometry: Object.fromEntries([...scenes.values()].flatMap((scene) => [...index.nodes.get(scene.id).keys()]
      .map((node) => [`${scene.id}:${node}`, nodeRect({ diagram: scene.id, node })]))),
    layouts: Object.fromEntries([...scenes.values()].map((scene) => [scene.id, { ...scene.layout, bounds: scene.bounds }])) }),
  navigate, expand, collapse, pan, zoom, fit, select: chooseRelation, project: groups, exportComposite: composite,
  trace: setTrace, traceStep, visualCheck, fullscreen,
  traceBetween: (from, to, options) => {
    const result = findRelationPath(index, from, to, options);
    if (result.status === 'found') setTrace(result.relation_ids);
    else {
      trace = null; selected = null; locationUpdate(false); panel(true);
      byId('chain-controls').hidden = false; byId('chain-controls').open = true;
      byId('chain-status').textContent = text.noPath; scheduleDraw();
    }
    return result;
  },
  shareLink: () => {
    locationUpdate(false, true);
    return { href: location.href, requiresHtmlFile: location.protocol === 'file:',
      note: location.protocol === 'file:' ? 'The recipient also needs access to this HTML file.' : '' };
  },
  exportCurrent: (format) => {
    if (!['svg', 'png'].includes(format) || !current()?.ready) throw new Error('Current-diagram export is unavailable.');
    post(current(), 'EXPORT', { format });
  },
  theme: (value) => {
    if (!['light', 'dark'].includes(value)) throw new Error('Invalid canvas theme.');
    theme = value; document.documentElement.setAttribute('data-theme', theme);
    for (const scene of scenes.values()) post(scene, 'THEME', { theme });
  },
};
