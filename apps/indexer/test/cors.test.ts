import { describe, expect, it } from "vitest";
import { corsResolver } from "../src/realtime/server";

describe("INDEXER_CORS_ORIGIN", () => {
  it("allows any origin with *", () => {
    expect(corsResolver("*")("https://x.example")).toBe("*");
    expect(corsResolver("")("https://x.example")).toBe("*");
  });
  it("echoes listed origins, including www variants, and nothing else", () => {
    const allow = corsResolver("https://atlaswif.xyz, https://useatlaspad.vercel.app/");
    expect(allow("https://atlaswif.xyz")).toBe("https://atlaswif.xyz");
    expect(allow("https://www.atlaswif.xyz")).toBe("https://www.atlaswif.xyz");
    expect(allow("https://useatlaspad.vercel.app")).toBe("https://useatlaspad.vercel.app");
    expect(allow("https://evil.example")).toBe("https://atlaswif.xyz");
    expect(allow(undefined)).toBe("https://atlaswif.xyz");
  });
});
