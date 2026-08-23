// Can headless Chrome render the Cesium globe? Everything else depends on it.
const puppeteer = require('../frontend/node_modules/puppeteer-core');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: 'new',
    args: [
      '--no-sandbox',
      // Software GL: headless has no real GPU, and SwiftShader renders WebGL
      // correctly if slowly. Without this Cesium silently gets no context.
      '--use-gl=angle', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--window-size=1600,900',
      '--hide-scrollbars',
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900, deviceScaleFactor: 1 });
  const errs = [];
  page.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
  page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)); });

  await page.goto('http://localhost:5177/', { waitUntil: 'networkidle2', timeout: 90000 });
  await new Promise((r) => setTimeout(r, 25000));   // let the globe boot + fly in

  const info = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return { canvas: false };
    const gl = c.getContext('webgl2') || c.getContext('webgl');
    // sample the middle of the canvas: is anything actually drawn?
    const px = new Uint8Array(4);
    let nonBlack = 0;
    if (gl) {
      for (const [x, y] of [[800, 450], [1000, 400], [900, 500], [700, 500]]) {
        gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        if (px[0] + px[1] + px[2] > 40) nonBlack++;
      }
    }
    return {
      canvas: true, w: c.width, h: c.height,
      gl: !!gl, renderer: gl ? gl.getParameter(gl.RENDERER) : null,
      litPixels: nonBlack,
      dockTabs: document.querySelectorAll('.rail-btn').length,
    };
  });
  console.log(JSON.stringify(info, null, 1));
  console.log('errors:', errs.slice(0, 4));
  await page.screenshot({ path: 'demo/probe.png' });
  await browser.close();
})();
