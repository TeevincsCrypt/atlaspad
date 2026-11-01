// node frames.js <film.html> <outdir> <t1,t2,...>   -> PNG per time (preview)
// node frames.js <film.html> - stream <fps> <dur>   -> PNG frames to stdout (for ffmpeg image2pipe)
const { chromium } = require("playwright");
const path = require("path");
(async () => {
  const [file, out, mode, a, b] = process.argv.slice(2);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on("pageerror", (e) => console.error("PAGEERR", e.message));
  await page.goto("file://" + path.resolve(file));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  if (mode === "stream") {
    const fps = +a, n = Math.round(+b * fps);
    for (let i = 0; i < n; i++) {
      await page.evaluate((t) => window.render(t), i / fps);
      process.stdout.write(await page.screenshot({ type: "png" }));
      if (i % 60 === 0) console.error(`frame ${i}/${n}`);
    }
  } else {
    for (const t of mode.split(",").map(Number)) {
      await page.evaluate((t) => window.render(t), t);
      await page.screenshot({ path: path.join(out, `t${t.toFixed(2)}.png`) });
    }
  }
  await browser.close();
})();
