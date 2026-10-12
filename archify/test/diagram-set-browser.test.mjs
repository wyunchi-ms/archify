import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compileDiagramSet } from '../diagram-set/compiler.mjs';
import { ChromeVisualBrowser, findChrome } from '../bin/visual-check.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const fixture = path.join(root, 'archify', 'examples', 'diagram-set');
const chrome = process.env.ARCHIFY_CHROME ? findChrome() : null;

test('Offline infinite canvas expands diagrams in place and unfolds directed facts across simultaneous entrances', {
  skip: chrome ? false : 'Set ARCHIFY_CHROME to run real offline Diagram Set checks.',
}, async (t) => {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-canvas-browser-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const files = {};
  for (const [name, source] of [['small', 'set.json'], ['canvas', 'canvas.json'], ['dense', 'many-relations.json'], ['typed', 'cross-type.json']]) {
    files[name] = path.join(scratch, `${name}.html`);
    fs.writeFileSync(files[name], compileDiagramSet(path.join(fixture, source)).html);
  }
  for (const name of ['system.json', 'backend.json', 'auth.json']) fs.copyFileSync(path.join(fixture, name), path.join(scratch, name));
  const internal = JSON.parse(fs.readFileSync(path.join(fixture, 'set.json'), 'utf8'));
  internal.relations.push({ id: 'orders-upload', from: { diagram: 'backend', node: 'orders' },
    to: { diagram: 'backend', node: 'upload' }, kind: 'http', label: 'Upload receipt', evidence: { mode: 'authored' } },
  { id: 'orders-self', from: { diagram: 'backend', node: 'orders' },
    to: { diagram: 'backend', node: 'orders' }, kind: 'retry', evidence: { mode: 'authored' } });
  fs.writeFileSync(path.join(scratch, 'internal.json'), JSON.stringify(internal));
  files.internal = path.join(scratch, 'internal.html');
  fs.writeFileSync(files.internal, compileDiagramSet(path.join(scratch, 'internal.json')).html);
  const medium = JSON.parse(fs.readFileSync(path.join(fixture, 'set.json'), 'utf8'));
  const metrics = { nodes: 0, nativeEdges: 0, facts: 300 };
  for (const [id, count] of [['system', 40], ['backend', 30], ['auth', 30]]) {
    const doc = JSON.parse(fs.readFileSync(path.join(fixture, `${id}.json`), 'utf8'));
    while (doc.components.length < count) doc.components.push({ id: `perf-${id}-${doc.components.length}`,
      type: doc.components[0].type, label: `Node ${doc.components.length}`, pos: [0, 0], size: [180, 70] });
    doc.components.forEach((node, i) => { node.pos = [20 + (i % 4) * 310, 20 + Math.floor(i / 4) * 180]; node.size = [180, 70]; });
    for (const edge of doc.connections) { delete edge.fromSide; delete edge.toSide; delete edge.labelDy; }
    for (let i = 0; i < count; i += 1) for (const offset of [1, 2]) {
      if (i + offset >= count) continue;
      const from = doc.components[i].id, to = doc.components[i + offset].id;
      if (!doc.connections.some((edge) => edge.from === from && edge.to === to)) doc.connections.push({ id: `perf-edge-${id}-${i}-${offset}`, from, to });
    }
    for (const edge of doc.connections) {
      const from = doc.components.find((node) => node.id === edge.from), to = doc.components.find((node) => node.id === edge.to);
      if (from.pos[1] !== to.pos[1] || Math.abs(from.pos[0] - to.pos[0]) > 310) {
        edge.fromSide = 'bottom'; edge.toSide = from.pos[1] === to.pos[1] ? 'bottom' : 'top';
        edge.via = [[from.pos[0] + 90, from.pos[1] + 120], [to.pos[0] + 90, from.pos[1] + 120]];
      }
    }
    metrics.nodes += doc.components.length; metrics.nativeEdges += doc.connections.length;
    fs.writeFileSync(path.join(scratch, `${id}.json`), JSON.stringify(doc));
    if (id === 'auth') medium.relations = Array.from({ length: 300 }, (_, i) => ({
      id: `perf-${i}`, from: { diagram: 'system', node: 'frontend' },
      to: { diagram: 'auth', node: doc.components[i % count].id }, kind: 'http', evidence: { mode: 'authored' },
    }));
  }
  medium.projections = [{ diagram: 'system', relation_id: 'frontend_to_backend', projectionPolicy: 'derived', kind: 'http' }];
  fs.writeFileSync(path.join(scratch, 'medium.json'), JSON.stringify(medium));
  files.medium = path.join(scratch, 'medium.html');
  const compileStart = performance.now();
  fs.writeFileSync(files.medium, compileDiagramSet(path.join(scratch, 'medium.json')).html);
  metrics.compileMs = Math.round(performance.now() - compileStart);
  const browser = new ChromeVisualBrowser(chrome);
  t.after(() => browser.close());
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  await browser.cdp.send('Browser.setDownloadBehavior', { behavior: 'deny' });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    window.setErrors=[];window.setSnapshots={};
    const createObjectUrl=URL.createObjectURL.bind(URL);
    URL.createObjectURL=blob=>{
      if(parent!==window&&blob.type.startsWith('image/svg+xml'))
        blob.text().then(source=>document.documentElement.setAttribute('data-test-export-svg',source));
      return createObjectUrl(blob);
    };
    addEventListener('error',e=>setErrors.push(e.message));
    addEventListener('unhandledrejection',e=>setErrors.push(String(e.reason)));
    addEventListener('message',e=>{
      if(parent===window&&e.data?.channel==='archify-diagram-set'&&e.data.type==='SNAPSHOT')
        setSnapshots[e.data.diagram]=e.data.payload.svgString;
      if(parent!==window&&e.source===parent&&e.data?.channel==='archify-diagram-set'&&Object.hasOwn(e.data,'token'))
        document.documentElement.setAttribute('data-set-token-leak','true');
    });
    window.setWait=predicate=>new Promise((resolve,reject)=>{
      const start=performance.now();
      function poll(){
        if(predicate())return resolve();
        if(performance.now()-start>10000)return reject(new Error('Canvas timed out: '+document.getElementById('set-status')?.textContent
          +' '+JSON.stringify(window.ArchifyDiagramSet?.state())+' errors='+JSON.stringify(setErrors)));
        setTimeout(poll,25);
      } poll();
    });
  ` });
  async function run(expression, contextId) {
    const result = await send('Runtime.evaluate', { expression, contextId, returnByValue: true, awaitPromise: true });
    assert.equal(result.exceptionDetails, undefined, result.exceptionDetails?.exception?.description);
    return result.result?.value;
  }
  async function stable(id = 'system', error = false) {
    await run(`setWait(()=>window.ArchifyDiagramSet?.state().path.at(-1)===${JSON.stringify(id)}
      &&ArchifyDiagramSet.state().ready&&!ArchifyDiagramSet.state().moving&&!ArchifyDiagramSet.state().morphing)`);
    await run('new Promise(resolve=>setTimeout(resolve,80))');
    assert.deepEqual(await run('setErrors'), []);
    assert.equal(await run("document.getElementById('set-status').getAttribute('data-error')"), String(error),
      await run("document.getElementById('set-status').textContent"));
  }
  async function load(name = 'small', hash = '', width = 1440, reduced = false) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 960, deviceScaleFactor: 1, mobile: false });
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: reduced ? 'reduce' : 'no-preference' }] });
    const blank = browser.cdp.waitFor('Page.loadEventFired', session);
    await send('Page.navigate', { url: 'about:blank' });
    await blank;
    const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
    await send('Page.navigate', { url: pathToFileURL(files[name]).href + hash });
    await loaded;
    const params = new URLSearchParams(hash.replace(/^#/, ''));
    const destination = (params.get('path') || 'system').split('/').at(-1);
    await stable(hash === '#path=system%2Fauth' ? 'system' : destination, hash === '#path=system%2Fauth');
  }
  async function context(id) {
    const tree = await send('Page.getFrameTree');
    const frame = tree.frameTree.childFrames?.find((entry) => entry.frame.name === id);
    assert.ok(frame, `iframe ${id} exists`);
    return (await send('Page.createIsolatedWorld', { frameId: frame.frame.id, worldName: 'archify-canvas-test' })).executionContextId;
  }
  async function expand(diagram, node, child) {
    await run(`ArchifyDiagramSet.expand(${JSON.stringify(diagram)},${JSON.stringify(node)})`);
    await stable(child);
  }
  async function evidence(name) {
    const directory = process.env.ARCHIFY_DIAGRAM_SET_EVIDENCE;
    if (!directory) return;
    fs.mkdirSync(directory, { recursive: true });
    const screenshot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(directory, `${name}.png`), Buffer.from(screenshot.data, 'base64'));
  }
  async function assertNodeTargets(id) {
    const world = await context(id);
    const shapes = await run(`Array.from(document.querySelector('.diagram-container > svg').querySelectorAll('[data-node-id]')).map(node=>{
      const shape=node.querySelector(':scope > .c-mask'),box=shape?.getBoundingClientRect();
      return {id:node.getAttribute('data-node-id'),hidden:node.hasAttribute('data-canvas-hidden'),box:box&&{x:box.x,y:box.y,width:box.width,height:box.height}};
    })`, world);
    const view = await run('ArchifyDiagramSet.state()'), layout = view.layouts[id];
    const targets = await run(`Array.from(document.querySelectorAll('[data-node-ref]')).map(target=>({
      id:target.dataset.nodeRef,x:parseFloat(target.style.left),y:parseFloat(target.style.top),
      width:parseFloat(target.style.width),height:parseFloat(target.style.height)}))`);
    for (const shape of shapes) {
      assert.ok(shape.box, `${id}:${shape.id} has an explicit native node shape`);
      const target = targets.find((target) => target.id === `${id}:${shape.id}`);
      if (shape.hidden) { assert.equal(target, undefined); continue; }
      assert.ok(target, `${id}:${shape.id} has a canvas target`);
      const gain = layout.scale * view.camera.scale;
      const expected = {
        x: view.camera.x + (layout.x + shape.box.x * layout.scale) * view.camera.scale,
        y: view.camera.y + (layout.y + shape.box.y * layout.scale) * view.camera.scale,
        width: shape.box.width * gain, height: shape.box.height * gain,
      };
      for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(target[key] - expected[key]) < 1,
        `${id}:${shape.id} target ${key} follows its painted card, not decorative group bounds: ${target[key]} vs ${expected[key]}`);
    }
  }
  async function aligned(id, endpoint) {
    const observation = await run(`(()=>{
      const state=ArchifyDiagramSet.state(),group=ArchifyDiagramSet.project().find(g=>g.sourceRelationIds.includes(${JSON.stringify(id)}));
      const ref=group.${endpoint},box=state.worldGeometry[ref.diagram+':'+ref.node];
      const path=Array.from(document.querySelectorAll('.bridge-line:not(.is-unresolved)'))
        .find(node=>node.getAttribute('data-source-relations').split(' ').includes(${JSON.stringify(id)}));
      if(!path)return {missing:true,group};
      const numbers=path.getAttribute('d').match(/-?[0-9]+(?:\\.[0-9]+)?(?:e[+-]?\\d+)?/g).map(Number);
      const actual=${endpoint === 'from' ? 'numbers.slice(0,2)' : 'numbers.slice(-2)'};
      return {actual,box:{x:state.camera.x+box.x*state.camera.scale,y:state.camera.y+box.y*state.camera.scale,
        width:box.width*state.camera.scale,height:box.height*state.camera.scale}};
    })()`);
    assert.ok(!observation.missing, `fact ${id} has a displayed edge`);
    const [x, y] = observation.actual, box = observation.box;
    const inside = x >= box.x - 1 && x <= box.x + box.width + 1 && y >= box.y - 1 && y <= box.y + box.height + 1;
    const border = Math.min(Math.abs(x - box.x), Math.abs(x - box.x - box.width), Math.abs(y - box.y), Math.abs(y - box.y - box.height));
    assert.ok(inside && border < 1, `${id} ${endpoint} follows the actual visible node within one CSS pixel`);
  }
  await t.test('canvas fills the viewport and removes both sets of unrelated Viewer chrome', async () => {
    await load();
    assert.equal(await run("document.getElementById('stage').clientHeight"), 960);
    assert.equal(await run("document.getElementById('stage').clientWidth"), 1440);
    for (const id of ['details', 'export-svg', 'export-png', 'export-composite', 'share', 'theme', 'back', 'root']) {
      assert.equal(await run(`document.getElementById(${JSON.stringify(id)})`), null);
    }
    const world = await context('system');
    assert.equal(await run("document.documentElement.getAttribute('data-canvas')", world), 'true');
    assert.equal(await run("getComputedStyle(document.querySelector('.toolbar')).display", world), 'none');
    assert.equal(await run("getComputedStyle(document.querySelector('[data-legend]')).display", world), 'none');
    assert.equal(await run("getComputedStyle(document.querySelector('.node-outline')).display", world), 'none');
    assert.equal((await run('ArchifyDiagramSet.state()')).scenes, 1);
    await evidence('canvas-01-root');
  });
  await t.test('shared resource references restore exact native documents lazily without network or credential reuse', async () => {
    await load('canvas');
    const inspection = await run(`(()=>{
      const data=JSON.parse(document.getElementById('diagram-set-data').textContent);
      return {scenes:ArchifyDiagramSet.state().scenes,fonts:data.runtime.filter(block=>block.startsWith('<style id="archify-fonts">')).length,
        nativeBytes:Object.values(data.rendered).reduce((sum,parts)=>sum+new TextEncoder().encode(parts.map(part=>typeof part==='string'?part:data.runtime[part]).join('')).length,0),
        packedBytes:new TextEncoder().encode(JSON.stringify({runtime:data.runtime,rendered:data.rendered})).length};
    })()`);
    assert.equal(inspection.scenes, 1); assert.equal(inspection.fonts, 1);
    assert.ok(inspection.packedBytes < inspection.nativeBytes * .4);
    await expand('system', 'backend', 'backend');
    await expand('system', 'frontend', 'frontend');
    await run(`(()=>{
      const data=JSON.parse(document.getElementById('diagram-set-data').textContent),tokens=new Set();
      for(const frame of document.querySelectorAll('iframe')){
        const original=data.rendered[frame.name].map(part=>typeof part==='string'?part:data.runtime[part]).join('');
        const marker='<script id="archify-diagram-bridge" type="application/json">';
        const start=frame.srcdoc.indexOf(marker)+marker.length,end=frame.srcdoc.indexOf('<\\/script>',start);
        const config=JSON.parse(frame.srcdoc.slice(start,end));
        if(tokens.has(config.token))throw Error('Scene credentials were reused');tokens.add(config.token);
        delete config.token;delete config.canvas;
        const restored=frame.srcdoc.slice(0,start)+JSON.stringify(config).replace(/</g,'\\\\u003c')+frame.srcdoc.slice(end);
        if(restored!==original)throw Error('Packed native document was not restored byte-for-byte: '+frame.name);
      }
    })()`);
    for (const id of ['system', 'backend', 'frontend']) {
      const world = await context(id);
      assert.equal(await run("document.getElementById('archify-fonts').sheet.cssRules.length > 0", world), true);
      assert.deepEqual(await run("performance.getEntriesByType('resource').map(entry=>entry.name).filter(name=>/^(https?:|blob:)/.test(name))", world), []);
    }
  });
  await t.test('click expands in the original node and magnifies the complete parent by the child-to-node ratio', async () => {
    await load();
    const before = await run('ArchifyDiagramSet.state()');
    await run(`document.querySelector('[data-node-ref="system:backend"]').click()`);
    await stable('backend');
    const after = await run('ArchifyDiagramSet.state()'), owner = after.worldGeometry['system:backend'];
    assert.deepEqual(owner, before.worldGeometry['system:backend'], 'parent authored world layout never moves');
    const child = after.layouts.backend;
    assert.ok(Math.abs(child.scale - Math.min(owner.width / child.bounds.width, owner.height / child.bounds.height)) < 1e-8);
    assert.ok(Math.abs(child.x + child.bounds.width * child.scale / 2 - owner.x - owner.width / 2) < 1e-8);
    assert.ok(Math.abs(child.y + child.bounds.height * child.scale / 2 - owner.y - owner.height / 2) < 1e-8);
    assert.ok(after.camera.scale > before.camera.scale * 2);
    assert.ok(after.camera.scale <= before.camera.scale / child.scale + 1e-6);
    assert.equal(after.layouts.system.scale, 1);
    assert.equal(after.scenes, 2);
    for (const id of ['system', 'backend']) {
      assert.equal(await run(`getComputedStyle(document.querySelector('iframe[data-diagram="${id}"]')).filter`), 'none');
      assert.equal(await run(`getComputedStyle(document.querySelector('iframe[data-diagram="${id}"]')).opacity`), '1');
    }
    assert.equal(await run("document.querySelector('iframe[data-diagram=\"backend\"]').getAttribute('sandbox').includes('allow-same-origin')"), false);
    await evidence('canvas-02-in-place');
  });
  await t.test('entrance badges wait for native layout and hover targets exclude decorative bounds', async () => {
    // A temporarily hidden SVG can return empty bounds before its Viewer finishes initializing.
    const hook = await send('Page.addScriptToEvaluateOnNewDocument', { source: `
      if(parent!==window){
        const getBBox=SVGGraphicsElement.prototype.getBBox;
        SVGGraphicsElement.prototype.getBBox=function(...args){
          if(document.readyState==='loading'&&this.closest('[data-node-id="gateway"]'))
            return {x:0,y:0,width:0,height:0};
          return getBBox.apply(this,args);
        };
      }
    ` });
    try {
      await load(); await expand('system', 'backend', 'backend');
    } finally {
      await send('Page.removeScriptToEvaluateOnNewDocument', { identifier: hook.identifier });
    }
    const world = await context('backend');
    const badge = await run(`(()=>{
      const node=document.querySelector('[data-node-id="gateway"]'),shape=node.querySelector(':scope > .c-mask').getBBox();
      const badge=node.querySelector('[data-drilldown-badge]');
      return {x:Number(badge.getAttribute('x')),y:Number(badge.getAttribute('y')),expectedX:shape.x+shape.width-12,expectedY:shape.y+13};
    })()`, world);
    assert.equal(badge.x, badge.expectedX, 'drilldown badge is inside the initialized Gateway, not at the SVG origin');
    assert.equal(badge.y, badge.expectedY);
    await assertNodeTargets('backend');
    await run(`(()=>{
      const badge=document.querySelector('[data-node-id="gateway"] [data-drilldown-badge]');
      badge.setAttribute('x','-12');badge.setAttribute('y','13');
    })()`, world);
    assert.ok(await run(`(()=>{
      const node=document.querySelector('[data-node-id="gateway"]');
      return node.getBoundingClientRect().width>node.querySelector(':scope > .c-mask').getBoundingClientRect().width;
    })()`, world), 'an outlying badge actually enlarges the decorative group, but not the node shape');
    await run("document.querySelector('[data-node-ref=\"backend:orders\"]').click()");
    await stable('backend');
    await assertNodeTargets('backend');
    await aligned('rel-login', 'to');
    await run(`(()=>{
      const badge=document.querySelector('[data-node-id="gateway"] [data-drilldown-badge]');
      badge.setAttribute('x',${badge.expectedX});badge.setAttribute('y',${badge.expectedY});
    })()`, world);
    const target = await run(`(()=>{
      const box=document.querySelector('[data-node-ref="backend:gateway"]').getBoundingClientRect();
      return {x:box.x+box.width/2,y:box.y+box.height/2};
    })()`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...target });
    await evidence('canvas-09-gateway-hover');
  });
  await t.test('real drag and cursor-anchored wheel transform parent and children as one canvas', async () => {
    const before = await run('ArchifyDiagramSet.state()');
    const rects = await run(`Array.from(document.querySelectorAll('iframe')).map(frame=>({id:frame.name,x:frame.getBoundingClientRect().x,y:frame.getBoundingClientRect().y}))`);
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 30, y: 400, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 110, y: 440, button: 'left', buttons: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 110, y: 440, button: 'left', clickCount: 1 });
    await stable('backend');
    const after = await run('ArchifyDiagramSet.state()');
    assert.ok(Math.abs(after.camera.x - before.camera.x - 80) < .01);
    assert.ok(Math.abs(after.camera.y - before.camera.y - 40) < .01);
    assert.deepEqual(after.layouts, before.layouts);
    const moved = await run(`Array.from(document.querySelectorAll('iframe')).map(frame=>({id:frame.name,x:frame.getBoundingClientRect().x,y:frame.getBoundingClientRect().y}))`);
    rects.forEach((rect, i) => {
      assert.ok(Math.abs(moved[i].x - rect.x - 80) < 1);
      assert.ok(Math.abs(moved[i].y - rect.y - 40) < 1);
    });
    const anchor = { x: 450, y: 350 };
    const worldPoint = { x: (anchor.x - after.camera.x) / after.camera.scale, y: (anchor.y - after.camera.y) / after.camera.scale };
    await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: anchor.x, y: anchor.y, deltaX: 0, deltaY: -80 });
    await stable('backend');
    const zoomed = (await run('ArchifyDiagramSet.state()')).camera;
    assert.ok(zoomed.scale > after.camera.scale);
    assert.ok(Math.abs(zoomed.x + worldPoint.x * zoomed.scale - anchor.x) < 1);
    assert.ok(Math.abs(zoomed.y + worldPoint.y * zoomed.scale - anchor.y) < 1);
    for (const id of ['rel-login', 'rel-orders', 'rel-upload']) await aligned(id, 'to');
  });
  await t.test('example unfolds one-to-one into one-to-many and many-to-many with both sides open', async () => {
    await load('canvas');
    const http = () => run("ArchifyDiagramSet.project().filter(group=>group.protocol==='HTTPS')");
    const ids = ['checkout-login', 'checkout-orders', 'shell-login', 'shell-orders'];
    let projected = await http();
    assert.equal(projected.length, 1); assert.equal(projected[0].count, 4);
    await expand('system', 'backend', 'backend');
    projected = await http();
    assert.equal(projected.length, 2);
    assert.ok(projected.every((group) => group.from.node === 'frontend' && group.count === 2));
    await expand('system', 'frontend', 'frontend');
    projected = await http();
    assert.equal(projected.length, 4);
    assert.deepEqual(projected.flatMap((group) => group.sourceRelationIds).sort(), ids);
    const state = await run('ArchifyDiagramSet.state()');
    assert.deepEqual(state.opened, ['backend', 'frontend']); assert.equal(state.scenes, 3);
    assert.equal(await run("document.querySelectorAll('.bridge-line[data-from^=\"frontend:\"][data-to^=\"backend:\"]').length"), 4);
    for (const id of ids) { await aligned(id, 'from'); await aligned(id, 'to'); }
    await run('ArchifyDiagramSet.fit()'); await stable('frontend');
    await evidence('canvas-03-many-to-many');
  });
  await t.test('nested expansion keeps all ancestors and sibling scenes, while endpoints follow repeated pan/zoom', async () => {
    await expand('backend', 'gateway', 'auth');
    assert.deepEqual((await run('ArchifyDiagramSet.state()')).opened, ['auth', 'backend', 'frontend']);
    assert.equal((await run('ArchifyDiagramSet.state()')).scenes, 4);
    for (let i = 0; i < 3; i += 1) {
      await run('ArchifyDiagramSet.pan(50,-25);ArchifyDiagramSet.zoom(1.1)');
      await stable('auth');
      await aligned('shell-login', 'to');
      await aligned('checkout-login', 'to');
      await aligned('session-orders', 'from');
      await aligned('session-orders', 'to');
    }
    const projected = await run('ArchifyDiagramSet.project().flatMap(group=>group.sourceRelationIds)');
    assert.equal(new Set(projected).size, projected.length);
    await evidence('canvas-04-nested');
  });
  await t.test('collapse refolds facts, removes descendants only and preserves sibling placements', async () => {
    const before = await run('ArchifyDiagramSet.state()');
    await run("ArchifyDiagramSet.collapse('backend')");
    await stable('system');
    const after = await run('ArchifyDiagramSet.state()');
    assert.deepEqual(after.opened, ['frontend']); assert.equal(after.scenes, 2);
    assert.deepEqual(after.layouts.frontend, before.layouts.frontend);
    const groups = await run("ArchifyDiagramSet.project().filter(group=>group.protocol==='HTTPS')");
    assert.equal(groups.length, 2);
    assert.ok(groups.every((group) => group.from.diagram === 'frontend' && group.to.diagram === 'system' && group.count === 2));
    await run("ArchifyDiagramSet.collapse('frontend')"); await stable();
    assert.equal(await run("ArchifyDiagramSet.project().filter(group=>group.protocol==='HTTPS').length"), 1);
    assert.equal(await run("document.querySelectorAll('.bridge-line[data-source-relations]').length"), 0,
      'fully folded facts use their authored native parent edges, not duplicate overlays');
  });
  await t.test('full expanded forest survives browser history, refresh and deep links', async () => {
    await load('canvas');
    await expand('system', 'backend', 'backend'); await expand('system', 'frontend', 'frontend');
    const hash = await run('location.hash');
    assert.ok(new URLSearchParams(hash.slice(1)).get('open').includes('backend'));
    await run('history.back()'); await stable('backend');
    assert.deepEqual((await run('ArchifyDiagramSet.state()')).opened, ['backend']);
    await run('history.forward()'); await stable('frontend');
    assert.deepEqual((await run('ArchifyDiagramSet.state()')).opened, ['backend', 'frontend']);
    await load('canvas', hash);
    assert.deepEqual((await run('ArchifyDiagramSet.state()')).opened, ['backend', 'frontend']);
    await load('small', '#path=system%2Fbackend%2Fauth');
    assert.equal((await run('ArchifyDiagramSet.state()')).scenes, 3);
    await run("location.hash='#path=system%2Fauth'");
    await stable('system', true);
    await load('small', '#path=system%2Fauth');
    assert.deepEqual((await run('ArchifyDiagramSet.state()')).opened, []);
  });
  await t.test('hierarchical inspector is docked outside the canvas and keeps raw provenance collapsed', async () => {
    await load('canvas'); await expand('system', 'backend', 'backend'); await expand('system', 'frontend', 'frontend');
    await run("document.getElementById('relations-toggle').click()");
    await stable('frontend');
    const placement = await run(`(()=>{
      const stage=document.getElementById('stage').getBoundingClientRect(),panel=document.getElementById('relations-panel').getBoundingClientRect();
      return {stageRight:stage.right,panelLeft:panel.left,stageWidth:stage.width,panelWidth:panel.width};
    })()`);
    assert.ok(placement.stageRight <= placement.panelLeft + .01);
    assert.ok(placement.stageWidth >= 1000);
    assert.ok(await run("document.querySelectorAll('.relation-tree > summary').length >= 2"));
    assert.ok(await run("document.querySelectorAll('.relation-branch').length >= 4"));
    assert.ok(await run("Array.from(document.querySelectorAll('.relation-provenance')).every(detail=>!detail.open)"));
    await run("ArchifyDiagramSet.select('checkout-orders')");
    await stable('frontend');
    assert.ok(await run("document.querySelector('[data-relation-id=\"checkout-orders\"]').closest('.relation-tree').open"));
    assert.match(await run("document.querySelector('[data-relation-id=\"checkout-orders\"]').textContent"), /Web Frontend.*Checkout App.*Backend.*Orders API/);
    await evidence('canvas-05-docked-relations');
    await run("document.getElementById('relations-close').click()");
    await stable('frontend');
    assert.equal(await run("document.getElementById('stage').clientWidth"), 1440);
  });
  await t.test('collapsing after docking retains the pre-expansion world center in the resized viewport', async () => {
    await load('canvas');
    const before = (await run('ArchifyDiagramSet.state()')).camera;
    await expand('system', 'backend', 'backend');
    await run("document.getElementById('relations-toggle').click()");
    await stable('backend');
    const width = await run("document.getElementById('stage').clientWidth");
    await run("ArchifyDiagramSet.collapse('backend')"); await stable();
    const after = (await run('ArchifyDiagramSet.state()')).camera;
    assert.equal(after.scale, before.scale);
    assert.ok(Math.abs(after.x - before.x - (width - 1440) / 2) < .01);
    assert.ok(Math.abs(after.y - before.y) < .01);
  });
  await t.test('bundle interactions never flash an unrelated authored native route in any animation frame', async () => {
    await load('small'); await expand('system', 'backend', 'backend');
    const world = await context('backend');
    const native = `(()=>{
      const edge=document.querySelector('[data-edge-id="authenticated_orders"]');
      const shape=edge.matches('path,line,polyline')?edge:edge.querySelector('path,line,polyline');
      return ['d','x1','y1','x2','y2','points'].map(name=>shape.getAttribute(name));
    })()`;
    const route = await run(native, world);
    for (let i = 0; i < 2; i += 1) {
      const frames = await run(`new Promise(resolve=>{
        const samples=[],start=performance.now();
        ArchifyDiagramSet.select('rel-orders');
        function sample(){
          samples.push(Array.from(document.querySelectorAll('.bridge-line[data-source-relations],.bridge-morph'))
            .map(node=>node.getAttribute('data-source-relations')));
          if(performance.now()-start>=350)return resolve(samples);
          requestAnimationFrame(sample);
        }requestAnimationFrame(sample);
      })`);
      assert.ok(frames.every((ids) => ids.every((id) => !id.split(' ').includes('rel-auth-orders'))));
      assert.deepEqual(await run(native, world), route);
    }
    await load('dense'); await expand('system', 'backend', 'backend');
    await run("ArchifyDiagramSet.select('orders-create')");
    await stable('backend');
    const paths = await run("Array.from(document.querySelectorAll('.bridge-line[data-to=\"backend:orders\"]')).map(node=>node.getAttribute('data-source-relations').split(' '))");
    assert.equal(paths.length, 2);
    assert.equal(paths.flat().length, 7); assert.equal(new Set(paths.flat()).size, 7);
    await run("document.getElementById('relations-toggle').click()");
    const bundle = await run("ArchifyDiagramSet.project().find(group=>group.to.node==='orders').key");
    await run(`Array.from(document.querySelectorAll('[data-bundle]')).find(node=>node.dataset.bundle===${JSON.stringify(bundle)}).click()`);
    await stable('backend');
    assert.equal(await run("document.querySelectorAll('.bridge-line[data-to=\"backend:orders\"]').length"), 7);
  });
  await t.test('filters and internal/self facts preserve directed source IDs without duplicating native edges', async () => {
    await load('internal'); await expand('system', 'backend', 'backend');
    assert.equal(await run("document.querySelectorAll('.bridge-line[data-source-relations=\"orders-self\"]').length"), 1);
    assert.equal(await run("document.querySelectorAll('.bridge-line[data-source-relations=\"orders-upload\"]').length"), 1);
    assert.equal(await run("document.querySelectorAll('.bridge-line[data-source-relations=\"rel-auth-orders\"]').length"), 0);
    await run("document.getElementById('relation-protocol').value='HTTPS';document.getElementById('relation-protocol').dispatchEvent(new Event('change'))");
    await stable('backend');
    assert.deepEqual(await run('ArchifyDiagramSet.project().flatMap(group=>group.sourceRelationIds).sort()'), ['rel-login', 'rel-orders']);
    await run("ArchifyDiagramSet.collapse('backend')"); await stable();
    assert.equal(await run("document.querySelector('[data-projection-id=\"frontend_to_backend\"]').textContent"), '×2 / 3');
  });
  await t.test('keyboard, touch pinch, reduced motion, responsive docking and global search use the same canvas', async () => {
    await load('canvas', '', 375, true);
    await run(`(()=>{
      const target=document.querySelector('[data-node-ref="system:backend"]');target.focus();target.click();
    })()`);
    await stable('backend');
    assert.equal((await run('ArchifyDiagramSet.state()')).moving, false);
    assert.equal((await run('ArchifyDiagramSet.state()')).morphing, false);
    const before = (await run('ArchifyDiagramSet.state()')).camera.scale;
    await run(`(()=>{
      const c=document.getElementById('stage'),p=(type,id,x)=>new PointerEvent(type,{bubbles:true,pointerId:id,pointerType:'touch',button:0,clientX:x,clientY:300});
      c.dispatchEvent(p('pointerdown',1,100));c.dispatchEvent(p('pointerdown',2,200));
      c.dispatchEvent(p('pointermove',2,250));c.dispatchEvent(p('pointerup',2,250));c.dispatchEvent(p('pointerup',1,100));
    })()`);
    await stable('backend');
    assert.ok((await run('ArchifyDiagramSet.state()')).camera.scale > before);
    await run("document.getElementById('relations-toggle').click()");
    await stable('backend');
    assert.ok(await run("document.getElementById('stage').getBoundingClientRect().bottom <= document.getElementById('relations-panel').getBoundingClientRect().top + 1"));
    assert.ok(await run('document.documentElement.scrollWidth <= innerWidth'));
    await run("document.getElementById('global-search').value='JWT';document.getElementById('global-search').dispatchEvent(new Event('input'));document.querySelector('#search-results button').click()");
    await stable('auth');
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await stable('backend');
    await evidence('canvas-06-mobile');
  });
  await t.test('all five native diagram types retain explicit correspondence, native inspection and isolated drawing', async () => {
    await load('typed');
    const manifest = JSON.parse(fs.readFileSync(path.join(fixture, 'cross-type.json'), 'utf8'));
    for (const id of ['dataflow', 'workflow', 'sequence', 'lifecycle']) {
      const chain = await run(`(()=>{
        const mapping=JSON.parse(document.getElementById('diagram-set-data').textContent).manifest;
        const parents=new Map(mapping.drilldowns.map(entry=>[entry.to_diagram,entry.from.diagram]));
        const chain=[${JSON.stringify(id)}];while(parents.has(chain[0]))chain.unshift(parents.get(chain[0]));return chain;
      })()`);
      await run(`ArchifyDiagramSet.navigate(${JSON.stringify(chain)})`); await stable(id);
      const view = await run('ArchifyDiagramSet.state()'), scene = view.layouts[id];
      await assertNodeTargets(id);
      for (const frame of await run("Array.from(document.querySelectorAll('iframe')).map(frame=>({filter:getComputedStyle(frame).filter,opacity:getComputedStyle(frame).opacity}))")) {
        assert.equal(frame.filter, 'none'); assert.equal(frame.opacity, '1');
      }
      assert.ok(scene.bounds.width * scene.scale * view.camera.scale > 300,
        'deep typed scenes remain readable instead of hitting the old shallow zoom limit');
      await run(`ArchifyDiagramSet.select(${JSON.stringify(`typed-${id}`)})`);
      assert.equal((await run('ArchifyDiagramSet.state()')).selected, `typed-${id}`);
      assert.ok(await run("document.getElementById('relation-list').textContent.includes('Fictional authored boundary correspondence')"));
      const mapping = manifest.semantic_mappings.find((entry) => entry.diagram === id), world = await context(id);
      await run(`document.querySelector('[data-relationship-hit-key][data-relationship-id="${mapping.edge_id}"]').dispatchEvent(new MouseEvent('click',{bubbles:true}))`, world);
      await stable(id);
      assert.equal((await run('ArchifyDiagramSet.state()')).selected, `typed-${id}`);
      assert.equal(await run("document.documentElement.getAttribute('data-set-token-leak')", world), null);
    }
    assert.equal((await run('ArchifyDiagramSet.state()')).scenes, 5);
    await evidence('canvas-07-typed');
  });
  await t.test('current native exports and real composed PNG remain available without toolbars', async () => {
    await load(); await expand('system', 'backend', 'backend');
    await run(`(()=>{
      window.setCompositePaints=[];
      const drawImage=CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage=function(...args){
        setCompositePaints.push({filter:this.filter,alpha:this.globalAlpha});
        return drawImage.apply(this,args);
      };
    })()`);
    const receipt = await run('ArchifyDiagramSet.exportComposite()');
    assert.equal(receipt.scope, 'combined'); assert.ok(receipt.bytes > 10000); assert.ok(receipt.width > 1400);
    const paints = await run('setCompositePaints');
    assert.equal(paints.length, 3, 'both native scenes and their relation overlay were actually composed');
    for (const paint of paints) { assert.equal(paint.filter, 'none'); assert.equal(paint.alpha, 1); }
    assert.ok(await run(`(()=>{
      const snapshot=new DOMParser().parseFromString(setSnapshots.system,'image/svg+xml');
      return snapshot.querySelector('[data-node-id="backend"]').hasAttribute('data-canvas-hidden')
        &&Array.from(snapshot.querySelectorAll('style')).some(style=>style.textContent.includes('[data-canvas-hidden] { visibility:hidden!important; }'));
    })()`), 'composed snapshots retain hidden entrance nodes/edges instead of reviving obsolete endpoints');
    await expand('backend', 'gateway', 'auth');
    await run("ArchifyDiagramSet.navigate(['system','backend'])"); await stable('backend');
    const world = await context('backend');
    for (const format of ['svg', 'png']) {
      await run(`ArchifyDiagramSet.exportCurrent(${JSON.stringify(format)})`);
      await run(`setWait(()=>document.getElementById('set-status').textContent.endsWith(${JSON.stringify(format)}))`);
      assert.equal(await run("document.documentElement.getAttribute('data-last-export-format')", world), format);
      assert.equal(await run("document.querySelector('[data-node-id=\"gateway\"]').hasAttribute('data-canvas-hidden')", world), true);
      if (format === 'svg') assert.ok(await run(`(()=>{
        const exported=new DOMParser().parseFromString(document.documentElement.getAttribute('data-test-export-svg'),'image/svg+xml');
        return !!exported.querySelector('[data-node-id="gateway"]')&&!exported.querySelector('[data-canvas-hidden],[data-drilldown-badge]');
      })()`, world), 'clean current SVG retains the canonical entrance and excludes canvas-only state');
    }
  });
  await t.test('100 nodes and 300 facts are lazy, bounded and count each visible source only once', async () => {
    const start = performance.now();
    await load('medium'); await expand('system', 'backend', 'backend'); await expand('backend', 'gateway', 'auth');
    await run("ArchifyDiagramSet.select('perf-0')"); await stable('auth');
    assert.equal((await run('ArchifyDiagramSet.state()')).scenes, 3);
    const ids = await run("Array.from(document.querySelectorAll('.bridge-line[data-source-relations]')).flatMap(node=>node.getAttribute('data-source-relations').split(' '))");
    assert.equal(ids.length, 300); assert.equal(new Set(ids).size, 300);
    const paths = await run("document.querySelectorAll('.bridge-line[data-source-relations]').length");
    assert.ok(paths <= 31, 'each endpoint bundle plus the selected fact, not 300 paths');
    assert.equal(metrics.nodes, 100); assert.equal(metrics.nativeEdges, 191);
    await aligned('perf-0', 'to');
    await evidence('canvas-08-medium');
    const report = { ...metrics, navigationAndChecksMs: Math.round(performance.now() - start),
      liveScenes: 3, visibleFactPaths: paths, sourceIds: 300, node: process.versions.node };
    t.diagnostic(JSON.stringify(report));
    if (process.env.ARCHIFY_DIAGRAM_SET_EVIDENCE) fs.writeFileSync(
      path.join(process.env.ARCHIFY_DIAGRAM_SET_EVIDENCE, 'benchmark.json'), JSON.stringify(report, null, 2));
  });
  await t.test('source-bound credentials reject forged messages and revoke an unexpectedly navigated frame', async () => {
    await load(); await expand('system', 'backend', 'backend');
    const before = await run('ArchifyDiagramSet.state()');
    await run(`dispatchEvent(new MessageEvent('message',{source:window,data:{
      channel:'archify-diagram-set',diagram:'backend',token:'00000000000000000000000000000000',type:'OPEN_CHILD',payload:{node:'gateway'}
    }}))`);
    assert.deepEqual((await run('ArchifyDiagramSet.state()')).opened, before.opened);
    assert.deepEqual(await run("performance.getEntriesByType('resource').map(e=>e.name).filter(n=>/^https?:/.test(n))"), []);
    for (const id of ['system', 'backend']) {
      const world = await context(id);
      assert.equal(await run("document.documentElement.getAttribute('data-set-token-leak')", world), null);
      assert.deepEqual(await run("performance.getEntriesByType('resource').map(e=>e.name).filter(n=>/^https?:/.test(n))", world), []);
    }
    const world = await context('backend');
    await run('location.reload()', world);
    await run("setWait(()=>document.getElementById('set-status').getAttribute('data-error')==='true')");
    assert.match(await run("document.getElementById('set-status').textContent"), /Unexpected diagram navigation/);
    await run(`dispatchEvent(new MessageEvent('message',{source:document.querySelector('iframe[data-diagram="backend"]').contentWindow,
      data:{channel:'archify-diagram-set',diagram:'backend',token:null,type:'READY',payload:{}}}))`);
    assert.equal((await run('ArchifyDiagramSet.state()')).ready, false);
  });
});
