import { describe, expect, it, vi } from "vitest";
import { parseWakeArgs, main } from "./wake-leads-agent";

const ORG = "00000000-0000-4000-8000-0000000000aa";
const TASK = "00000000-0000-4000-8000-0000000000cc";

describe("wake-leads-agent", () => {
  it("parses org and enquiry", () => {
    expect(parseWakeArgs([`--org-id=${ORG}`, "--enquiry-id=00000000-0000-4000-8000-0000000000bb"])).toEqual({
      orgId: ORG,
      enquiryId: "00000000-0000-4000-8000-0000000000bb",
    });
  });

  it("parses optional kanban-task-id", () => {
    expect(parseWakeArgs([`--org-id=${ORG}`, `--kanban-task-id=${TASK}`])).toEqual({
      orgId: ORG,
      kanbanTaskId: TASK,
    });
  });

  it("requires org-id", () => {
    expect(() => parseWakeArgs([])).toThrow(/org-id/);
  });

  it("rejects invalid kanban-task-id", () => {
    expect(() => parseWakeArgs([`--org-id=${ORG}`, "--kanban-task-id=bad"])).toThrow(/kanban-task-id/);
  });

  it("no-ops without HERMES_WAKE", async () => {
    const code = await main({}, [`--org-id=${ORG}`]);
    expect(code).toBe(0);
  });

  it("stub wake includes kanban task id when set", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await main({ HERMES_WAKE: "1" }, [`--org-id=${ORG}`, `--kanban-task-id=${TASK}`]);
    expect(code).toBe(0);
    expect(log.mock.calls.flat().join(" ")).toContain(TASK);
    log.mockRestore();
  });
});
