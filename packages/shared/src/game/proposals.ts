import { decodeAbiParameters, encodeAbiParameters, type Hex } from "viem";
import { BUILDINGS, GameAction, ProposalKind } from "./constants";

export type DecodedPayload =
  | { kind: ProposalKind.Treasury; recipient: string; amountWei: string }
  | { kind: ProposalKind.Symbol; emblem: string; metadataUri: string }
  | { kind: ProposalKind.GameAction; action: GameAction; arg: string; text: string }
  | { kind: -1 };

/** Decode an AtlasGovernor proposal payload. Unknown or malformed payloads decode to `{ kind: -1 }`. */
export function decodePayload(kind: number, payload: Hex): DecodedPayload {
  try {
    if (kind === ProposalKind.Treasury) {
      const [recipient, amount] = decodeAbiParameters([{ type: "address" }, { type: "uint256" }], payload);
      return { kind, recipient, amountWei: amount.toString() };
    }
    if (kind === ProposalKind.Symbol) {
      const [emblem, uri] = decodeAbiParameters([{ type: "uint256" }, { type: "string" }], payload);
      return { kind, emblem: emblem.toString(), metadataUri: uri };
    }
    if (kind === ProposalKind.GameAction) {
      const [action, arg, text] = decodeAbiParameters([{ type: "uint8" }, { type: "uint256" }, { type: "string" }], payload);
      return { kind, action: action as GameAction, arg: arg.toString(), text };
    }
  } catch {
    /* fallthrough */
  }
  return { kind: -1 };
}

export function encodeTreasuryPayload(recipient: Hex, amountWei: bigint): Hex {
  return encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [recipient, amountWei]);
}

export function encodeSymbolPayload(emblem: bigint, metadataUri: string): Hex {
  return encodeAbiParameters([{ type: "uint256" }, { type: "string" }], [emblem, metadataUri]);
}

export function encodeGameActionPayload(action: GameAction, arg: bigint, text = ""): Hex {
  return encodeAbiParameters([{ type: "uint8" }, { type: "uint256" }, { type: "string" }], [action, arg, text]);
}

/** Short human description of a decoded proposal action. `nationName` resolves nation ids. */
export function describeAction(d: DecodedPayload, nationName: (id: number) => string = (id) => `Nation #${id}`): string {
  switch (d.kind) {
    case ProposalKind.Treasury:
      return `Treasury transfer to ${d.recipient.slice(0, 6)}…${d.recipient.slice(-4)}`;
    case ProposalKind.Symbol:
      return "Change national symbol";
    case ProposalKind.GameAction:
      switch (d.action) {
        case GameAction.Build:
          return `Build a ${BUILDINGS[Number(d.arg)]?.name ?? "building"}`;
        case GameAction.DeclareWar:
          return `Declare war on ${nationName(Number(d.arg))}`;
        case GameAction.CreateAlliance:
          return `Found the alliance “${d.text}”`;
        case GameAction.InviteToAlliance:
          return `Invite ${nationName(Number(d.arg))} to our alliance`;
        case GameAction.JoinAlliance:
          return `Join alliance #${d.arg}`;
        case GameAction.LeaveAlliance:
          return `Leave alliance #${d.arg}`;
        default:
          return "Unknown action";
      }
    default:
      return "Unknown proposal";
  }
}
