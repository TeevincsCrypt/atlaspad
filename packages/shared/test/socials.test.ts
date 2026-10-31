import { describe, expect, it } from "vitest";
import { normalizeSocials, normalizeTelegram, normalizeWebsite, normalizeX, socialsMessage } from "../src/socials";

describe("social links", () => {
  it("normalises X handles and URLs", () => {
    expect(normalizeX("@atlaspad")).toBe("https://x.com/atlaspad");
    expect(normalizeX("https://twitter.com/atlas_pad/")).toBe("https://x.com/atlas_pad");
    expect(normalizeX("x.com/atlaspad?s=20")).toBe("https://x.com/atlaspad");
    expect(normalizeX("")).toBe("");
    expect(normalizeX("https://evil.com/atlaspad")).toBeNull();
    expect(normalizeX("javascript:alert(1)")).toBeNull();
  });
  it("normalises Telegram", () => {
    expect(normalizeTelegram("@atlaspad")).toBe("https://t.me/atlaspad");
    expect(normalizeTelegram("t.me/atlaspad")).toBe("https://t.me/atlaspad");
    expect(normalizeTelegram("https://t.me/+AbC_123")).toBe("https://t.me/+AbC_123");
    expect(normalizeTelegram("https://t.me.evil.com/x")).toBeNull();
  });
  it("only accepts real http(s) websites", () => {
    expect(normalizeWebsite("atlaswif.xyz")).toBe("https://atlaswif.xyz");
    expect(normalizeWebsite("http://atlaswif.xyz/about")).toBe("https://atlaswif.xyz/about");
    expect(normalizeWebsite("javascript:alert(1)")).toBeNull();
    expect(normalizeWebsite("https://user:pw@atlaswif.xyz")).toBeNull();
    expect(normalizeWebsite("localhost")).toBeNull();
  });
  it("reports the invalid field and builds a stable message", () => {
    expect(normalizeSocials({ x: "bad url!", telegram: "", website: "" })).toEqual({ ok: false, field: "x" });
    const r = normalizeSocials({ x: "@a", telegram: "", website: "a.xyz" });
    expect(r.ok && socialsMessage(4663, 1, r.socials, 100)).toBe(
      "AtlasPad: update nation social links\nChain: 4663\nNation: 1\nX: https://x.com/a\nTelegram: -\nWebsite: https://a.xyz\nIssued at: 100",
    );
  });
});
