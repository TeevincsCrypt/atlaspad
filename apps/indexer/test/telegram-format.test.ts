import { describe, expect, it } from "vitest";
import { esc, findNation, parseCommand } from "../src/telegram/format";
import type { NationSummary } from "@atlaspad/shared";

describe("telegram bot formatting", () => {
  it("parses commands, with or without the bot's name", () => {
    expect(parseCommand("/top")).toEqual({ cmd: "top", arg: "" });
    expect(parseCommand("/nation@AtlasPadBot $PEPE")).toEqual({ cmd: "nation", arg: "$PEPE" });
    expect(parseCommand("hello /top")).toBeNull();
  });
  it("escapes HTML", () => {
    expect(esc("<b>&</b>")).toBe("&lt;b&gt;&amp;&lt;/b&gt;");
  });
  it("finds nations by ticker, name or partial name", () => {
    const ns = [
      { id: 1, name: "Pepeland", ticker: "PEPE" },
      { id: 2, name: "Dogeland", ticker: "DOGE" },
    ] as NationSummary[];
    expect(findNation(ns, "$doge")?.id).toBe(2);
    expect(findNation(ns, "pepeland")?.id).toBe(1);
    expect(findNation(ns, "doge")?.id).toBe(2);
    expect(findNation(ns, "pepel")?.id).toBe(1);
    expect(findNation(ns, "zzz")).toBeNull();
  });
});
