import { describe, expect, it, vi } from "vitest";
import { parseWakeArgs, main } from "./wake-campaign-agent";

const ORG = "00000000-0000-4000-8000-0000000000aa";

describe("wake-campaign-agent", () => {
  it("parses org and corridor", () => {
    expect(parseWakeArgs([`--org-id=${ORG}`, "--corridor=whitefield"])).toEqual({
      orgId: ORG,
      corridor: "whitefield",
    });
  });

  it("parses org only", () => {
    expect(parseWakeArgs([`--org-id=${ORG}`])).toEqual({ orgId: ORG });
  });

  it("requires org-id", () => {
    expect(() => parseWakeArgs([])).toThrow(/org-id/);
  });

  it("rejects empty corridor", () => {
    expect(() => parseWakeArgs([`--org-id=${ORG}`, "--corridor="])).toThrow(/corridor/);
  });

  it("no-ops without HERMES_WAKE", async () => {
    const code = await main({}, [`--org-id=${ORG}`]);
    expect(code).toBe(0);
  });

  it("stub wake includes corridor when set", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await main(
      { HERMES_WAKE: "1" },
      [`--org-id=${ORG}`, "--corridor=koramangala"],
    );
    expect(code).toBe(0);
    expect(log.mock.calls.flat().join(" ")).toContain("koramangala");
    log.mockRestore();
  });
});
