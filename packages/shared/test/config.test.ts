import { describe, expect, it } from "vitest";
import { ConfigError, resolveNetwork } from "../src/config";

const A = "0x1111111111111111111111111111111111111111";
const B = "0x2222222222222222222222222222222222222222";
const C = "0x3333333333333333333333333333333333333333";

describe("resolveNetwork", () => {
  it("defaults to Robinhood Chain with on-chain actions disabled until contracts are configured", () => {
    const cfg = resolveNetwork({});
    expect(cfg.chain.id).toBe(4663);
    expect(cfg.contracts).toBeNull();
    expect(cfg.rpcUrl).toBe("https://rpc.mainnet.chain.robinhood.com");
  });

  it("treats empty values as unset", () => {
    const cfg = resolveNetwork({ network: "", rpcUrl: "", launchpad: "", governor: "", treasury: "", deployBlock: "" });
    expect(cfg.key).toBe("robinhood");
    expect(cfg.deployBlock).toBe(0n);
  });

  it("accepts a complete deployment", () => {
    const cfg = resolveNetwork({ launchpad: A, governor: B, treasury: C, deployBlock: "123" });
    expect(cfg.contracts).toEqual({ launchpad: A, governor: B, treasury: C });
    expect(cfg.deployBlock).toBe(123n);
  });

  it("rejects a partial deployment instead of silently disabling the app", () => {
    expect(() => resolveNetwork({ launchpad: A, governor: B })).toThrow(ConfigError);
  });

  it("rejects invalid addresses, block numbers and networks", () => {
    expect(() => resolveNetwork({ launchpad: "0x123", governor: B, treasury: C })).toThrow(ConfigError);
    expect(() => resolveNetwork({ launchpad: A, governor: B, treasury: C, deployBlock: "12abc" })).toThrow(ConfigError);
    expect(() => resolveNetwork({ network: "mainnet" })).toThrow(ConfigError);
  });

  it("requires local DEX addresses on the local network", () => {
    expect(() => resolveNetwork({ network: "local" })).toThrow(ConfigError);
  });
});
