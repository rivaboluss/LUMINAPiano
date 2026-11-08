import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = path.join(root, 'release');
const stageName = 'LUMINA-流光钢琴';
const launcherName = 'LUMINA 流光钢琴.exe';
const csc = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe';
const stageDir = path.join(releaseDir, stageName);
const zipPath = path.join(releaseDir, 'LUMINA-流光钢琴-免安装-win.zip');
const smokeDir = path.join(releaseDir, '_smoke');
const fontCssUrl = 'https://fonts.googleapis.com/css2?family=Noto+Sans+SC:wght@400;500;700&family=Oxanium:wght@500;700;800&display=swap';
const fontUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited ${code}`));
    });
  });
}

function writeBom(file, text) {
  const body = text.charCodeAt(0) === 0xfeff ? text : `\uFEFF${text}`;
  fs.writeFileSync(file, body, 'utf8');
}

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dest);
    else copyFile(src, dest);
  }
}

async function mapPool(items, limit, fn) {
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      await fn(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
}

async function downloadFonts(dir) {
  const response = await fetch(fontCssUrl, { headers: { 'User-Agent': fontUa } });
  if (!response.ok) throw new Error(`font css download failed: ${response.status}`);
  let css = await response.text();
  const urls = [...new Set([...css.matchAll(/url\((?:'|")?(https:\/\/[^'")]+)(?:'|")?\)/g)].map((match) => match[1]))];
  if (!urls.length) throw new Error('font css did not contain any files');
  console.log(`Downloading ${urls.length} font files...`);
  fs.mkdirSync(dir, { recursive: true });
  const localUrls = new Map();
  let done = 0;
  await mapPool(urls, 16, async (url) => {
    const parts = new URL(url).pathname.split('/').filter(Boolean).slice(1);
    if (!parts.length) throw new Error(`unexpected font url ${url}`);
    const relative = path.posix.join('files', ...parts);
    const dest = path.join(dir, ...relative.split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const fileResponse = await fetch(url, { headers: { 'User-Agent': fontUa } });
        if (!fileResponse.ok) throw new Error(String(fileResponse.status));
        const bytes = Buffer.from(await fileResponse.arrayBuffer());
        if (bytes.length < 32) throw new Error('font file is too small');
        fs.writeFileSync(dest, bytes);
        localUrls.set(url, `./${relative}`);
        done += 1;
        if (done % 40 === 0 || done === urls.length) console.log(`  fonts ${done}/${urls.length}`);
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(`failed to download ${url}: ${lastError?.message || lastError}`);
  });
  const replacements = [...localUrls.entries()].sort((a, b) => b[0].length - a[0].length);
  for (const [url, relative] of replacements) {
    css = css.split(`url(${url})`).join(`url(${relative})`);
    css = css.split(`url('${url}')`).join(`url('${relative}')`);
    css = css.split(`url("${url}")`).join(`url("${relative}")`);
  }
  if (/url\((?:'|")?https?:/i.test(css)) throw new Error('font css still points at the network');
  fs.writeFileSync(path.join(dir, 'fonts.css'), css);
}

function patchHtml(indexPath) {
  let html = fs.readFileSync(indexPath, 'utf8');
  html = html.replace(/\s*<link\b[^>]*href="https:\/\/fonts\.(?:googleapis|gstatic)\.com[^"]*"[^>]*>\s*/g, '\n');
  if (/fonts\.(?:googleapis|gstatic)\.com/.test(html)) {
    throw new Error('built page still references Google Fonts');
  }
  if (!html.includes('./fonts/fonts.css')) {
    html = html.replace('</head>', '  <link rel="stylesheet" href="./fonts/fonts.css" />\n</head>');
  }
  fs.writeFileSync(indexPath, html);
}

function rawGet(port, requestPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: requestPath,
      method: 'GET'
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks)
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

function startServer(dir) {
  const child = spawn(path.join(dir, launcherName), [], {
    cwd: dir,
    env: { ...process.env, LUMINA_SILENT: '1' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  child.stdout.on('data', (chunk) => { log += chunk.toString('utf8'); });
  child.stderr.on('data', (chunk) => { log += chunk.toString('utf8'); });
  child.log = () => log;
  return child;
}

async function waitForUrl(dir, child) {
  const file = path.join(dir, '.url');
  const started = Date.now();
  while (Date.now() - started < 20000) {
    if (fs.existsSync(file)) {
      const url = fs.readFileSync(file, 'utf8').trim();
      if (/^http:\/\/127\.0\.0\.1:\d+\/$/.test(url)) return url;
    }
    if (child.exitCode != null) {
      throw new Error(`server exited ${child.exitCode}\n${child.log()}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server did not start\n${child.log()}`);
}

async function stopServer(child) {
  if (!child || child.exitCode != null) return;
  await new Promise((resolve) => {
    const timer = setTimeout(() => {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
      resolve();
    }, 1500);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill();
  });
}

async function smokeTest(dir) {
  const child = startServer(dir);
  try {
    const url = await waitForUrl(dir, child);
    const port = Number(new URL(url).port);
    const home = await rawGet(port, '/');
    const html = home.body.toString('utf8');
    if (home.status !== 200) throw new Error(`index status ${home.status}`);
    if (!html.includes('LUMINA') || !html.includes('./fonts/fonts.css')) {
      throw new Error('index.html is missing the app or local fonts');
    }
    if (/fonts\.(?:googleapis|gstatic)\.com/.test(html)) {
      throw new Error('index.html still loads Google Fonts');
    }
    const script = html.match(/<script type="module"[^>]*src="([^"]+\.js)"/)?.[1];
    const styles = [...html.matchAll(/href="(\.\/assets\/[^"]+\.css)"/g)].map((match) => match[1]);
    if (!script) throw new Error('built page has no module script');
    if (!styles.length) throw new Error('built page has no css');
    const scriptPath = `/${script.replace(/^\.\//, '')}`;
    const scriptFile = await rawGet(port, scriptPath);
    const scriptType = String(scriptFile.headers['content-type'] || '');
    if (scriptFile.status !== 200 || !/javascript/.test(scriptType)) {
      throw new Error(`script ${scriptPath} status ${scriptFile.status} type ${scriptType}`);
    }
    if (scriptFile.body.length < 1000) throw new Error('script bundle is unexpectedly small');
    for (const style of styles) {
      const styleFile = await rawGet(port, `/${style.replace(/^\.\//, '')}`);
      const styleType = String(styleFile.headers['content-type'] || '');
      if (styleFile.status !== 200 || !/css/.test(styleType)) {
        throw new Error(`css ${style} status ${styleFile.status} type ${styleType}`);
      }
    }
    const fonts = await rawGet(port, '/fonts/fonts.css');
    const fontCss = fonts.body.toString('utf8');
    if (fonts.status !== 200 || !fontCss.includes('@font-face')) throw new Error('local font css missing');
    if (/url\((?:'|")?https?:/i.test(fontCss)) throw new Error('font css is not fully offline');
    const faceCount = (fontCss.match(/@font-face/g) || []).length;
    const fontStart = fontCss.indexOf('url(./files/');
    const fontEnd = fontStart < 0 ? -1 : fontCss.indexOf('.woff2)', fontStart);
    if (fontStart < 0 || fontEnd < 0) throw new Error('font css has no woff2');
    const fontUrl = fontCss.slice(fontStart + 4, fontEnd + '.woff2'.length);
    const fontFile = await rawGet(port, `/fonts/${fontUrl.slice(2)}`);
    const fontType = String(fontFile.headers['content-type'] || '');
    if (fontFile.status !== 200 || !/font\/woff2/.test(fontType) || fontFile.body.length < 32) {
      throw new Error(`woff2 ${fontUrl} status ${fontFile.status} type ${fontType} size ${fontFile.body.length}`);
    }
    const escaped = await rawGet(port, '/../serve.ps1');
    const escapedText = escaped.body.toString('utf8');
    if (escaped.status === 200 || escapedText.includes('HttpListener')) {
      throw new Error('server allowed a path outside the app folder');
    }
    const missing = await rawGet(port, '/no-such-file.txt');
    if (missing.status !== 404) throw new Error(`missing file status ${missing.status}`);
    console.log(`Smoke test passed on ${url} (${faceCount} font faces, script ${scriptFile.body.length} bytes)`);
  } finally {
    await stopServer(child);
    const urlFile = path.join(dir, '.url');
    if (fs.existsSync(urlFile)) fs.rmSync(urlFile, { force: true });
  }
}

async function buildIcons() {
  const portableDir = path.join(root, 'scripts', 'portable');
  const maker = path.join(releaseDir, '_makeicon.exe');
  fs.mkdirSync(releaseDir, { recursive: true });
  await run(csc, [
    '/nologo', '/codepage:65001', '/optimize+',
    '/target:exe',
    '/reference:System.Drawing.dll',
    `/out:${maker}`,
    path.join(portableDir, 'MakeIcon.cs'),
    path.join(portableDir, 'IconArt.cs')
  ]);
  await run(maker, [
    path.join(portableDir, 'lumina.ico'),
    path.join(root, 'public', 'favicon.ico'),
    path.join(releaseDir, 'icon-preview.png')
  ]);
  fs.rmSync(maker, { force: true });
}

async function buildLauncher(outExe) {
  const portableDir = path.join(root, 'scripts', 'portable');
  await run(csc, [
    '/nologo', '/codepage:65001', '/optimize+',
    '/target:winexe',
    `/win32icon:${path.join(portableDir, 'lumina.ico')}`,
    '/reference:System.Windows.Forms.dll',
    '/reference:System.Drawing.dll',
    `/out:${outExe}`,
    path.join(portableDir, 'Launcher.cs'),
    path.join(portableDir, 'IconArt.cs')
  ]);
}

function folderBytes(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += folderBytes(full);
    else total += fs.statSync(full).size;
  }
  return total;
}

fs.rmSync(stageDir, { recursive: true, force: true });
fs.rmSync(smokeDir, { recursive: true, force: true });
fs.mkdirSync(releaseDir, { recursive: true });

console.log('Running tests...');
await run(process.execPath, ['--test', 'tests/core.test.js']);
console.log('Building icon...');
await buildIcons();
console.log('Building...');
await run(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--base', './']);

const appDir = path.join(stageDir, 'app');
copyDir(path.join(root, 'dist'), appDir);
await downloadFonts(path.join(appDir, 'fonts'));
patchHtml(path.join(appDir, 'index.html'));

const portableDir = path.join(root, 'scripts', 'portable');
await buildLauncher(path.join(stageDir, launcherName));
writeBom(path.join(stageDir, '使用说明.txt'), fs.readFileSync(path.join(portableDir, '使用说明.txt'), 'utf8'));

if (fs.existsSync(zipPath)) fs.rmSync(zipPath);
await run('tar.exe', ['-a', '-cf', zipPath, '-C', releaseDir, stageName]);
fs.mkdirSync(smokeDir, { recursive: true });
await run('tar.exe', ['-xf', zipPath, '-C', smokeDir]);
const extracted = path.join(smokeDir, stageName);
for (const name of [launcherName, '使用说明.txt', path.join('app', 'index.html'), path.join('app', 'favicon.svg')]) {
  if (!fs.existsSync(path.join(extracted, name))) {
    throw new Error(`zip is missing ${name}`);
  }
}
await smokeTest(extracted);
fs.rmSync(smokeDir, { recursive: true, force: true });

const zipSize = fs.statSync(zipPath).size;
const unpacked = folderBytes(stageDir);
console.log(`Release ready: ${zipPath}`);
console.log(`Zip ${(zipSize / 1024 / 1024).toFixed(1)} MB, unpacked ${(unpacked / 1024 / 1024).toFixed(1)} MB`);
