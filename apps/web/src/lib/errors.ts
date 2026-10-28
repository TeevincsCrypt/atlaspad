import { BaseError, ContractFunctionRevertedError, UserRejectedRequestError } from "viem";

/** Contract custom errors → plain-language explanations. */
export const CONTRACT_ERRORS: Record<string, string> = {
  InvalidName: "That nation name isn't allowed. Use 2–32 letters, numbers, spaces, dots, dashes or apostrophes.",
  InvalidSymbol: "Tickers must be 2–10 characters using A–Z and 0–9.",
  InvalidTheme: "Choose one of the eight themes.",
  InvalidSupply: "Total supply must be a whole number of tokens between 1 million and 1 trillion.",
  InvalidFounderBps: "The founder allocation can be at most 5%.",
  TextTooLong: "Some text is too long.",
  NameTaken: "Another nation already uses that name.",
  SymbolTaken: "Another nation already uses that ticker.",
  InitialBuyTooLarge: "The founding purchase would exceed 10% of supply. Lower the initial buy.",
  UnknownNation: "This nation does not exist on-chain.",
  NationGraduatedAlready: "This nation now trades on Uniswap. Refresh to trade through the pool.",
  ZeroAmount: "Enter an amount greater than zero.",
  Slippage: "The price moved beyond your slippage tolerance. Nothing was traded — review the new quote and try again.",
  Expired: "The transaction deadline passed before it was mined. Nothing was traded.",
  InsufficientCurveLiquidity: "The bonding curve can't buy back that many tokens.",
  UnsupportedToken: "The $WIF transfer delivered a different amount than requested.",
  NothingToClaim: "There is nothing to claim yet.",
  NotFounder: "Only the founder can do this.",
  NotGraduated: "Founder tokens unlock once the nation graduates to Uniswap.",
  BelowProposalThreshold: "You need at least 0.1% of this nation's voting power (at the previous second) to propose.",
  InvalidPayload: "This proposal isn't valid under the governance rules.",
  NotActive: "Voting on this proposal is closed.",
  AlreadyVoted: "You already voted on this proposal.",
  InvalidSupport: "Invalid vote option.",
  NoVotingPower: "You had no voting power at this proposal's snapshot.",
  NotExecutable: "This proposal can't be executed right now.",
  NotProposer: "Only the proposer can cancel.",
  ExceedsReleaseCap: "A nation can release at most 25% of its treasury per 7-day window.",
  PoolLockedUntilGraduation: "Tokens can't be sent to the Uniswap pool before graduation.",
  UnknownProposal: "This proposal does not exist on-chain.",
  InvalidRecipient: "The treasury can't send $WIF to that recipient.",
  ERC20InsufficientBalance: "You don't hold enough tokens for this amount.",
  ERC20InsufficientAllowance: "The token allowance is too low for this amount. Approve it again, then retry.",
  ERC2612ExpiredSignature: "The permit signature expired before the transaction was mined. Nothing was traded.",
  ERC2612InvalidSigner: "The permit signature doesn't match your wallet. Nothing was traded.",
};

export interface FriendlyError {
  title: string;
  message: string;
  rejected: boolean;
  technical: string;
}

const TOKEN_ERROR_SELECTORS: Record<string, string> = {
  "0xfb8f41b2": "ERC20InsufficientAllowance",
  "0xe450d38c": "ERC20InsufficientBalance",
};

export function friendlyError(err: unknown): FriendlyError {
  const technical = err instanceof BaseError ? err.shortMessage : String((err as Error)?.message ?? err);
  if (err instanceof BaseError) {
    const rejected = err.walk((e) => e instanceof UserRejectedRequestError);
    if (rejected) return { title: "Request rejected", message: "You declined the request in your wallet. Nothing was sent.", rejected: true, technical };
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError) {
      // Errors raised by the $WIF token itself are not in the launchpad's ABI; match them by selector.
      const name = revert.data?.errorName ?? (revert.signature ? (TOKEN_ERROR_SELECTORS[revert.signature] ?? "") : "");
      const msg = CONTRACT_ERRORS[name] ?? (revert.reason ? `The contract rejected the transaction: ${revert.reason}` : null);
      if (msg) return { title: "Transaction would fail", message: msg, rejected: false, technical };
    }
    const lower = technical.toLowerCase();
    if (lower.includes("insufficient funds")) {
      return { title: "Insufficient ETH for gas", message: "Trades are paid in $WIF, but Robinhood Chain gas is paid in ETH. Add a little ETH to your wallet.", rejected: false, technical };
    }
    if (lower.includes("chain") && lower.includes("mismatch")) {
      return { title: "Wrong network", message: "Switch your wallet to the correct network and try again.", rejected: false, technical };
    }
    if (lower.includes("nonce")) {
      return { title: "Wallet out of sync", message: "Your wallet's transaction nonce is out of sync. Reset it or wait for pending transactions.", rejected: false, technical };
    }
  }
  return { title: "Something went wrong", message: "The request didn't go through. Check your wallet and try again.", rejected: false, technical };
}
