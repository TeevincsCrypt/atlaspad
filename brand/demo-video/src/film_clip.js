// node film_clip.js <film.html> <start> <end> <speed> -> PNG frames (30 fps of output time) on stdout
const { chromium } = require("playwright");
const path = require("path");
(async () => {
  const [file, a, b, sp] = process.argv.slice(2);
  const start = +a, end = +b, speed = +sp;
  const br = await chromium.launch();
  const p = await br.newPage({ viewport: { width: 1920, height: 1080 } });
  await p.goto("file://" + path.resolve(file));
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(400);
  const n = Math.round(((end - start) / speed) * 30);
  for (let i = 0; i < n; i++) {
    await p.evaluate((t) => window.render(t), start + (i / 30) * speed);
    process.stdout.write(await p.screenshot({ type: "png" }));
  }
  await br.close();
})();
