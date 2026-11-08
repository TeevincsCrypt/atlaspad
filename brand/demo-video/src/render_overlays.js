// node render_overlays.js <dir with overlays.html + overlay_jobs.json>  -> <dir>/ov/<id>.png (transparent)
const { chromium } = require("playwright");
const fs = require("fs"), path = require("path");
(async () => {
  const dir = path.resolve(process.argv[2]);
  const jobs = JSON.parse(fs.readFileSync(path.join(dir, "overlay_jobs.json"), "utf8"));
  fs.mkdirSync(path.join(dir, "ov"), { recursive: true });
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await p.goto("file://" + path.join(dir, "overlays.html"));
  await p.evaluate(() => document.fonts.ready);
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\$WIF/g, "<b>$WIF</b>").replace(/atlaswif\.xyz/g, "<b>atlaswif.xyz</b>");
  for (const j of jobs) {
    const html =
      j.kind === "bg" ? await p.evaluate(() => document.getElementById("tpl-bg").innerHTML) :
      j.kind === "frame" ? await p.evaluate(() => document.getElementById("tpl-frame").innerHTML) :
      j.kind === "header" ? `<div class="header" id="el"><span class="num">${j.num}</span><span class="t">${esc(j.title)}</span><span class="of">/ ${j.of}</span></div>` :
      `<div class="cap" id="el">${esc(j.text)}</div>`;
    await p.evaluate((h) => (document.getElementById("stage").innerHTML = h), html);
    await p.evaluate(() => document.fonts.ready);
    const el = await p.$(j.kind === "bg" ? "#bg" : j.kind === "frame" ? "#frame" : "#el");
    await el.screenshot({ path: path.join(dir, "ov", j.id + ".png"), omitBackground: j.kind !== "bg" });
  }
  await b.close();
  console.log("rendered", jobs.length);
})();
