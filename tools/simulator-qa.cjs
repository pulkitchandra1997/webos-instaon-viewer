'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { randomUUID } = require('node:crypto');
const { pathToFileURL, fileURLToPath } = require('node:url');
const { setTimeout: delay } = require('node:timers/promises');
const { APP_ID, SERVICE_ID, ROOT, assertNoLinks, assertIgnoredOutput, validateStaging } = require('./simulator.cjs');

const HEAP_BUDGET = 192 * 1024 * 1024;

function parseArguments(args) {
  const options = { soakSeconds: 15, timeoutSeconds: 120, gpu: false, uiOnly: false, help: false };
  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--gpu') options.gpu = true;
    else if (argument === '--ui-only') options.uiOnly = true;
    else if (argument === '--help') options.help = true;
    else if (argument === '--soak-seconds' || argument === '--timeout-seconds') {
      const value = args[++index];
      const max = argument === '--soak-seconds' ? 3600 : 300;
      if (!/^\d+$/.test(value || '') || Number(value) < 1 || Number(value) > max) throw new Error('QA durations must be positive whole seconds within the documented limits.');
      options[argument === '--soak-seconds' ? 'soakSeconds' : 'timeoutSeconds'] = Number(value);
    } else throw new Error('Usage: npm run qa:simulator -- [--soak-seconds 15] [--timeout-seconds 120] [--gpu] [--ui-only]');
  }
  return options;
}

function validateSession(session, root, port) {
  if (!session || session.appId !== APP_ID || session.serviceId !== SERVICE_ID || !/^[a-f0-9]{32}$/.test(session.sessionId || '') || session.debug !== true || session.debugPort !== port || typeof session.appPath !== 'string' || path.resolve(session.appPath) !== path.join(root, 'build', 'direct', 'app')) {
    throw new Error('No matching owned debug session. Start this repository with npm run simulator -- --debug first.');
  }
  return session;
}

function isOwnPage(url, appPath) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'file:' || parsed.hostname || parsed.username || parsed.password) return false;
    const actual = path.resolve(fileURLToPath(parsed));
    const expected = path.join(appPath, 'index.html');
    return process.platform === 'win32' ? actual.toLowerCase() === expected.toLowerCase() : actual === expected;
  } catch (_) { return false; }
}

function debuggerUrl(value, port) {
  let parsed;
  try { parsed = new URL(value); } catch (_) { throw new Error('Invalid simulator debugger endpoint.'); }
  if (parsed.protocol !== 'ws:' || !['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) || Number(parsed.port) !== port || parsed.username || parsed.password || parsed.search || parsed.hash || !/^\/devtools\/page\/[a-zA-Z0-9._-]+$/.test(parsed.pathname)) {
    throw new Error('Refusing a debugger endpoint outside this simulator loopback port.');
  }
  // Do not perform hostname resolution, even for a supplied localhost endpoint.
  parsed.hostname = '127.0.0.1';
  return parsed.href;
}

function readTargets(port, signal) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return Promise.reject(new Error('Invalid simulator debug port.'));
  return new Promise((resolve, reject) => {
    const request = http.get({ hostname: '127.0.0.1', port, path: '/json/list', agent: false, signal }, response => {
      if (response.statusCode !== 200) {
        response.resume();
        request.destroy();
        reject(new Error('Simulator debug endpoint did not return a target list; redirects are refused.'));
        return;
      }
      const chunks = [];
      let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) request.destroy(new Error('Simulator target list exceeds the size limit.'));
        else chunks.push(chunk);
      });
      response.on('error', () => reject(new Error('Simulator target response closed unexpectedly.')));
      response.on('end', () => {
        try {
          const targets = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!Array.isArray(targets)) throw new Error();
          resolve(targets);
        } catch (_) { reject(new Error('Invalid simulator target list.')); }
      });
    });
    // A total deadline also covers a peer that trickles response bytes forever.
    const deadline = setTimeout(() => request.destroy(new Error('Simulator debug endpoint timed out.')), 5000);
    request.on('close', () => clearTimeout(deadline));
    request.on('error', () => reject(new Error('Cannot read the local simulator endpoint. Launch this repository with --debug and check the configured port.')));
  });
}

async function readTargetsWithRetry(port, signal, maxWaitMs = 30000) {
  const deadline = Date.now() + maxWaitMs;
  let lastError;
  while (Date.now() < deadline) {
    signal?.throwIfAborted();
    try { return await readTargets(port, signal); }
    catch (error) {
      lastError = error;
      if (Date.now() >= deadline) break;
      await delay(500, undefined, { signal });
    }
  }
  throw lastError || new Error('Simulator debug endpoint did not become ready.');
}

class CdpClient {
  constructor(socket, timeoutMs = 10000) {
    this.socket = socket;
    this.timeoutMs = timeoutMs;
    this.pending = new Map();
    this.nextId = 0;
    this.failure = null;
    this.openPromise = new Promise((resolve, reject) => {
      this.resolveOpen = resolve;
      this.rejectOpen = reject;
    });
    this.openTimer = setTimeout(() => {
      this.fail(new Error('Simulator CDP handshake timed out.'));
      socket.terminate();
    }, timeoutMs);
    socket.on('open', () => { clearTimeout(this.openTimer); this.resolveOpen(); });
    socket.on('error', () => this.fail(new Error('Simulator CDP socket error.')));
    socket.on('close', () => this.fail(new Error('Simulator CDP socket closed.')));
    socket.on('message', data => {
      let message;
      try { message = JSON.parse(data.toString()); } catch (_) {
        this.fail(new Error('Invalid simulator CDP response.'));
        socket.terminate();
        return;
      }
      const pending = this.pending.get(message && message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) pending.reject(new Error('Simulator CDP request failed.'));
      else pending.resolve(message.result);
    });
  }

  fail(error) {
    this.failure = this.failure || error;
    clearTimeout(this.openTimer);
    this.rejectOpen(this.failure);
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(this.failure); }
    this.pending.clear();
  }

  async open() { await this.openPromise; }

  request(method, params) {
    if (this.failure || this.socket.readyState !== 1) return Promise.reject(this.failure || new Error('Simulator CDP is not connected.'));
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const fail = () => {
        const entry = this.pending.get(id);
        if (!entry) return;
        clearTimeout(entry.timer);
        this.pending.delete(id);
        entry.reject(new Error('Simulator CDP request failed or timed out.'));
      };
      const timer = setTimeout(fail, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.socket.send(JSON.stringify({ id, method, params }), error => { if (error) fail(); }); }
      catch (_) { fail(); }
    });
  }

  async evaluate(expression) {
    const result = await this.request('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (!result || result.exceptionDetails || !result.result) throw new Error('Simulator evaluation failed (page identity, service, or UI may have changed).');
    return result.result.value;
  }

  close() {
    if (this.closePromise) return this.closePromise;
    this.fail(new Error('Simulator QA disconnected.'));
    this.closePromise = new Promise(resolve => {
      if (this.socket.readyState === 3) { resolve(); return; }
      let timer;
      const done = () => { clearTimeout(timer); this.socket.off('close', done); resolve(); };
      this.socket.once('close', done);
      timer = setTimeout(() => { try { this.socket.terminate(); } finally { done(); } }, 250);
      try { if (this.socket.readyState === 1) this.socket.close(); else this.socket.terminate(); }
      catch (_) { try { this.socket.terminate(); } finally { done(); } }
    });
    return this.closePromise;
  }
}

function ownedExpression(expression, session) {
  const url = pathToFileURL(path.join(session.appPath, 'index.html')).href;
  // Recheck on every call, including cleanup: navigation must not turn QA into a
  // controller of another page. The marker is supplied as simulator launch params.
  return `(()=>{let p=window.webOSSystem&&window.webOSSystem.launchParams;try{if(typeof p==='string')p=JSON.parse(p);}catch(_){p=null;}const u=new URL(location.href);u.search='';u.hash='';if(u.href.toLowerCase()!==${JSON.stringify(url.toLowerCase())}||!p||p.simulatorSession!==${JSON.stringify(session.sessionId)})throw new Error('Not the owned simulator page');return (${expression});})()`;
}

function sampleExpression(count) {
  return `({at:Date.now(),channels:window.cameraDiagnostics.channels.slice(0,${count}).map(t=>({channel:t.channel,frames:t.count,lastPaint:t.lastPaint})),measurements:window.cameraDiagnostics.measurements?window.cameraDiagnostics.measurements().aggregate:null,wasmBytes:Number(window.cameraDiagnostics.metrics.wasmBytes)||0,painted:Number(window.cameraDiagnostics.metrics.painted)||0,jsHeap:performance.memory?performance.memory.usedJSHeapSize:null})`;
}

async function runChecks(evaluate, config, options, signal) {
  const sleep = ms => delay(ms, undefined, { signal });
  const waitFor = async (expression, label, timeoutMs = options.timeoutSeconds * 1000) => {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      signal?.throwIfAborted();
      if (await evaluate(expression)) return;
      await sleep(400);
    }
    throw new Error('Timed out waiting for ' + label + '. Check service registration and local prerequisites.');
  };
  const active = count => Math.min(count, config.viewer.cameraCount);
  const fresh = count => `window.cameraDiagnostics.channels.slice(0,${active(count)}).every(t=>t.lastPaint&&Date.now()-t.lastPaint<3000)`;
  const select = count => evaluate(`document.querySelector('button[data-view="${count}"]').click()`);
  const serviceStatus = `new Promise(resolve=>{let done=false;const finish=r=>{if(done)return;done=true;clearTimeout(timer);resolve(r);};const timer=setTimeout(()=>finish({ok:false}),5000);try{webOS.service.request('luna://${SERVICE_ID}/',{method:'status',onSuccess:r=>finish({ok:r.returnValue===true,gateway:r.gateway===false,channels:Array.isArray(r.channels)?r.channels.length:-1}),onFailure:()=>finish({ok:false})});}catch(_){finish({ok:false});}})`;
  await waitFor(`!!(window.cameraDiagnostics&&window.cameraDiagnostics.channels.length>=${config.viewer.cameraCount}&&document.querySelector('.tile')&&document.getElementById('ratio')&&document.getElementById('fit')&&document.getElementById('toggle'))`, 'viewer controls');
  const original = await evaluate(`({view:Number(document.getElementById('grid').dataset.view),ratio:document.getElementById('ratio').value,fit:document.getElementById('fit').value,paused:document.getElementById('toggle').textContent==='Resume all',expanded:window.cameraDiagnostics.channels.findIndex(t=>t.element.classList.contains('enlarged'))+1})`);
  try {
    await evaluate(`(()=>{document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));for(const [id,value] of [['fit','fit'],['ratio','auto']]){const s=document.getElementById(id);s.value=value;s.dispatchEvent(new Event('change'));}if(document.getElementById('toggle').textContent==='Resume all')document.getElementById('toggle').click();})()`);
    await select(config.viewer.defaultView);
    await waitFor(fresh(config.viewer.defaultView), 'configured camera feeds');
    const initial = await evaluate(sampleExpression(active(config.viewer.defaultView)));

    await evaluate(`document.querySelector('.tile').click()`);
    const enlarged = await evaluate(`(()=>{const tile=document.querySelector('.tile');return {count:document.querySelectorAll('.enlarged').length,width:tile.getBoundingClientRect().width,viewportWidth:innerWidth};})()`);
    assert.equal(enlarged.count, 1, 'One camera must enlarge');
    assert(enlarged.width >= enlarged.viewportWidth - 40, 'Enlarged camera must fill viewport width');
    await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
    assert.equal(await evaluate(`document.querySelectorAll('.enlarged').length`), 0, 'Back must restore the grid');

    const layouts = [];
    for (const count of [4, 8, 10, 16].filter(n => n !== config.viewer.defaultView).concat(config.viewer.defaultView)) {
      await select(count);
      await waitFor(fresh(count), 'fresh feeds in view ' + count);
      const result = await evaluate(`({view:Number(document.getElementById('grid').dataset.view),visible:Array.from(document.querySelectorAll('.tile')).filter(t=>!t.hidden).length,overflow:document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight})`);
      assert.equal(result.view, count, 'View selection must update the grid');
      assert.equal(result.visible, count, 'Visible tile count must match the selected layout');
      assert.equal(result.overflow, false, 'Layout must fit the viewport');
      layouts.push(result);
    }

    await evaluate(`(()=>{const s=document.getElementById('ratio');s.value='4:3';s.dispatchEvent(new Event('change'));})()`);
    const geometry = await evaluate(`(()=>{const t=window.cameraDiagnostics.channels[0],c=t.canvas.getBoundingClientRect(),s=t.surface.getBoundingClientRect();return {ratio:c.width/c.height,centerError:Math.abs(c.x+c.width/2-s.x-s.width/2)};})()`);
    assert(Math.abs(geometry.ratio - 4 / 3) < .02, '4:3 aspect ratio must be applied');
    assert(geometry.centerError < 2, 'Camera canvas must be centered');
    await evaluate(`(()=>{const s=document.getElementById('ratio');s.value='auto';s.dispatchEvent(new Event('change'));document.getElementById('toggle').click();})()`);
    await waitFor(`document.getElementById('status').textContent==='Paused'`, 'pause');
    await waitFor(`(${serviceStatus}).then(r=>r.ok&&r.gateway&&r.channels===0)`, 'recorder connections to close');
    await sleep(800);
    const pausedCounts = await evaluate(`window.cameraDiagnostics.channels.slice(0,${active(config.viewer.defaultView)}).map(t=>t.count)`);
    await sleep(800);
    assert.deepEqual(await evaluate(`window.cameraDiagnostics.channels.slice(0,${active(config.viewer.defaultView)}).map(t=>t.count)`), pausedCounts, 'Paused feeds must stop painting');
    await evaluate(`document.getElementById('toggle').click()`);
    await waitFor(`(${fresh(config.viewer.defaultView)})&&window.cameraDiagnostics.channels.slice(0,${active(config.viewer.defaultView)}).every((t,i)=>t.count>${JSON.stringify(pausedCounts)}[i])`, 'feeds to resume');

    if (options.gpu) {
      const previous = await evaluate(`window.cameraDiagnostics.channels.slice(0,${active(config.viewer.defaultView)}).map(t=>t.count)`);
      assert.equal(await evaluate(`(()=>{const r=window.cameraDiagnostics.channels[0].renderer,e=r&&r.gl&&r.gl.getExtension('WEBGL_lose_context');if(!e)return false;e.loseContext();return true;})()`), true, 'GPU recovery test requires WEBGL_lose_context');
      await waitFor(`(${fresh(config.viewer.defaultView)})&&window.cameraDiagnostics.channels.slice(0,${active(config.viewer.defaultView)}).every((t,i)=>t.count>${JSON.stringify(previous)}[i]+5)`, 'GPU recovery');
    }

    const baseline = await evaluate(sampleExpression(active(config.viewer.defaultView)));
    const samples = [];
    const until = Date.now() + options.soakSeconds * 1000;
    while (Date.now() < until) {
      await sleep(Math.min(5000, until - Date.now()));
      const sample = await evaluate(sampleExpression(active(config.viewer.defaultView)));
      assert(sample.wasmBytes > 0 && sample.wasmBytes <= HEAP_BUDGET, 'Shared decoder must stay within the 192 MiB WASM heap budget');
      assert.equal(sample.channels.length, active(config.viewer.defaultView), 'Every configured visible camera must be sampled');
      assert(sample.channels.every(c => c.lastPaint && sample.at - c.lastPaint < 3000), 'Every active camera must remain fresh');
      samples.push(sample);
    }
    const final = samples.at(-1);
    assert(final && final.channels.every((c, i) => c.frames > baseline.channels[i].frames), 'Every active camera must continue painting');
    return { success: true, appId: APP_ID, cameraCount: config.viewer.cameraCount, defaultView: config.viewer.defaultView, initial, enlarged, layouts, geometry, pausedConnections: 0, gpuRecoveryTest: options.gpu, soakSeconds: options.soakSeconds, samples };
  } finally {
    // Restore the prior controls if the owned page and connection still exist.
    try {
      await evaluate(`(()=>{document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));for(const [id,value] of ${JSON.stringify([['fit', original.fit], ['ratio', original.ratio]])}){const s=document.getElementById(id);s.value=value;s.dispatchEvent(new Event('change'));}const b=document.querySelector('button[data-view="${original.view}"]');if(b)b.click();if(${Boolean(original.expanded)})document.querySelectorAll('.tile')[${original.expanded - 1}].click();if((document.getElementById('toggle').textContent==='Resume all')!==${original.paused})document.getElementById('toggle').click();})()`);
    } catch (_) { /* A closed/navigated simulator must never be reattached implicitly. */ }
  }
}

async function runUiChecks(evaluate, config, options, signal) {
  const deadline = Date.now() + options.timeoutSeconds * 1000;
  const waitFor = async expression => {
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      if (await evaluate(expression)) return;
      await delay(100, undefined, { signal });
    }
    throw new Error('Timed out waiting for simulator UI controls.');
  };
  await waitFor(`!!(document.querySelector('.tile')&&document.getElementById('grid')&&document.getElementById('ratio')&&document.getElementById('fit')&&document.getElementById('toggle')&&document.getElementById('profile'))`);
  const initial = await evaluate(`({view:Number(document.getElementById('grid').dataset.view),visible:Array.from(document.querySelectorAll('.tile')).filter(t=>!t.hidden).length,profileOptions:document.getElementById('profile').options.length,overflow:document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight})`);
  assert.equal(initial.view, config.viewer.defaultView, 'UI-only launch must use configured default layout');
  assert.equal(initial.visible, config.viewer.defaultView, 'UI-only launch must show the configured layout count');
  assert.equal(initial.overflow, false, 'UI-only launch must fit the simulator viewport');
  const layouts=[];
  for (const count of [4,8,10,16]) {
    await evaluate(`document.querySelector('button[data-view="${count}"]').click()`);
    const result=await evaluate(`({view:Number(document.getElementById('grid').dataset.view),visible:Array.from(document.querySelectorAll('.tile')).filter(t=>!t.hidden).length,overflow:document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight})`);
    assert.equal(result.view,count);assert.equal(result.visible,count);assert.equal(result.overflow,false);layouts.push(result);
  }
  await evaluate(`(()=>{const first=document.querySelector('.tile');first.focus();document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',keyCode:39}));})()`);
  assert.equal(await evaluate(`document.activeElement&&document.activeElement.classList.contains('tile')`),true,'Remote ArrowRight must move focus between visible tiles');
  await evaluate(`document.querySelector('.tile').click()`);
  const enlarged=await evaluate(`({count:document.querySelectorAll('.enlarged').length,width:document.querySelector('.tile').getBoundingClientRect().width,viewportWidth:innerWidth})`);
  assert.equal(enlarged.count,1);assert(enlarged.width>=enlarged.viewportWidth-40);
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))`);
  assert.equal(await evaluate(`document.querySelectorAll('.enlarged').length`),0);
  return {success:true,uiOnly:true,appId:APP_ID,defaultView:config.viewer.defaultView,initial,layouts,remoteNavigation:true,enlarged};
}

function writeReport(root, report, io = fs) {
  assertIgnoredOutput(root, 'reports', io);
  const directory = path.join(root, 'reports');
  assertNoLinks(directory, io);
  io.mkdirSync(directory, { recursive: true });
  const filename = path.join(directory, 'simulator-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomUUID() + '.json');
  // Exclusive creation avoids overwriting or following an existing report link.
  io.writeFileSync(filename, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  return path.relative(root, filename);
}

async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  if (options.help) {
    console.log('Usage: npm run qa:simulator -- [--soak-seconds 15] [--timeout-seconds 120] [--gpu] [--ui-only]\nRequires this repository simulator started with --debug. Live mode requires its service enabled; --ui-only does not.\nSoak: 1..3600 seconds; per-condition timeout: 1..300 seconds. Reports stay in ignored reports/.');
    return;
  }
  const config = require('./config.cjs').loadConfig(ROOT);
  const port = config.development.simulatorDebugPort;
  const appPath = path.join(ROOT, 'build', 'direct', 'app');
  validateStaging({ projectRoot: ROOT, appPath, servicePath: path.join(ROOT, 'build', 'direct', 'service') });
  assertIgnoredOutput(ROOT, 'reports');
  const sessionFile = path.join(ROOT, 'build', 'simulator', 'session.json');
  assertNoLinks(sessionFile);
  let session;
  try { session = validateSession(JSON.parse(fs.readFileSync(sessionFile, 'utf8')), ROOT, port); }
  catch (_) { throw new Error('No matching owned debug session. Start this repository with npm run simulator -- --debug first.'); }
  const abort = new AbortController();
  const cancel = () => abort.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  let client;
  const disconnect = () => { if (client) void client.close(); };
  abort.signal.addEventListener('abort', disconnect, { once: true });
  try {
    const targets = await readTargetsWithRetry(port, abort.signal);
    const matching = targets.filter(target => target.type === 'page' && isOwnPage(target.url, appPath));
    if (matching.length !== 1) throw new Error('Expected exactly one page for this repository staged app. QA will not attach to another app or choose an ambiguous target.');
    const WebSocket = require('ws');
    client = new CdpClient(new WebSocket(debuggerUrl(matching[0].webSocketDebuggerUrl, port), { followRedirects: false, handshakeTimeout: 5000, maxPayload: 4 * 1024 * 1024 }));
    await client.open();
    abort.signal.throwIfAborted();
    const evaluate = expression => client.evaluate(ownedExpression(expression, session));
    assert.equal(await evaluate('true'), true, 'QA must control only its owned launch session');
    const report = options.uiOnly ? await runUiChecks(evaluate, config, options, abort.signal) : await runChecks(evaluate, config, options, abort.signal);
    const filename = writeReport(ROOT, report);
    console.log(options.uiOnly ? 'PASS simulator UI-only: layouts, enlargement/Back, profile control, viewport fit, and no media prerequisite.' : 'PASS simulator: configured moving feeds, layouts, enlargement/Back, aspect/centering, pause/resume, and decoder heap budget.');
    console.log('Local report: ' + filename);
  } finally {
    if (client) await client.close();
    abort.signal.removeEventListener('abort', disconnect);
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
  }
}

if (require.main === module) main().catch(error => { console.error(error.name === 'AbortError' ? 'Simulator QA cancelled.' : error.message); process.exitCode = 1; });

module.exports = { parseArguments, validateSession, isOwnPage, debuggerUrl, readTargets, readTargetsWithRetry, CdpClient, ownedExpression, sampleExpression, runChecks, runUiChecks, writeReport, main };
