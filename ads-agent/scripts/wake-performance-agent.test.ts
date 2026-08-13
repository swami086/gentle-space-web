import { describe, expect, it, vi } from "vitest";
import { main, parseWakeArgs } from "./wake-performance-agent";

const ORG = "00000000-0000-4000-8000-0000000000aa";

describe("wake-performance-agent", () => {
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

  it("rejects invalid org-id", () => {
    expect(() => parseWakeArgs(["--org-id=bad"])).toThrow(/org-id/);
  });

  it("no-ops without HERMES_WAKE", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await main({}, [`--org-id=${ORG}`]);
    expect(code).toBe(0);
    expect(log.mock.calls.flat().join(" ")).toMatch(/not scheduled/i);
    log.mockRestore();
  });

  it("stub wake includes corridor when set", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await main(
      { HERMES_WAKE: "1" },
      [`--org-id=${ORG}`, "--corridor=koramangala"],
    );
    expect(code).toBe(0);
    const out = log.mock.calls.flat().join(" ");
    expect(out).toMatch(/stub wake/i);
    expect(out).toContain("koramangala");
    log.mockRestore();
  });
});
