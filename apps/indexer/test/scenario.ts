/**
 * A scripted sequence of REAL transactions against a LOCAL anvil chain (chain id 31337) running the real
 * AtlasPad contracts. Used by the integration test and by `pnpm dev:seed-local` to give local UI development a
 * populated world without fabricating any data. Never point this at a public network.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  http,
  parseEther,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { atlasGovernorAbi, atlasLaunchpadAbi, nationTokenAbi, uniswapV2RouterAbi } from "@atlaspad/shared/abis";
import {
  BuildingType,
  GameAction,
  ProposalKind,
  anvilChain,
  encodeEmblem,
  encodeGameActionPayload,
  encodeSymbolPayload,
  encodeTreasuryPayload,
} from "@atlaspad/shared";

/** Anvil's well-known development keys (public test mnemonic). */
export const ANVIL_KEYS: Hex[] = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
  "0x92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
  "0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356",
  "0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97",
  "0x2a871d0798f97d79848a013d4936a73bf4cc922c825d33c1cf7073dff6d409c6",
];

export interface LocalDeployment {
  chainId: number;
  deployedAtBlock: number;
  launchpad: Address;
  governor: Address;
  treasury: Address;
  uniswapV2Factory: Address;
  uniswapV2Router: Address;
  weth: Address;
}

const contractsDir = resolve(import.meta.dirname, "../../../contracts");

export function deployLocal(rpcUrl: string): LocalDeployment {
  execFileSync(
    "forge",
    ["script", "script/DeployLocal.s.sol", "--rpc-url", rpcUrl, "--broadcast", "--private-key", ANVIL_KEYS[0]!, "--offline"],
    { cwd: contractsDir, stdio: "pipe" },
  );
  return JSON.parse(readFileSync(resolve(contractsDir, "deployments/31337.json"), "utf8")) as LocalDeployment;
}

export async function runScenario(rpcUrl: string, d: LocalDeployment, opts: { log?: (m: string) => void } = {}) {
  const log = opts.log ?? (() => {});
  const transport = http(rpcUrl);
  const pub = createPublicClient({ chain: anvilChain, transport });
  const test = createTestClient({ chain: anvilChain, transport, mode: "anvil" });
  const accounts = ANVIL_KEYS.map((k) => privateKeyToAccount(k));
  const wallet = (i: number) => createWalletClient({ chain: anvilChain, transport, account: accounts[i]! });
  const addr = (i: number) => accounts[i]!.address;
  const now = async () => Number((await pub.getBlock()).timestamp);
  const wait = (hash: Hex) => pub.waitForTransactionReceipt({ hash });
  const advance = async (seconds: number, blocks = 1) => {
    await test.increaseTime({ seconds });
    for (let i = 0; i < blocks; i++) await test.mine({ blocks: 1 });
  };

  const found = async (i: number, name: string, symbol: string, theme: number, glyph: string, colors: [string, string, string], initialBuy: string, founderBps = 0) => {
    const params = {
      name,
      symbol,
      description: `${name} is a nation on the local development Atlas.`,
      metadataURI: "",
      theme,
      emblem: encodeEmblem({ glyph: glyph as never, pattern: "chevron", primary: colors[0], secondary: colors[1], accent: colors[2] }),
      totalSupply: parseEther("1000000000"),
      founderBps,
      minTokensOut: 0n,
    };
    const hash = await wallet(i).writeContract({
      address: d.launchpad,
      abi: atlasLaunchpadAbi,
      functionName: "foundNation",
      args: [params],
      value: parseEther(initialBuy),
    });
    await wait(hash);
    const id = await pub.readContract({ address: d.launchpad, abi: atlasLaunchpadAbi, functionName: "nationCount" });
    log(`Founded ${name} (#${id})`);
    return Number(id);
  };
  const buy = async (i: number, id: number, eth: string) => {
    const hash = await wallet(i).writeContract({
      address: d.launchpad,
      abi: atlasLaunchpadAbi,
      functionName: "buy",
      args: [BigInt(id), 0n, BigInt((await now()) + 600)],
      value: parseEther(eth),
    });
    await wait(hash);
  };
  const tokenOf = async (id: number) =>
    (await pub.readContract({ address: d.launchpad, abi: atlasLaunchpadAbi, functionName: "tokenOf", args: [BigInt(id)] })) as Address;
  const sell = async (i: number, id: number, fraction: number) => {
    const token = await tokenOf(id);
    const bal = await pub.readContract({ address: token, abi: nationTokenAbi, functionName: "balanceOf", args: [addr(i)] });
    const amount = (bal * BigInt(Math.round(fraction * 100))) / 100n;
    if (amount === 0n) return;
    await wait(await wallet(i).writeContract({ address: token, abi: nationTokenAbi, functionName: "approve", args: [d.launchpad, amount] }));
    await wait(
      await wallet(i).writeContract({
        address: d.launchpad,
        abi: atlasLaunchpadAbi,
        functionName: "sell",
        args: [BigInt(id), amount, 0n, BigInt((await now()) + 600)],
      }),
    );
  };
  const propose = async (i: number, id: number, kind: ProposalKind, payload: Hex, description: string) => {
    await wait(
      await wallet(i).writeContract({
        address: d.governor,
        abi: atlasGovernorAbi,
        functionName: "propose",
        args: [BigInt(id), kind, payload, description],
      }),
    );
    return Number(await pub.readContract({ address: d.governor, abi: atlasGovernorAbi, functionName: "proposalCount" }));
  };
  const vote = async (i: number, pid: number, support: number) =>
    wait(await wallet(i).writeContract({ address: d.governor, abi: atlasGovernorAbi, functionName: "castVote", args: [BigInt(pid), support, ""] }));
  const execute = async (pid: number) =>
    wait(await wallet(0).writeContract({ address: d.governor, abi: atlasGovernorAbi, functionName: "execute", args: [BigInt(pid)] }));

  // --- Founding ---------------------------------------------------------------------------------
  const pepe = await found(1, "Pepeland", "PEPE", 5, "frog", ["#3fa34d", "#ffd23f", "#0d1f0f"], "0.03", 300);
  const doge = await found(2, "Dogeland", "DOGE", 5, "dog", ["#c99a2e", "#f4e2b8", "#2a1d08"], "0.02");
  const wif = await found(3, "Wifia", "WIF", 3, "wave", ["#d98bb5", "#2bb3c0", "#1a0f1f"], "0.01");
  const bonk = await found(4, "Bonkistan", "BONK", 1, "bolt", ["#ff7a1a", "#ffe066", "#1f0f00"], "0.005");

  // --- Early trading ----------------------------------------------------------------------------
  for (const [i, id, eth] of [
    [5, pepe, "0.05"], [6, pepe, "0.04"], [7, doge, "0.06"], [8, doge, "0.02"], [5, wif, "0.03"],
    [6, bonk, "0.01"], [7, pepe, "0.03"], [8, wif, "0.02"],
  ] as const) {
    await buy(i, id, eth);
    await advance(300);
  }
  await sell(6, pepe, 0.3);
  await advance(3600);

  // A whale sells out Pepeland's curve → graduation to Uniswap V2.
  await buy(9, pepe, "2.5");
  log("Pepeland graduated");
  await advance(1800);

  // Uniswap trading after graduation
  const pepeToken = await tokenOf(pepe);
  await wait(
    await wallet(5).writeContract({
      address: d.uniswapV2Router,
      abi: uniswapV2RouterAbi,
      functionName: "swapExactETHForTokens",
      args: [0n, [d.weth, pepeToken], addr(5), BigInt((await now()) + 600)],
      value: parseEther("0.2"),
    }),
  );
  const bal9 = await pub.readContract({ address: pepeToken, abi: nationTokenAbi, functionName: "balanceOf", args: [addr(9)] });
  const sellAmt = bal9 / 10n;
  await wait(await wallet(9).writeContract({ address: pepeToken, abi: nationTokenAbi, functionName: "approve", args: [d.uniswapV2Router, sellAmt] }));
  await wait(
    await wallet(9).writeContract({
      address: d.uniswapV2Router,
      abi: uniswapV2RouterAbi,
      functionName: "swapExactTokensForETH",
      args: [sellAmt, 0n, [pepeToken, d.weth], addr(9), BigInt((await now()) + 600)],
    }),
  );
  // Spread citizenship
  for (let i = 0; i < 4; i++) {
    const amount = bal9 / 50n;
    await wait(await wallet(9).writeContract({ address: pepeToken, abi: nationTokenAbi, functionName: "transfer", args: [addr(i), amount] }));
  }
  await advance(3600);

  // --- Governance --------------------------------------------------------------------------------
  const build = await propose(9, pepe, ProposalKind.GameAction, encodeGameActionPayload(GameAction.Build, BigInt(BuildingType.Capitol)), "Build a Capitol\nThe seat of Pepeland's government.");
  const alliance = await propose(7, doge, ProposalKind.GameAction, encodeGameActionPayload(GameAction.CreateAlliance, 0n, "Meme Alliance"), "Found the Meme Alliance");
  const war = await propose(9, pepe, ProposalKind.GameAction, encodeGameActionPayload(GameAction.DeclareWar, BigInt(wif)), "Declare war on Wifia");
  const symbol = await propose(5, wif, ProposalKind.Symbol, encodeSymbolPayload(encodeEmblem({ glyph: "anchor", pattern: "horizontal", primary: "#2bb3c0", secondary: "#ffffff", accent: "#0a2a33" }), ""), "Adopt the anchor");
  const spend = await propose(9, pepe, ProposalKind.Treasury, encodeTreasuryPayload(addr(1), 1_000_000_000_000n), "Fund the space program");
  for (const [i, pid] of [[9, build], [5, build], [7, alliance], [8, alliance], [9, war], [5, symbol], [8, symbol], [9, spend]] as const) {
    await vote(i, pid, 1);
  }
  await vote(6, war, 0);
  // Let a day of epochs pass (hourly blocks) so resources accrue, then enact.
  for (let h = 0; h < 25; h++) {
    await advance(3600);
    if (h % 6 === 0) await buy(5 + (h % 4), [doge, wif, bonk, doge][h % 4]!, "0.005");
  }
  await execute(alliance);
  await execute(symbol);
  await execute(build);
  await execute(war);
  log("Decrees enacted");

  const invite = await propose(7, doge, ProposalKind.GameAction, encodeGameActionPayload(GameAction.InviteToAlliance, BigInt(bonk)), "Invite Bonkistan");
  await vote(7, invite, 1);
  await vote(8, invite, 1);
  for (let h = 0; h < 25; h++) await advance(3600);
  await execute(invite);
  const join = await propose(4, bonk, ProposalKind.GameAction, encodeGameActionPayload(GameAction.JoinAlliance, BigInt(alliance)), "Join the Meme Alliance");
  await vote(4, join, 1);
  await vote(6, join, 1);
  for (let h = 0; h < 25; h++) await advance(3600);
  await execute(join);
  // Treasury proposal: 3-day vote + 1-day timelock
  for (let h = 0; h < 23; h++) await advance(3600);
  await execute(spend);
  await advance(3600);
  log("Scenario complete");
  return { pepe, doge, wif, bonk, proposals: { build, alliance, war, symbol, spend, invite, join } };
}
