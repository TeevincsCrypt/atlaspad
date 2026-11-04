import { describe, expect, it } from "vitest";
import { CHAT_MAX_LENGTH, chatSignInMessage, cleanChatMessage } from "../src/chat";

describe("chat", () => {
  it("cleans messages", () => {
    expect(cleanChatMessage("  gm citizens  ")).toBe("gm citizens");
    expect(cleanChatMessage("a\n\n\n\nb")).toBe("a\n\nb");
    expect(cleanChatMessage("hi‮evil\u0007")).toBe("hievil");
    expect(cleanChatMessage("   ")).toBeNull();
    expect(cleanChatMessage("x".repeat(CHAT_MAX_LENGTH + 1))).toBeNull();
  });
  it("builds a stable sign-in message with a lowercase address", () => {
    expect(chatSignInMessage(4663, "0xABCdef", 5)).toContain("Address: 0xabcdef\nIssued at: 5");
  });
});
