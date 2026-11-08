// node frames.js <demo.html> <outdir> <t1,t2,...>  |  node frames.js <demo.html> - stream <fps> <duration>
const { chromium } = require("playwright");
const path = require("path");
(async () => {
  const [file, out, mode, a, b] = process.argv.slice(2);
  const br = await chromium.launch({ args: ["--allow-file-access-from-files"] });
  const p = await br.newPage({ viewport: { width: 1920, height: 1080 } });
  p.on("pageerror", (e) => console.error("PAGEERR", e.message));
  await p.goto("file://" + path.resolve(file));
  await p.evaluate(() => document.fonts.ready);
  await p.waitForTimeout(500);
  if (mode === "stream") {
    const fps = +a, n = Math.round(+b * fps);
    for (let i = 0; i < n; i++) {
      await p.evaluate((t) => window.render(t), i / fps);
      process.stdout.write(await p.screenshot({ type: "png" }));
      if (i % 150 === 0) console.error(`frame ${i}/${n}`);
    }
  } else {
    for (const t of mode.split(",").map(Number)) {
      await p.evaluate((t) => window.render(t), t);
      await p.screenshot({ path: path.join(out, `t${t.toFixed(2)}.png`) });
    }
  }
  await br.close();
})();
