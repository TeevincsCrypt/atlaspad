import { describe, expect, it } from "vitest";
import { ContractFunctionRevertedError, UserRejectedRequestError, encodeErrorResult, type Abi } from "viem";
import { atlasGovernorAbi, atlasLaunchpadAbi, nationTokenAbi, nationTreasuryAbi } from "@atlaspad/shared/abis";
import { CONTRACT_ERRORS, friendlyError } from "@/lib/errors";

const abis = [atlasLaunchpadAbi, atlasGovernorAbi, nationTreasuryAbi, nationTokenAbi] as readonly Abi[];
const abiErrors = new Set(abis.flatMap((abi) => abi.filter((i) => i.type === "error").map((i) => i.name)));

function revert(errorName: string) {
  const abi = abis.find((a) => a.some((i) => i.type === "error" && i.name === errorName))!;
  const data = encodeErrorResult({ abi, errorName });
  return new ContractFunctionRevertedError({ abi, data, functionName: "test" });
}

describe("friendlyError", () => {
  it("only maps errors the deployed contracts can actually raise", () => {
    for (const name of Object.keys(CONTRACT_ERRORS)) expect(abiErrors, name).toContain(name);
  });

  it("explains every launchpad and governor error a user transaction can hit", () => {
    // Constructor checks, inter-contract guards and defensive library errors are unreachable from the UI.
    const internal = new Set(["InvalidConfig", "OnlyGovernor", "ReentrancyGuardReentrantCall", "SafeERC20FailedOperation"]);
    const own = [atlasLaunchpadAbi, atlasGovernorAbi]
      .flatMap((abi) => (abi as Abi).filter((i) => i.type === "error").map((i) => i.name))
      .filter((n) => !internal.has(n));
    for (const name of own) expect(CONTRACT_ERRORS, name).toHaveProperty(name);
  });

  it("translates a contract revert into its explanation", () => {
    const res = friendlyError(revert("Slippage"));
    expect(res.title).toBe("Transaction would fail");
    expect(res.message).toBe(CONTRACT_ERRORS.Slippage);
    expect(res.rejected).toBe(false);
  });

  it("recognises a wallet rejection and says nothing was sent", () => {
    const res = friendlyError(new UserRejectedRequestError(new Error("User rejected the request.")));
    expect(res.rejected).toBe(true);
    expect(res.message).toMatch(/Nothing was sent/);
  });

  it("falls back to a generic message for unknown failures", () => {
    const res = friendlyError(new Error("boom"));
    expect(res.title).toBe("Something went wrong");
    expect(res.technical).toBe("boom");
  });
});
