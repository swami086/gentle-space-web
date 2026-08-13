import { describe, expect, it } from "vitest";
import type { GenerativeGroundingPack } from "./grounding-pack";
import {
  assertCitationsAllowed,
  extractClaimIdsFromOpenUi,
} from "./citation-gate";

const PACK: GenerativeGroundingPack = {
  entity: "proposal",
  id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  builtAt: "2026-08-13T00:00:00.000Z",
  rowIds: [
    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  ],
  facts: {},
};

describe("assertCitationsAllowed", () => {
  it("allows empty citations", () => {
    expect(() => assertCitationsAllowed(PACK, [])).not.toThrow();
  });

  it("allows ids in pack.rowIds", () => {
    expect(() =>
      assertCitationsAllowed(PACK, [
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      ]),
    ).not.toThrow();
  });

  it("throws citation_not_in_pack for a foreign id", () => {
    expect(() =>
      assertCitationsAllowed(PACK, ["cccccccc-cccc-cccc-cccc-cccccccccccc"]),
    ).toThrow("citation_not_in_pack");
  });

  it("strips smuggle chars before checking pack membership", () => {
    expect(() =>
      assertCitationsAllowed(PACK, [
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\u200B",
      ]),
    ).not.toThrow();
  });
});

describe("extractClaimIdsFromOpenUi", () => {
  it("extracts cite(\"uuid\") references", () => {
    const lang = `WhyCard(body="Because CPL rose", citationIds([]), followUps([]))
cite("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")`;
    expect(extractClaimIdsFromOpenUi(lang)).toEqual([
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    ]);
  });

  it("extracts citationIds([...]) arrays", () => {
    const lang = `CallPrepCard(points=[
  { text: "Budget headroom", citationIds: ["bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"] },
  { text: "Corridor fit", citationIds: ['aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'] },
])`;
    expect(extractClaimIdsFromOpenUi(lang)).toEqual([
      "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    ]);
  });

  it("extracts both cite() and citationIds() in one Lang string", () => {
    const lang = `WhyCard(body="x", citationIds(["id-a", "id-b"]), followUps([]))
cite("id-c")`;
    expect(extractClaimIdsFromOpenUi(lang)).toEqual(["id-a", "id-b", "id-c"]);
  });

  it("strips smuggle chars from extracted ids", () => {
    const lang = `cite("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa\u200B")`;
    expect(extractClaimIdsFromOpenUi(lang)).toEqual([
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    ]);
  });
});
