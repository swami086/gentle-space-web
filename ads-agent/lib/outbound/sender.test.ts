import { describe, expect, it } from "vitest";
import { renderOutbound } from "./sender";

describe("renderOutbound", () => {
  it("uses WhatsApp for India", () => {
    expect(
      renderOutbound({
        market: "IN",
        kind: "approval",
        handle: "SMITH14",
        code: "482193",
        ceilingMinor: 600_000,
      }),
    ).toEqual({
      channel: "whatsapp",
      body: expect.stringContaining("482193"),
    });
  });

  it("uses SMS for Australia", () => {
    expect(
      renderOutbound({
        market: "AU",
        kind: "approval",
        handle: "JONES22",
        code: "991022",
        ceilingMinor: 240_000,
      }),
    ).toEqual({
      channel: "sms",
      body: expect.stringContaining("991022"),
    });
  });

  it("includes the ceiling minor amount in a move body", () => {
    const ceilingMinor = 600_000;
    const { body } = renderOutbound({
      market: "IN",
      kind: "move",
      handle: "SMITH14",
      ceilingMinor,
      oldShares: [200_000, 200_000, 200_000],
      newShares: [100_000, 250_000, 250_000],
    });
    expect(body).toContain(String(ceilingMinor));
    expect(body).not.toMatch(/\?/);
    expect(body).toMatch(/Old: 200000, 200000, 200000/);
    expect(body).toMatch(/New: 100000, 250000, 250000/);
  });
});
