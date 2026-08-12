import { describe, expect, it } from "vitest";
import { parseWakeArgs, main } from "./wake-leads-agent";

const ORG = "00000000-0000-4000-8000-0000000000aa";

describe("wake-leads-agent", () => {
  it("parses org and enquiry", () => {
    expect(parseWakeArgs([`--org-id=${ORG}`, "--enquiry-id=00000000-0000-4000-8000-0000000000bb"])).toEqual({
      orgId: ORG,
      enquiryId: "00000000-0000-4000-8000-0000000000bb",
    });
  });

  it("requires org-id", () => {
    expect(() => parseWakeArgs([])).toThrow(/org-id/);
  });

  it("no-ops without HERMES_WAKE", async () => {
    const code = await main({}, [`--org-id=${ORG}`]);
    expect(code).toBe(0);
  });
});
