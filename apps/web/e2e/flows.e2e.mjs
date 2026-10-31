/**
 * Browser end-to-end flows against a LOCAL stack: anvil + seeded contracts + indexer + web (see DEPLOYMENT.md
 * "Local end-to-end"). Uses a test wallet bound to anvil account #9.
 *   node apps/web/e2e/flows.e2e.mjs [baseUrl] [screenshotDir]
 */
import { readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const BASE = process.argv[2] ?? "http://localhost:3000";
const OUT = process.argv[3] ?? resolve(here, "screenshots");
mkdirSync(OUT, { recursive: true });
const ACCOUNT = "0xa0Ee7A142d267C1f36714E4a8F75612F20a79720"; // anvil #9
const executablePath = process.env.CHROMIUM_PATH ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const suffix = Date.now().toString(36).slice(-4).toUpperCase();
const NAME = `Testopia ${suffix}`;
const TICKER = `T${suffix}`;
// Uploaded as the nation image when the deployment has image uploads enabled (NEXT_PUBLIC_SUPABASE_URL).
const UPLOAD_IMAGE = resolve(here, "../../../brand/atlaspad-logo-400.png");
let uploaded = false;

const browser = await chromium.launch({ executablePath, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
await page.addInitScript(`window.__E2E_ACCOUNT__ = "${ACCOUNT}";`);
await page.addInitScript(readFileSync(resolve(here, "wallet.js"), "utf8"));
await page.addInitScript(() =>
  localStorage.setItem("atlaspad-ui", JSON.stringify({ state: { introSeen: true, soundOn: false, seenAchievements: [], cinematicsOn: false, mapFilter: "all" }, version: 0 })),
);

const step = async (name, fn) => {
  const t = Date.now();
  try {
    await fn();
    console.log(`✓ ${name} (${Date.now() - t}ms)`);
  } catch (err) {
    await page.screenshot({ path: resolve(OUT, `FAILED-${name.replace(/\W+/g, "-")}.png`) });
    console.error(`✗ ${name}: ${err.message}`);
    await browser.close();
    process.exit(1);
  }
};
const shot = (n) => page.screenshot({ path: resolve(OUT, `${n}.png`) });

await step("open founding wizard", async () => {
  await page.goto(`${BASE}/found`, { waitUntil: "domcontentloaded" });
  await page.getByText("Name your nation").waitFor({ timeout: 60000 });
});

await step("connect wallet (EIP-6963)", async () => {
  await page.getByRole("button", { name: /^Connect$/ }).first().click();
  await page.getByText("E2E Test Wallet").click();
  await page.getByText(ACCOUNT.slice(2, 6), { exact: false }).first().waitFor({ timeout: 20000 });
});

await step("wizard: name + ticker availability", async () => {
  await page.getByPlaceholder("Pepeland", { exact: true }).fill(NAME);
  await page.getByText("This name is available").waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByPlaceholder("PEPE", { exact: true }).fill(TICKER);
  await page.getByText("This ticker is available").waitFor({ timeout: 20000 });
  await page.getByRole("button", { name: /Continue/ }).click();
});

await step("wizard: description, theme, symbol", async () => {
  await page.getByPlaceholder("A swamp republic of frogs and memes.").fill("An end-to-end test nation.");
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByRole("button", { name: /Space/ }).click();
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByText("Design your national symbol").waitFor();
  if (await page.getByRole("button", { name: /Upload an image/ }).isVisible()) {
    await page.locator('input[type="file"]').setInputFiles(UPLOAD_IMAGE);
    await page.locator('svg image[href*="/storage/v1/object/public/emblems/"]').first().waitFor({ timeout: 20000 });
    uploaded = true;
    await shot("00-uploaded-image");
  }
  await page.getByRole("button", { name: /Continue/ }).click();
});

await step("wizard: token parameters with live curve preview", async () => {
  // $WIF amounts. Local deployments graduate at 200,000 WIF (2 market units) and mint 10M WIF per anvil account.
  await page.getByPlaceholder("0.0").fill("1000");
  await page.getByText(/of supply\) at the opening price/).waitFor({ timeout: 10000 });
  await shot("01-token-parameters");
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByText("Contract permissions").waitFor();
  await page.getByRole("button", { name: /Continue/ }).click();
});

await step("launch: approve $WIF, simulate, acknowledge, found", async () => {
  await page.getByText("Estimated network fee").waitFor();
  await page.getByRole("checkbox").check();
  await shot("02-launch-review");
  // The launchpad pulls the burned founding fee + the initial buy in $WIF, so the founder approves it first
  // (skipped when an earlier approval still covers it — the seeded anvil accounts approve the launchpad).
  const approve = page.getByRole("button", { name: /Approve .* WIF/ });
  if (await approve.isVisible()) await approve.click();
  const found = page.getByRole("button", { name: new RegExp(`Found ${NAME}`) });
  await found.waitFor({ timeout: 60000 });
  await page.waitForFunction(() => !document.body.innerText.includes("Simulating…"), null, { timeout: 30000 });
  await page.waitForFunction((n) => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent?.includes(`Found ${n}`));
    return b && !b.disabled;
  }, NAME, { timeout: 30000 });
  await found.click();
  await page.getByText(/Welcome to/i).waitFor({ timeout: 60000 });
  await page.waitForTimeout(1200);
  await shot("03-welcome");
});

let nationUrl = "";
await step("open the new nation (indexed)", async () => {
  await page.getByRole("link", { name: /Visit your nation/ }).click();
  await page.waitForURL(/\/nation\/\d+/);
  nationUrl = page.url();
  await page.getByRole("heading", { name: NAME, exact: false }).waitFor({ timeout: 60000 });
  if (uploaded) await page.locator('svg image[href*="/storage/v1/object/public/emblems/"]').first().waitFor({ timeout: 30000 });
});

await step("approve $WIF for the curve (if needed)", async () => {
  const panel = page.locator("aside");
  await panel.getByPlaceholder("0.0").fill("500");
  await panel.getByText(/Price impact/).waitFor({ timeout: 20000 });
  // The panel re-reads the allowance when clicked, so the dialog decides: approval first, or straight to the buy.
  await panel.getByRole("button", { name: new RegExp(`Approve \\$WIF|Buy \\$${TICKER}`) }).click();
  await page.getByRole("dialog").waitFor();
  if (!(await page.getByRole("dialog").getByText("the AtlasPad launchpad").first().isVisible())) {
    await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
    return;
  }
  await page.getByRole("dialog").getByText("the AtlasPad launchpad").first().waitFor();
  await page.waitForFunction(() => !document.body.innerText.includes("Simulating…"), null, { timeout: 30000 });
  await page.getByRole("dialog").getByRole("button", { name: /Confirm in wallet/ }).click();
  await page.getByRole("dialog").getByText(/Transaction confirmed/i).first().waitFor({ timeout: 60000 });
  await page.getByRole("dialog").getByRole("button", { name: "Done" }).click();
});

await step("buy on the bonding curve with $WIF", async () => {
  const panel = page.locator("aside");
  await panel.getByRole("button", { name: new RegExp(`Buy \\$${TICKER} with \\$WIF`) }).click();
  await page.getByRole("dialog").getByText("$WIF burned by this trade").waitFor();
  await page.getByRole("dialog").getByText("Expected to receive").waitFor();
  await page.waitForFunction(() => !document.body.innerText.includes("Simulating…"), null, { timeout: 30000 });
  await page.getByRole("dialog").getByRole("button", { name: /Confirm in wallet/ }).click();
  await page.getByRole("dialog").getByText(/Transaction confirmed/i).first().waitFor({ timeout: 60000 });
  await shot("04-buy-confirmed");
  await page.getByRole("dialog").getByRole("button", { name: "Done" }).click();
});

await step("sell 50% with a permit signature", async () => {
  const panel = page.locator("aside");
  await panel.getByRole("tab", { name: "Sell" }).click();
  await page.waitForTimeout(1500);
  await panel.getByRole("button", { name: "50%" }).click();
  await panel.getByText(/Price impact/).waitFor({ timeout: 20000 });
  await panel.getByRole("button", { name: new RegExp(`Sell \\$${TICKER}`) }).click();
  await page.getByRole("dialog").getByText(/gasless permit/).waitFor();
  await page.getByRole("dialog").getByRole("button", { name: /Confirm in wallet/ }).click();
  await page.getByRole("dialog").getByText(/Transaction confirmed/i).first().waitFor({ timeout: 60000 });
  await page.getByRole("dialog").getByRole("button", { name: "Done" }).click();
});

await step("propose a Capitol through governance", async () => {
  await page.goto(`${nationUrl}?tab=government`);
  await page.getByText("Open decisions").waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: /New proposal/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Build infrastructure/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: /Review proposal/ }).click();
  await page.getByRole("dialog").getByText("Voting period").waitFor();
  await page.waitForFunction(() => !document.body.innerText.includes("Simulating…"), null, { timeout: 30000 });
  await page.getByRole("dialog").getByRole("button", { name: /Confirm in wallet/ }).click();
  // The dialog closes itself once the receipt confirms; the toast is the confirmation signal.
  await page.getByText("Proposal submitted").waitFor({ timeout: 60000 });
});

await step("proposal appears via the indexer", async () => {
  await page.getByText("Build a Capitol").first().waitFor({ timeout: 60000 });
  await page.getByText("Voting", { exact: true }).first().waitFor({ timeout: 30000 });
  await shot("05-governance");
});

await step("world map shows the new nation", async () => {
  await page.goto(`${BASE}/world`);
  await page.getByPlaceholder("Find a nation or $TICKER").fill(TICKER);
  await page.getByRole("button", { name: new RegExp(NAME) }).first().waitFor({ timeout: 60000 });
  await page.waitForTimeout(3000);
  await shot("06-world");
});

await step("landing page shows the live $WIF flywheel", async () => {
  await page.goto(BASE);
  await page.getByText("Every nation runs on $WIF.").scrollIntoViewIfNeeded({ timeout: 60000 });
  await page.getByText("$WIF burned", { exact: true }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  await shot("07-flywheel");
});

console.log(errors.length ? `Page errors:\n${errors.join("\n")}` : "No page errors");
await browser.close();
