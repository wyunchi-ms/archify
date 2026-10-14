#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ChromeVisualBrowser, findChrome } from '../archify/bin/visual-check.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = path.join(root, 'archify', 'examples', 'diagram-set', 'repository', 'output.html');
const output = path.resolve(process.argv[2] || path.join(root, 'docs', 'assets', 'archify-canvas.gif'));
if (path.extname(output).toLowerCase() !== '.gif') throw new Error('Choose a .gif recording output.');
const chrome = findChrome();
if (!chrome) throw new Error('Set ARCHIFY_CHROME to record the real browser.');
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'archify-canvas-recording-'));
const browser = new ChromeVisualBrowser(chrome);
const frames = [], steps = [];
let recording = false, capturePromise;
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
try {
  const session = await browser.sessionPromise;
  const send = (method, params = {}) => browser.cdp.send(method, params, session);
  const run = async (expression, awaitPromise = false) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  };
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  const loaded = browser.cdp.waitFor('Page.loadEventFired', session);
  await send('Page.navigate', { url: pathToFileURL(input).href });
  await loaded;
  const settle = () => run(`new Promise((resolve,reject)=>{
    const start=performance.now();
    function check(){
      const s=window.ArchifyDiagramSet?.state();
      if(s?.ready&&!s.moving&&!s.morphing)return resolve();
      if(performance.now()-start>10000)return reject(new Error('Recording scene did not settle'));
      setTimeout(check,25);
    }check();
  })`, true);
  await settle();
  const started = performance.now();
  recording = true;
  capturePromise = (async () => {
    while (recording) {
      const time = (performance.now() - started) / 1000;
      const capture = await send('Page.captureScreenshot', { format: 'png' });
      const file = `${String(frames.length).padStart(5, '0')}.png`;
      fs.writeFileSync(path.join(scratch, file), Buffer.from(capture.data, 'base64'));
      frames.push({ file, time });
      await delay(100);
    }
  })();
  async function step(name, expression, screenshot = false) {
    if (expression) await run(expression);
    await settle();
    await delay(800);
    const state = await run('ArchifyDiagramSet.state()');
    const projected = await run('ArchifyDiagramSet.project()');
    const ids = projected.flatMap(group => group.sourceRelationIds);
    assert.equal(new Set(ids).size, ids.length);
    steps.push({ name, seconds: (performance.now() - started) / 1000,
      opened: state.opened, selected: state.selected, trace: state.trace?.relation_ids || [],
      groups: projected.length, visibleFactIds: ids, quality: await run('ArchifyDiagramSet.visualCheck()') });
    if (screenshot) {
      fs.mkdirSync(path.join(path.dirname(output), 'drilldown-canvas'), { recursive: true });
      const capture = await send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(path.dirname(output), 'drilldown-canvas', `${name}.png`), Buffer.from(capture.data, 'base64'));
    }
  }
  await step('01-root', '', true);
  await step('02-command-detail', "ArchifyDiagramSet.expand('root','cli')");
  await step('03-one-to-many', "ArchifyDiagramSet.expand('root','engine')", true);
  await step('04-root-context', 'ArchifyDiagramSet.fit()');
  await step('05-renderer-detail', "ArchifyDiagramSet.expand('engine','renderers')", true);
  await step('06-trace-selection', "ArchifyDiagramSet.trace('bundle-architecture')");
  await step('07-trace-first-hop', 'ArchifyDiagramSet.traceStep(0)');
  await step('08-trace-second-hop', 'ArchifyDiagramSet.traceStep(1)');
  await step('09-trace-third-hop', 'ArchifyDiagramSet.traceStep(2)', true);
  await step('10-pan-zoom', 'ArchifyDiagramSet.pan(120,-40);ArchifyDiagramSet.zoom(.85)');
  await step('11-refold-native', "ArchifyDiagramSet.collapse('native')");
  await step('12-refold-engine', "ArchifyDiagramSet.collapse('engine')");
  await step('13-refold-command', "ArchifyDiagramSet.collapse('commands');ArchifyDiagramSet.fit()", true);
  recording = false;
  await capturePromise;
  const ended = (performance.now() - started) / 1000;
  assert.ok(frames.length >= 40, 'Record continuous real browser frames, not a slideshow of selected states');
  const concat = frames.map((frame, i) => `file '${frame.file}'\nduration ${Math.max(.01, (frames[i + 1]?.time ?? ended) - frame.time).toFixed(5)}\n`).join('')
    + `file '${frames.at(-1).file}'\n`;
  fs.writeFileSync(path.join(scratch, 'frames.ffconcat'), `ffconcat version 1.0\n${concat}`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const encoded = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'concat', '-safe', '0',
    '-i', 'frames.ffconcat', '-filter_complex', 'fps=8,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen[p];[b][p]paletteuse',
    '-loop', '0', output], { cwd: scratch, encoding: 'utf8', timeout: 120000 });
  if (encoded.status !== 0) throw new Error(`Recording encoding failed: ${encoded.stderr}`);
  const decoded = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries',
    'stream=width,height,nb_read_frames:format=duration', '-of', 'json', output], { encoding: 'utf8', timeout: 30000 });
  if (decoded.status !== 0) throw new Error(`Recording verification failed: ${decoded.stderr}`);
  const media = JSON.parse(decoded.stdout);
  assert.ok(Number(media.streams[0].nb_read_frames) >= 40);
  assert.ok(Number(media.format.duration) >= 8);
  const receipt = { schemaVersion: 1, inputSha256: createHash('sha256').update(fs.readFileSync(input)).digest('hex'),
    browser: await browser.cdp.send('Browser.getVersion'), node: process.versions.node,
    viewport: { width: 1280, height: 800 }, capture: 'continuous real Page.captureScreenshot samples',
    capturedFrames: frames.length, wallSeconds: ended, media, steps,
    artifactSha256: createHash('sha256').update(fs.readFileSync(output)).digest('hex') };
  fs.writeFileSync(output.replace(/\.gif$/i, '.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(`Recorded ${frames.length} real frames over ${ended.toFixed(2)} seconds: ${output}`);
} finally {
  recording = false;
  try { if (capturePromise) await capturePromise; }
  finally {
    try { await browser.close(); }
    finally { fs.rmSync(scratch, { recursive: true, force: true }); }
  }
}
