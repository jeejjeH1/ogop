// Deterministic frame capture: node tools/capture.js <out> [fps] [from] [to] | --stills t1,t2,...
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const URL = process.env.URL || 'http://127.0.0.1:8123/index.html?capture';
(async () => {
  const args = process.argv.slice(2);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-vsync'] });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('console', m => { if (m.type() === 'error') console.error('PAGE:', m.text()); });
  page.on('pageerror', e => { console.error('PAGEERR:', e.message); process.exit(1); });
  await page.goto(URL);
  await page.waitForFunction('window.__ready === true', null, { timeout: 120000 });
  const dur = await page.evaluate('window.__duration');
  if (args[0] === '--stills') {
    const dir = args[2] || 'stills'; fs.mkdirSync(dir, { recursive: true });
    for (const t of args[1].split(',').map(Number)) {
      await page.evaluate(t => window.__render(t), t);
      await page.screenshot({ path: `${dir}/t${String(t.toFixed(2)).padStart(7, '0')}.jpg`, type: 'jpeg', quality: 88 });
    }
    await browser.close(); return;
  }
  const out = args[0], fps = +(args[1] || 30);
  const total = Math.ceil(dur * fps);
  const from = +(args[2] || 0), to = Math.min(+(args[3] || total), total);
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg', '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-pix_fmt', 'yuv420p', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const t0 = Date.now();
  for (let f = from; f < to; f++) {
    await page.evaluate(t => window.__render(t), f / fps);
    const buf = await page.screenshot({ type: 'jpeg', quality: 95 });
    if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    if ((f - from) % 60 === 0) console.log(`[${out}] frame ${f}/${to}  ${((Date.now() - t0) / (f - from + 1)).toFixed(0)} ms/f`);
  }
  ff.stdin.end(); await new Promise(r => ff.on('close', r));
  await browser.close();
})();
