(function () {
  'use strict';
  const config = JSON.parse(document.getElementById('archify-diagram-bridge').textContent);
  const token = config.token;
  if (typeof token !== 'string' || !/^[a-f0-9]{32}$/.test(token)) throw new Error('Diagram bridge instance is not configured.');
  let active = false;
  let exporting = false;
  let frame = 0;
  let last = '';
  let lastRelationship = null;
  const container = document.querySelector('.diagram-container');
  const svg = container.querySelector(':scope > svg');
  let canvasBounds = null;
  if (config.canvas) {
    document.documentElement.setAttribute('data-embed', 'true');
    document.documentElement.setAttribute('data-canvas', 'true');
    const style = document.createElement('style');
    style.textContent = `
      html[data-canvas="true"],html[data-canvas="true"] body { margin:0!important; padding:0!important; overflow:hidden!important; background:transparent!important; min-height:0!important; }
      html[data-canvas="true"] .container { margin:0!important; padding:0!important; max-width:none!important; width:100%!important; height:100%!important; }
      html[data-canvas="true"] .container > :not(.diagram-container),html[data-canvas="true"] .toolbar { display:none!important; }
      html[data-canvas="true"] .diagram-container { position:absolute!important; inset:0!important; margin:0!important; padding:0!important; border:0!important; border-radius:0!important; background:transparent!important; box-shadow:none!important; overflow:hidden!important; }
      html[data-canvas="true"] .diagram-container > :not(svg),html[data-canvas="true"] .diagram-container::before,html[data-canvas="true"] .diagram-container::after { display:none!important; }
      html[data-canvas="true"] .diagram-container > svg { display:block!important; position:absolute!important; max-width:none!important; min-width:0!important; transform:none!important; transition:none!important; }
      html[data-canvas="true"] [data-legend] { display:none!important; }
      html[data-canvas="true"] .diagram-container > svg > rect[width="100%"][height="100%"] { display:none!important; }
      html[data-canvas="true"] [data-canvas-hidden] { visibility:hidden!important; }
      html[data-canvas="true"] [data-canvas-traced] { opacity:1!important; }
      html[data-canvas="true"] [data-canvas-traced] > .c-mask { stroke:var(--text-primary); stroke-width:2.5; }
      html[data-canvas="true"] [data-canvas-traced][data-edge-id],
      html[data-canvas="true"] [data-canvas-traced][data-edge-id] :is(path,line,polyline) { stroke-width:2.8; }
    `;
    document.head.appendChild(style);
  }
  // srcdoc inherits the file's base URL; native fragment-only history updates must stay in this opaque document.
  const replaceState = history.replaceState.bind(history);
  history.replaceState = function (state, title, url) {
    if (typeof url === 'string' && url.startsWith('#')) url = location.href.split('#')[0] + url;
    return replaceState(state, title, url);
  };
  const allowed = new Set(['INIT', 'ACTIVATE', 'RESTORE_STATE', 'FOCUS_RELATION', 'FOCUS_NODE', 'EXPORT', 'SNAPSHOT', 'THEME', 'CANVAS_VISIBILITY', 'CANVAS_TRACE']);
  const send = (type, payload) => {
    if (token) parent.postMessage({ channel: 'archify-diagram-set', diagram: config.id, token, type, payload }, '*');
  };
  const rect = (element) => {
    const r = element.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  };
  function nodeShape(node) {
    const shape = node.querySelector(':scope > .c-mask');
    if (!shape) throw new Error(`Native node shape is missing: ${node.getAttribute('data-node-id')}`);
    return shape;
  }
  function prepareDrilldowns() {
    config.drilldowns.forEach((id) => {
      const node = [...svg.querySelectorAll('[data-node-id]')].find((element) => element.getAttribute('data-node-id') === id);
      if (!node || node.querySelector('[data-drilldown-badge]')) return;
      const box = nodeShape(node).getBBox();
      if (box.width <= 0 || box.height <= 0) throw new Error(`Entrance node has no visible geometry: ${id}`);
      node.setAttribute('data-drilldown', 'true');
      const title = node.querySelector('title');
      if (title) title.textContent += config.locale === 'zh-CN' ? ' / 双击查看详情' : ' / Double-click for details';
      const badge = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      badge.setAttribute('x', box.x + box.width - 12);
      badge.setAttribute('y', box.y + 13);
      badge.setAttribute('fill', 'var(--text-primary, #9acbe7)');
      badge.setAttribute('font-size', '12');
      badge.textContent = '+';
      badge.setAttribute('aria-hidden', 'true');
      badge.setAttribute('data-drilldown-badge', '');
      badge.style.pointerEvents = 'none';
      node.appendChild(badge);
    });
  }
  function savedState() {
    return {
      viewport: Archify.view.state(), selection: Archify.focus.active(),
      relationship: Archify.focus.relationship(), reach: Archify.focus.reachability(),
      hash: location.hash, scroll: { x: container.scrollLeft, y: container.scrollTop },
    };
  }
  function geometry() {
    const nodes = {};
    svg.querySelectorAll('[data-node-id]').forEach((element) => {
      nodes[element.getAttribute('data-node-id')] = rect(nodeShape(element));
    });
    const edges = {};
    if (config.canvas) svg.querySelectorAll('[data-edge-id]').forEach((element) => {
      const id = element.getAttribute('data-edge-id');
      if (!id || edges[id]) return;
      const shape = element.matches('path,line,polyline') ? element : element.querySelector('path,line,polyline');
      if (!shape?.getTotalLength) return;
      const matrix = shape.getScreenCTM();
      if (!matrix) return;
      const length = shape.getTotalLength();
      edges[id] = Array.from({ length: 25 }, (_, i) => {
        const point = shape.getPointAtLength(length * i / 24);
        const projected = new DOMPoint(point.x, point.y).matrixTransform(matrix);
        return { x: projected.x, y: projected.y };
      });
    });
    send('GEOMETRY_CHANGED', { nodes, edges, bounds: canvasBounds, state: savedState() });
  }
  function prepareCanvas() {
    if (!config.canvas || canvasBounds) return;
    const view = svg.viewBox.baseVal;
    const content = svg.getBBox();
    const padding = 24;
    canvasBounds = { width: Math.ceil(content.width + padding * 2),
      height: Math.ceil(content.height + padding * 2) };
    for (const [key, value] of Object.entries({
      width: `${view.width}px`, height: `${view.height}px`,
      left: `${view.x - content.x + padding}px`, top: `${view.y - content.y + padding}px`,
    })) svg.style.setProperty(key, value, 'important');
  }
  function canvasVisibility(payload) {
    if (!config.canvas || !Array.isArray(payload.nodes) || !Array.isArray(payload.edges)
      || payload.nodes.length > 1000 || payload.edges.length > 10000
      || ![...payload.nodes, ...payload.edges].every((id) => typeof id === 'string' && id.length <= 128)) {
      throw new Error('Invalid canvas visibility.');
    }
    const nodes = new Set(payload.nodes), edges = new Set(payload.edges);
    svg.querySelectorAll('[data-canvas-hidden]').forEach((element) => element.removeAttribute('data-canvas-hidden'));
    svg.querySelectorAll('[data-node-id]').forEach((element) => {
      if (nodes.has(element.getAttribute('data-node-id'))) element.setAttribute('data-canvas-hidden', '');
    });
    const keys = new Set();
    svg.querySelectorAll('[data-edge-id]').forEach((element) => {
      if (edges.has(element.getAttribute('data-edge-id'))) {
        keys.add(element.getAttribute('data-edge-key'));
        (element.closest('[data-graph-role="automatic-crossover"]') || element).setAttribute('data-canvas-hidden', '');
      }
    });
    svg.querySelectorAll('[data-edge-key],[data-relationship-key],[data-relationship-hit-key]').forEach((element) => {
      if (keys.has(element.getAttribute('data-edge-key') || element.getAttribute('data-relationship-key')
        || element.getAttribute('data-relationship-hit-key'))) element.setAttribute('data-canvas-hidden', '');
    });
  }
  function watch() {
    frame = 0;
    if (!active) return;
    if (exporting) { frame = requestAnimationFrame(watch); return; }
    const signature = JSON.stringify([savedState(), rect(svg), svg.getAttribute('viewBox'),
      document.documentElement.getAttribute('data-preset'), innerWidth, innerHeight,
      container.getAttribute('data-camera-transaction')]);
    if (signature !== last) {
      last = signature;
      geometry();
      const relationship = Archify.focus.relationship()?.id || null;
      if (relationship && relationship !== lastRelationship) send('RELATION_SELECTED', { id: relationship });
      lastRelationship = relationship;
    }
    frame = requestAnimationFrame(watch);
  }
  function activate(value) {
    active = value;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    if (active) {
      last = '';
      frame = requestAnimationFrame(watch);
    } else {
      Archify.view.restore(Archify.view.state());
      send('VIEW_STATE', savedState());
    }
  }
  function restore(state) {
    if (!state) return;
    lastRelationship = state.relationship?.id || null;
    if (typeof state.hash === 'string' && state.hash.length <= 4096) {
      history.replaceState(null, '', location.href.split('#')[0] + (state.hash || '#'));
      dispatchEvent(new HashChangeEvent('hashchange'));
    }
    if (state.selection) Archify.focus.setMany([].concat(state.selection), { updateUrl: false, toggle: false });
    if (state.reach) Archify.focus.reach(state.reach.direction, { updateUrl: false, toggle: false, reveal: false });
    if (state.relationship?.id) Archify.focus.inspectRelationshipById(state.relationship.id, { updateUrl: false, toggle: false });
    requestAnimationFrame(() => {
      Archify.view.restore(state.viewport);
      container.scrollLeft = state.scroll.x;
      container.scrollTop = state.scroll.y;
      last = '';
      geometry();
    });
  }
  addEventListener('message', async (event) => {
    const message = event.data;
    if (event.source !== parent || !message || message.channel !== 'archify-diagram-set'
      || message.diagram !== config.id || !allowed.has(message.type)) return;
    try {
      const payload = message.payload || {};
      switch (message.type) {
        case 'INIT':
          await document.fonts.ready;
          await Archify.readerLayout?.whenStable?.();
          await Archify.viewerChromeLayout?.whenStable?.();
          prepareDrilldowns();
          prepareCanvas();
          send('READY', { state: savedState() });
          geometry();
          break;
        case 'ACTIVATE': activate(payload.active === true); break;
        case 'CANVAS_VISIBILITY': canvasVisibility(payload); break;
        case 'CANVAS_TRACE':
          if (!config.canvas || !Array.isArray(payload.nodes) || !Array.isArray(payload.edges)
            || payload.nodes.length > 1000 || payload.edges.length > 10000
            || ![...payload.nodes, ...payload.edges].every((id) => typeof id === 'string' && id.length <= 128)) {
            throw new Error('Invalid canvas trace.');
          }
          svg.querySelectorAll('[data-canvas-traced]').forEach((element) => element.removeAttribute('data-canvas-traced'));
          for (const [name, ids] of [['data-node-id', payload.nodes], ['data-edge-id', payload.edges]]) {
            const selected = new Set(ids);
            svg.querySelectorAll(`[${name}]`).forEach((element) => {
              if (selected.has(element.getAttribute(name))) element.setAttribute('data-canvas-traced', '');
            });
          }
          break;
        case 'RESTORE_STATE': restore(payload.state); break;
        case 'THEME':
          if (!['dark', 'light'].includes(payload.theme)) throw new Error('Invalid set theme.');
          document.documentElement.setAttribute('data-theme', payload.theme);
          break;
        case 'FOCUS_NODE':
          if (typeof payload.node !== 'string' || !Archify.focus.set(payload.node, { toggle: false, updateUrl: false })) throw new Error('Node could not be focused.');
          if (!config.canvas) Archify.view.reveal([payload.node], { instant: true });
          break;
        case 'FOCUS_RELATION':
          if (payload.node) {
            Archify.focus.set(payload.node, { toggle: false, updateUrl: false });
            if (!config.canvas) Archify.view.reveal([payload.node], { instant: true });
          }
          if (payload.edge && !Archify.focus.inspectRelationshipById(payload.edge, { toggle: false, updateUrl: false })) {
            throw new Error('Native relationship could not be focused.');
          }
          break;
        case 'EXPORT':
          if (!['svg', 'png'].includes(payload.format)) throw new Error('Unsupported current-diagram format.');
          {
            const hidden = [...svg.querySelectorAll('[data-canvas-hidden]')];
            const traced = [...svg.querySelectorAll('[data-canvas-traced]')];
            const badges = [...svg.querySelectorAll('[data-drilldown-badge]')].map((element) =>
              ({ element, parent: element.parentNode, next: element.nextSibling }));
            exporting = true;
            badges.forEach(({ element }) => element.remove());
            if (config.canvas) document.documentElement.removeAttribute('data-canvas');
            hidden.forEach((element) => element.removeAttribute('data-canvas-hidden'));
            traced.forEach((element) => element.removeAttribute('data-canvas-traced'));
            try { await Archify.exportMenu.run(payload.format); }
            finally {
              hidden.forEach((element) => element.setAttribute('data-canvas-hidden', ''));
              traced.forEach((element) => element.setAttribute('data-canvas-traced', ''));
              badges.forEach(({ element, parent, next }) => parent.insertBefore(element, next));
              if (config.canvas) document.documentElement.setAttribute('data-canvas', 'true');
              exporting = false;
              last = '';
            }
          }
          if (document.documentElement.hasAttribute('data-last-export-error')
            || document.documentElement.getAttribute('data-last-export-format') !== payload.format) {
            throw new Error(document.documentElement.getAttribute('data-last-export-error') || 'Native export did not produce a receipt.');
          }
          send('EXPORTED', { format: payload.format, diagram: config.id });
          break;
        case 'SNAPSHOT': {
          const snapshot = Archify.exportMenu.snapshotSvg();
          if (config.canvas) {
            const exported = new DOMParser().parseFromString(snapshot.svgString, 'image/svg+xml');
            exported.querySelectorAll('[data-drilldown-badge]').forEach((element) => element.remove());
            const style = exported.createElementNS('http://www.w3.org/2000/svg', 'style');
            // Standalone SVGs have no html[data-canvas] ancestor for the embedding rules.
            style.textContent = '[data-canvas-hidden] { visibility:hidden!important; } [data-canvas-traced] { opacity:1!important; } [data-canvas-traced] > .c-mask { stroke:var(--text-primary); stroke-width:2.5; } [data-legend],svg > rect[width="100%"][height="100%"] { display:none!important; }';
            exported.documentElement.appendChild(style);
            snapshot.svgString = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(exported.documentElement);
          }
          send('SNAPSHOT', { request: payload.request, ...snapshot, rect: rect(svg),
            background: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#101827' });
          break;
        }
      }
    } catch (error) {
      send('ERROR', { message: error.message, request: message.payload?.request });
    }
  });
  svg.addEventListener('dblclick', (event) => {
    const node = event.target.closest('[data-node-id]');
    if (node && config.drilldowns.includes(node.getAttribute('data-node-id'))) {
      event.preventDefault();
      send('OPEN_CHILD', { node: node.getAttribute('data-node-id'), state: savedState() });
    }
  });
  svg.addEventListener('click', (event) => {
    const node = event.target.closest('[data-node-id]');
    if (event.detail > 1 && node && config.drilldowns.includes(node.getAttribute('data-node-id'))) {
      event.stopImmediatePropagation();
    }
  }, true);
  svg.addEventListener('click', (event) => {
    const relationship = event.target.closest('[data-relationship-hit-key]');
    if (relationship?.getAttribute('data-relationship-id')) {
      send('RELATION_SELECTED', { id: relationship.getAttribute('data-relationship-id') });
    }
  }, true);
  addEventListener('keydown', (event) => {
    const menuOpen = ['exportMenu', 'preset', 'finder', 'guide', 'radar', 'semanticLens']
      .some((name) => Archify[name]?.isOpen?.());
    if (config.canClose && event.key === 'Escape' && !menuOpen
      && !event.target.closest('input,textarea,select,[contenteditable="true"]')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      send('CLOSE_CHILD', {});
    }
  }, true);
})();
