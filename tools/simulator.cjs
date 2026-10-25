'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const APP_ID = 'org.webos.instaonviewer';
const SERVICE_ID = APP_ID + '.service';
const ROOT = path.resolve(__dirname, '..');

function parseArguments(args) {
  if (args.some(arg => !['--debug', '--check', '--help'].includes(arg))) {
    throw new Error('Usage: npm run simulator -- [--debug] [--check]');
  }
  return { debug: args.includes('--debug'), check: args.includes('--check'), help: args.includes('--help') };
}

function within(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

function localPath(root, value, field) {
  if (typeof value !== 'string' || !value.trim() || /[\x00-\x1f"]/.test(value) || /^(?:[\\/]{2}|[a-z]+:\/\/)/i.test(value)) {
    throw new Error('Set a local filesystem path for ' + field + ' in config.local.json.');
  }
  const resolved = path.resolve(root, value);
  if (/^[\\/]{2}/.test(resolved)) throw new Error('Network filesystem paths are not supported.');
  return resolved;
}

function createLaunchPlan(root, config, options = {}, home = os.homedir()) {
  const development = config.development;
  const port = development.simulatorDebugPort;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid development.simulatorDebugPort.');
  const simulatorExecutable = localPath(root, development.simulatorExecutable, 'development.simulatorExecutable');
  if (path.extname(simulatorExecutable).toLowerCase() !== '.exe') throw new Error('Select the webOS TV 23 Windows simulator executable.');
  const serviceDirectory = localPath(root, development.simulatorServiceDirectory || path.join(home, '.webos-instaon-viewer', 'service'), 'development.simulatorServiceDirectory');
  // A service copy must never overwrite source, another build, or an existing runtime.
  if (within(root, serviceDirectory) || within(serviceDirectory, root) || serviceDirectory === path.parse(serviceDirectory).root || serviceDirectory === path.resolve(home)) {
    throw new Error('Use a dedicated simulator service directory outside the repository, preferably under your home directory.');
  }
  return {
    projectRoot: path.resolve(root),
    appPath: path.join(root, 'build', 'direct', 'app'),
    servicePath: path.join(root, 'build', 'direct', 'service'),
    simulatorExecutable, serviceDirectory, debugPort: port, debug: Boolean(options.debug)
  };
}

// Refuse symlink/junction destinations before creating any generated files.
function assertNoLinks(filename, io = fs) {
  let current = path.resolve(filename);
  for (;;) {
    try {
      if (io.lstatSync(current).isSymbolicLink()) throw new Error('Simulator paths must not contain symlinks or junctions.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const parent = path.dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

function assertIgnoredOutput(root, directory, io = fs) {
  const lines = io.readFileSync(path.join(root, '.gitignore'), 'utf8').split(/\r?\n/).map(line => line.trim());
  if (!lines.some(line => line === directory + '/' || line === '/' + directory + '/') || lines.some(line => line.startsWith('!') && (line.includes(directory) || line.includes('*')))) {
    throw new Error('Keep ' + directory + '/ ignored before using simulator tooling.');
  }
  assertNoLinks(path.join(root, directory), io);
}

function validateStaging(plan, io = fs) {
  assertIgnoredOutput(plan.projectRoot, 'build', io);
  for (const filename of [path.join(plan.appPath, 'appinfo.json'), path.join(plan.appPath, 'index.html'), path.join(plan.servicePath, 'main.cjs'), path.join(plan.servicePath, 'package.json'), path.join(plan.servicePath, 'services.json'), path.join(plan.servicePath, 'credentials.private.json')]) {
    assertNoLinks(filename, io);
    if (!io.statSync(filename).isFile()) throw new Error('Run npm run build before starting the simulator.');
  }
  const read = filename => JSON.parse(io.readFileSync(filename, 'utf8').replace(/^\uFEFF/, ''));
  const app = read(path.join(plan.appPath, 'appinfo.json'));
  const service = read(path.join(plan.servicePath, 'services.json'));
  const pkg = read(path.join(plan.servicePath, 'package.json'));
  if (app.id !== APP_ID || app.main !== 'index.html' || service.id !== SERVICE_ID || pkg.name !== SERVICE_ID || !Array.isArray(service.services) || service.services.length !== 1 || service.services[0].name !== SERVICE_ID) {
    throw new Error('Staged app/service identities do not match this repository. Rebuild with npm run build.');
  }
  // Deliberately never read or print credentials.private.json here.
}

function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  if (options.help) {
    console.log('Usage: npm run simulator -- [--debug] [--check]\n--check validates local prerequisites without copying files or launching anything.');
    return;
  }
  if (process.platform !== 'win32') throw new Error('This launcher targets webOS TV 23 Simulator on Windows.');
  const { loadConfig } = require('./config.cjs');
  const plan = createLaunchPlan(ROOT, loadConfig(ROOT), options);
  try {
    validateStaging(plan);
    assertNoLinks(plan.simulatorExecutable);
    assertNoLinks(plan.serviceDirectory);
    if (!fs.statSync(plan.simulatorExecutable).isFile()) throw new Error('Simulator executable is missing.');
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('Simulator prerequisites missing; see docs/SIMULATOR.md and run npm run build.');
    throw error;
  }
  if (options.check) {
    console.log('PASS simulator local prerequisites; nothing was copied or launched.');
    return;
  }
  // Only development settings cross the process boundary. No shell interpolation,
  // recorder credentials, device commands, environment config, or SDK script execution.
  const result = spawnSync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'launch-simulator.ps1'), '-ReadSettingsFromStdin'], {
    cwd: ROOT, input: JSON.stringify(plan), encoding: 'utf8', windowsHide: true,
    stdio: ['pipe', 'inherit', 'inherit']
  });
  if (result.error || result.signal || result.status !== 0) throw new Error('Simulator launcher failed; see the local prerequisites in docs/SIMULATOR.md.');
}

if (require.main === module) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { APP_ID, SERVICE_ID, ROOT, parseArguments, within, createLaunchPlan, assertNoLinks, assertIgnoredOutput, validateStaging, main };
