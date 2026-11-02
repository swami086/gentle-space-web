import { describe, expect, it } from "vitest";
import { parseInboundText } from "./parser";

describe("parseInboundText", () => {
  it("parses a 6-digit code", () => {
    expect(parseInboundText("482910")).toEqual({ type: "code", code: "482910" });
    expect(parseInboundText("  482910  ")).toEqual({ type: "code", code: "482910" });
  });

  it("rejects non-6-digit numeric lines", () => {
    expect(parseInboundText("12345")).toEqual({ type: "unknown" });
    expect(parseInboundText("1234567")).toEqual({ type: "unknown" });
    expect(parseInboundText("12a456")).toEqual({ type: "unknown" });
  });

  it("parses PAUSE exactly", () => {
    expect(parseInboundText("PAUSE")).toEqual({ type: "pause" });
    expect(parseInboundText("pause")).toEqual({ type: "pause" });
    expect(parseInboundText(" Pause ")).toEqual({ type: "pause" });
    expect(parseInboundText("PAUSE SMITH14")).toEqual({ type: "unknown" });
  });

  it("parses STOP exactly", () => {
    expect(parseInboundText("STOP")).toEqual({ type: "stop" });
    expect(parseInboundText("stop")).toEqual({ type: "stop" });
  });

  it("parses RESUME exactly", () => {
    expect(parseInboundText("RESUME")).toEqual({ type: "resume" });
    expect(parseInboundText("resume")).toEqual({ type: "resume" });
  });

  it("parses LEASED exactly", () => {
    expect(parseInboundText("LEASED")).toEqual({ type: "leased" });
    expect(parseInboundText("leased")).toEqual({ type: "leased" });
  });

  it("returns unknown for other text", () => {
    expect(parseInboundText("hello")).toEqual({ type: "unknown" });
    expect(parseInboundText("")).toEqual({ type: "unknown" });
  });
});
