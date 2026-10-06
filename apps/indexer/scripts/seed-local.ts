/**
 * LOCAL DEVELOPMENT ONLY. Deploys AtlasPad to a running anvil (chain 31337) and executes a scripted set of real
 * transactions so the UI has a living world to render. Writes env files for the indexer and web app.
 *   anvil --timestamp 1790000000 &
 *   pnpm --filter @atlaspad/indexer seed:local
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPublicClient, createTestClient, createWalletClient, http, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { atlasLaunchpadAbi } from "@atlaspad/shared/abis";
import { anvilChain, encodeEmblem, GLYPHS, PATTERNS } from "@atlaspad/shared";
import { ANVIL_KEYS, deployLocal, runScenario } from "../test/scenario";

const RPC = process.env.LOCAL_RPC_URL ?? "http://127.0.0.1:8545";
const client = createPublicClient({ chain: anvilChain, transport: http(RPC) });
const chainId = await client.getChainId();
if (chainId !== 31337) throw new Error(`Refusing to seed chain ${chainId}: seed-local only runs against anvil (31337).`);

const d = deployLocal(RPC);
console.log("Deployed", d);
await runScenario(RPC, d, { log: (m) => console.log("·", m) });

// A few more nations with organic-looking (but real, on-chain) activity.
const test = createTestClient({ chain: anvilChain, transport: http(RPC), mode: "anvil" });
const wallet = (i: number) => createWalletClient({ chain: anvilChain, transport: http(RPC), account: privateKeyToAccount(ANVIL_KEYS[i]!) });
const extra = [
  ["Shibnation", "SHIB", 5, "#ff9f1c"], ["Catopia", "MEOW", 7, "#b388ff"], ["Neuralis", "NRAL", 6, "#3ddcff"],
  ["Aurelia", "AUR", 0, "#e8c47a"], ["Coralis", "CRL", 3, "#2ec4b6"], ["Ironhold", "IRON", 0, "#9aa5b1"],
  ["Starfall", "STAR", 2, "#8ab4ff"], ["Verdania", "VERD", 4, "#57cc99"],
] as const;
for (const [k, [name, symbol, theme, color]] of extra.entries()) {
  const founder = 1 + (k % 9);
  const hash = await wallet(founder).writeContract({
    address: d.launchpad,
    abi: atlasLaunchpadAbi,
    functionName: "foundNation",
    args: [{
      name, symbol, description: `${name} — a local development nation.`, metadataURI: "", theme,
      emblem: encodeEmblem({ glyph: GLYPHS[(k * 5) % GLYPHS.length]!, pattern: PATTERNS[k % PATTERNS.length]!, primary: color, secondary: "#f4f1e8", accent: "#141820" }),
      totalSupply: parseEther("1000000000"), founderBps: k % 3 === 0 ? 200 : 0, minTokensOut: 0n,
    }],
    value: parseEther((0.002 + k * 0.003).toFixed(4)),
  });
  await client.waitForTransactionReceipt({ hash });
  const id = await client.readContract({ address: d.launchpad, abi: atlasLaunchpadAbi, functionName: "nationCount" });
  for (let j = 0; j < 3 + k; j++) {
    const buyer = (k + j * 3) % 10;
    const ts = Number((await client.getBlock()).timestamp);
    const tx = await wallet(buyer).writeContract({
      address: d.launchpad, abi: atlasLaunchpadAbi, functionName: "buy",
      args: [id, 0n, BigInt(ts + 600)], value: parseEther((0.003 + ((j * 7 + k) % 5) * 0.004).toFixed(4)),
    });
    await client.waitForTransactionReceipt({ hash: tx });
    await test.increaseTime({ seconds: 900 });
    await test.mine({ blocks: 1 });
  }
  console.log("· Founded", name);
}
for (let h = 0; h < 3; h++) {
  await test.increaseTime({ seconds: 3600 });
  await test.mine({ blocks: 1 });
}
// Bring the chain clock up to wall time so countdowns and proposal windows read naturally in the UI.
const chainTs = Number((await client.getBlock()).timestamp);
const wallTs = Math.floor(Date.now() / 1000);
if (chainTs < wallTs) {
  await test.setNextBlockTimestamp({ timestamp: BigInt(wallTs) });
  await test.mine({ blocks: 1 });
}

const root = resolve(import.meta.dirname, "../../..");
const common = {
  ATLAS_NETWORK: "local",
  ATLAS_RPC_URL: RPC,
  ATLAS_LAUNCHPAD: d.launchpad,
  ATLAS_GOVERNOR: d.governor,
  ATLAS_TREASURY: d.treasury,
  ATLAS_DEPLOY_BLOCK: String(d.deployedAtBlock),
  ATLAS_UNISWAP_V2_FACTORY: d.uniswapV2Factory,
  ATLAS_UNISWAP_V2_ROUTER: d.uniswapV2Router,
  ATLAS_WETH: d.weth,
};
const toEnv = (o: Record<string, string>) => Object.entries(o).map(([k, v]) => `${k}=${v}`).join("\n") + "\n";
writeFileSync(
  resolve(root, "apps/indexer/.env.local"),
  toEnv({ ...common, DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://atlas:atlas@localhost:5432/atlaspad", INDEXER_CONFIRMATIONS: "0", INDEXER_CORS_ORIGIN: "*" }),
);
writeFileSync(
  resolve(root, "apps/web/.env.local"),
  toEnv({
    ...Object.fromEntries(Object.entries(common).filter(([k]) => k !== "ATLAS_RPC_URL").map(([k, v]) => [`NEXT_PUBLIC_${k}`, v])),
    NEXT_PUBLIC_RPC_URL: RPC,
    NEXT_PUBLIC_REALTIME_URL: "http://127.0.0.1:4100",
    DATABASE_URL: process.env.DATABASE_URL ?? "postgresql://atlas:atlas@localhost:5432/atlaspad",
  }),
);
console.log("Wrote apps/indexer/.env.local and apps/web/.env.local (local anvil configuration)");

