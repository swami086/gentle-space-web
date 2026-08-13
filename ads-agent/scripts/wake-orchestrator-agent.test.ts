import { describe, expect, it, vi } from "vitest";
import { main, parseWakeArgs } from "./wake-orchestrator-agent";

const ORG = "00000000-0000-4000-8000-0000000000aa";
const TASK = "00000000-0000-4000-8000-0000000000cc";

describe("wake-orchestrator-agent", () => {
  it("parses org, enquiry, and kanban task", () => {
    expect(
      parseWakeArgs([
        `--org-id=${ORG}`,
        "--enquiry-id=00000000-0000-4000-8000-0000000000bb",
        `--kanban-task-id=${TASK}`,
      ]),
    ).toEqual({
      orgId: ORG,
      enquiryId: "00000000-0000-4000-8000-0000000000bb",
      kanbanTaskId: TASK,
    });
  });

  it("requires org-id", () => {
    expect(() => parseWakeArgs([])).toThrow(/org-id/);
  });

  it("no-ops without HERMES_WAKE", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await main({}, [`--org-id=${ORG}`]);
    expect(code).toBe(0);
    expect(log.mock.calls.flat().join(" ")).toMatch(/not scheduled/i);
    log.mockRestore();
  });

  it("stub wake when HERMES_WAKE=1", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await main(
      { HERMES_WAKE: "1" },
      [`--org-id=${ORG}`, `--kanban-task-id=${TASK}`],
    );
    expect(code).toBe(0);
    const out = log.mock.calls.flat().join(" ");
    expect(out).toMatch(/stub wake/i);
    expect(out).toContain(TASK);
    log.mockRestore();
  });
});
