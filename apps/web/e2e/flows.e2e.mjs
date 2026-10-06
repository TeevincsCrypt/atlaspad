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
  await page.getByRole("button", { name: /Continue/ }).click();
});

await step("wizard: token parameters with live curve preview", async () => {
  await page.getByPlaceholder("0.0").fill("0.01");
  await page.getByText(/of supply\) at the opening price/).waitFor({ timeout: 10000 });
  await shot("01-token-parameters");
  await page.getByRole("button", { name: /Continue/ }).click();
  await page.getByText("Contract permissions").waitFor();
  await page.getByRole("button", { name: /Continue/ }).click();
});

await step("launch: simulate, acknowledge, found", async () => {
  await page.getByText("Estimated network fee").waitFor();
  await page.waitForFunction(() => !document.body.innerText.includes("Simulating…"), null, { timeout: 30000 });
  await page.getByRole("checkbox").check();
  await shot("02-launch-review");
  await page.getByRole("button", { name: new RegExp(`Found ${NAME}`) }).click();
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
});

await step("buy on the bonding curve", async () => {
  const panel = page.locator("aside");
  await panel.getByPlaceholder("0.0").fill("0.005");
  await panel.getByText(/Price impact/).waitFor({ timeout: 20000 });
  await panel.getByRole("button", { name: new RegExp(`Buy \\$${TICKER}`) }).click();
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

console.log(errors.length ? `Page errors:\n${errors.join("\n")}` : "No page errors");
await browser.close();
