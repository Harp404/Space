/**
 * Demo capture — drives the real app and records it frame by frame.
 * ============================================================================
 * This is not a slideshow of screenshots. It drives the actual UI in a real
 * browser and grabs frames at a fixed rate while things move, so the animated
 * parts — the descent, the camera flights, the storm bands painting — survive
 * into the video.
 *
 * Everything on screen is the running system. Nothing is mocked for the film.
 *
 *   node demo/capture.js            full run
 *   node demo/capture.js --scene 3  one scene, for iterating
 * ============================================================================
 */
const puppeteer = require('../frontend/node_modules/puppeteer-core');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'frames');
const FPS = 10;
const URL = process.env.DEMO_URL || 'http://localhost:5177/';

let frame = 0;
let page;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Grab one frame. */
async function shot() {
  await page.screenshot({ path: path.join(OUT, `f${String(frame++).padStart(5, '0')}.png`) });
}

/** Record for `ms`, capturing at FPS. Use while something is moving. */
async function record(ms) {
  const n = Math.round((ms / 1000) * FPS);
  const gap = 1000 / FPS;
  for (let i = 0; i < n; i++) {
    const t0 = Date.now();
    await shot();
    const left = gap - (Date.now() - t0);
    if (left > 0) await sleep(left);
  }
}

/** Hold a still image for `ms` — cheap, no repeated screenshots. */
async function hold(ms) {
  await shot();
  const src = path.join(OUT, `f${String(frame - 1).padStart(5, '0')}.png`);
  const n = Math.round((ms / 1000) * FPS) - 1;
  for (let i = 0; i < n; i++) {
    fs.copyFileSync(src, path.join(OUT, `f${String(frame++).padStart(5, '0')}.png`));
  }
}

/** Overlay a caption. Burned into the frame so the video needs no editor. */
async function caption(title, sub = '', ms = 2600) {
  await page.evaluate(([t, s]) => {
    let el = document.getElementById('__cap');
    if (!el) {
      el = document.createElement('div');
      el.id = '__cap';
      el.style.cssText = `position:fixed;left:50%;bottom:56px;transform:translateX(-50%);
        z-index:99999;padding:16px 30px;border-radius:12px;text-align:center;
        background:rgba(8,9,11,.9);border:1px solid rgba(255,255,255,.16);
        backdrop-filter:blur(14px);font-family:'Space Grotesk',system-ui,sans-serif;
        max-width:1100px;transition:opacity .25s;`;
      document.body.appendChild(el);
    }
    el.style.opacity = '1';
    el.innerHTML = `<div style="font:600 21px/1.3 inherit;color:#f2efea;letter-spacing:.01em">${t}</div>`
      + (s ? `<div style="font:400 14px/1.5 inherit;color:#b0aca6;margin-top:7px">${s}</div>` : '');
  }, [title, sub]);
  await record(ms);
}

async function clearCaption() {
  await page.evaluate(() => {
    const el = document.getElementById('__cap');
    if (el) el.style.opacity = '0';
  });
}

/** Click a dock tab by its caption text. */
async function tab(name) {
  const ok = await page.evaluate((n) => {
    const b = [...document.querySelectorAll('.rail-btn')]
      .find((x) => (x.getAttribute('title') || '').toLowerCase().includes(n.toLowerCase()));
    if (b) { b.click(); return true; }
    return false;
  }, name);
  if (!ok) console.warn(`  ! tab not found: ${name}`);
  await sleep(700);
  return ok;
}

/** Click the first element matching a selector whose text contains `text`. */
async function clickText(sel, text) {
  const ok = await page.evaluate(([s, t]) => {
    const el = [...document.querySelectorAll(s)]
      .find((x) => (x.textContent || '').toLowerCase().includes(t.toLowerCase()));
    if (el) { el.click(); return true; }
    return false;
  }, [sel, text]);
  if (!ok) console.warn(`  ! not found: ${sel} "${text}"`);
  await sleep(500);
  return ok;
}

// ---------------------------------------------------------------------------

const SCENES = [];
const scene = (n, title, fn) => SCENES.push({ n, title, fn });

scene(1, 'Open on the running system', async () => {
  await caption('AstroMesh — Constraint Awareness: Completion Signal',
    'Every irreversible action passes a gate that answers in four states — and says what it does not know.', 3800);
  await clearCaption();
  await record(1500);
});

scene(2, 'The gate refuses, with a reason', async () => {
  await tab('Risk Monitor');
  await record(1200);
  await caption('A real conjunction, put to the operator vote',
    'Four review profiles poll on it. Then the gate arbitrates — and it is allowed to refuse them all.', 3400);
  await clearCaption();
  await clickText('.conj-row .btn-approve', 'vote');
  await record(3500);
  await caption('REFUSED — and the reasons are named',
    'Non-negotiable rules have no waiver path in the engine. Unanimity cannot override them.', 3800);
  await clearCaption();
});

scene(3, 'One event, every layer', async () => {
  await tab('How this was decided');
  await record(5000);            // corridor draws + camera flies
  await caption('Long March 5B — 4 November 2022', 'The real re-entry that closed European airspace.', 3000);
  await clearCaption();
  await record(2500);
});

scene(4, 'The ground, as a vision model sees it', async () => {
  await page.evaluate(() => {
    const p = document.querySelector('.panel-body');
    if (p) p.scrollTop = 420;
  });
  await record(1500);
  await caption('DINOv3-SAT — 18.2 M sub-cells at 3.4 km',
    'Validated against a population raster the model never saw (Spearman +0.75).', 3400);
  await clearCaption();
  await page.evaluate(() => {
    const p = document.querySelector('.panel-body');
    if (p) p.scrollTop = 900;
  });
  await record(1600);
  await caption('Ec = 1.97e-3 — 19.7× over the legal limit',
    'NASA\'s own 1-D method reports 1.87× lower: it cannot see which longitude the debris is heading for.', 4200);
  await clearCaption();
});

scene(5, 'Ride it down', async () => {
  await clickText('.follow-btn', 'follow');
  await record(11000);           // the chase, at 1x
  await caption('Altitude, flight-path angle, downrange — live',
    'Corridor and parameters: recorded event. Motion: kinematic replay, labelled as such.', 3400);
  await clearCaption();
  await record(4000);
  await clickText('.follow-btn', 'stop');
  await record(2000);
});

scene(6, 'A storm on the Sun, in the rulebook', async () => {
  await tab('Storms');
  await record(1200);
  await clickText('.gc-btn', 'gannon');
  await record(5000);            // zones paint + camera frames the planet
  await caption('Gannon storm — 10 May 2024, Kp 9',
    'Three planet-wide exposure bands. Ground stations 8 → 3. FR-19 uplink and FR-21 atmosphere react.', 4200);
  await clearCaption();
  await record(2000);
  await clickText('.gc-btn', 'live');
  await record(2500);
});

scene(7, 'The same engine, somewhere else entirely', async () => {
  await clickText('.gc-btn', 'prove it');
  await record(2000);
  await caption('Zero engine changes', 'A software release gate and an FAA aircraft-dispatch rulebook run on the identical engine.', 4000);
  await clearCaption();
  await record(1500);
});

scene(8, 'Every pair, on your own GPU', async () => {
  await page.evaluate(() => {
    const t = document.querySelector('.filter-tab');
    if (t) t.click();
  });
  await sleep(900);
  await clickText('.fp-gpu', 'gpu screen');
  await record(9000);
  await caption('WebGPU — the O(N²) sweep, measured live',
    'A coarse filter on real SGP4 states. Candidates are re-screened with full SGP4 — the verdict never comes from this pass.', 4200);
  await clearCaption();
});

scene(9, 'Close', async () => {
  await page.evaluate(() => {
    const t = document.querySelector('.filter-tab');
    if (t) t.click();
  });
  await tab('How this was decided');
  await record(3000);
  await caption('COMPLETE · PARTIAL · BLOCKED · UNRESOLVED',
    'Three of the four states are backed by something outside our own judgement — and two of those are statements about what we cannot do.', 5000);
});

// ---------------------------------------------------------------------------

(async () => {
  const only = process.argv.includes('--scene')
    ? Number(process.argv[process.argv.indexOf('--scene') + 1]) : null;

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: 'new',
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--window-size=1600,900', '--hide-scrollbars',
      '--enable-features=Vulkan', '--force-device-scale-factor=1'],
  });
  page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900 });
  page.on('pageerror', (e) => console.warn('  page error:', String(e).slice(0, 100)));

  console.log('loading…');
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 120000 });
  await sleep(26000);   // boot + fly-in
  console.log('ready.\n');

  for (const s of SCENES) {
    if (only && s.n !== only) continue;
    const t0 = Date.now();
    process.stdout.write(`scene ${s.n}: ${s.title} … `);
    try { await s.fn(); } catch (e) { console.log('FAILED:', e.message); continue; }
    console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s, ${frame} frames total`);
  }

  await browser.close();
  console.log(`\n${frame} frames -> demo/frames/`);
  console.log(`assemble: ffmpeg -y -framerate ${FPS} -i demo/frames/f%05d.png -c:v libx264 -pix_fmt yuv420p -crf 20 -vf scale=1600:900 demo/astromesh.mp4`);
})();
