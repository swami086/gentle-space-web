import { describe, expect, it, vi } from "vitest";
import { buildKanbanCreateCommand, main, parseSeedArgs } from "./seed-orchestrator-task";

const ORG = "00000000-0000-4000-8000-0000000000aa";
const ENQ = "00000000-0000-4000-8000-0000000000bb";

describe("seed-orchestrator-task", () => {
  it("parses org, enquiry, and idempotency-key", () => {
    expect(
      parseSeedArgs([
        `--org-id=${ORG}`,
        `--enquiry-id=${ENQ}`,
        "--idempotency-key=run-2026-08-13",
      ]),
    ).toEqual({
      orgId: ORG,
      enquiryId: ENQ,
      idempotencyKey: "run-2026-08-13",
    });
  });

  it("parses org and idempotency-key without enquiry", () => {
    expect(parseSeedArgs([`--org-id=${ORG}`, "--idempotency-key=run-1"])).toEqual({
      orgId: ORG,
      idempotencyKey: "run-1",
    });
  });

  it("requires org-id", () => {
    expect(() => parseSeedArgs(["--idempotency-key=run-1"])).toThrow(/org-id/);
  });

  it("requires idempotency-key", () => {
    expect(() => parseSeedArgs([`--org-id=${ORG}`])).toThrow(/idempotency-key/);
  });

  it("rejects invalid enquiry uuid", () => {
    expect(() =>
      parseSeedArgs([`--org-id=${ORG}`, "--enquiry-id=bad", "--idempotency-key=run-1"]),
    ).toThrow(/enquiry-id/);
  });

  it("buildKanbanCreateCommand uses board env default", () => {
    const cmd = buildKanbanCreateCommand(
      { orgId: ORG, enquiryId: ENQ, idempotencyKey: "run-1" },
      {},
    );
    expect(cmd).toContain("hermes kanban create");
    expect(cmd).toContain("--board=gs-agents");
    expect(cmd).toContain(`--tenant=${ORG}`);
    expect(cmd).toContain("--idempotency-key=run-1");
    expect(cmd).toContain(ENQ);
  });

  it("logs intended kanban create without HERMES_WAKE", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await main({}, [`--org-id=${ORG}`, "--idempotency-key=run-1"]);
    expect(code).toBe(0);
    expect(log.mock.calls.flat().join(" ")).toMatch(/hermes kanban create/);
    log.mockRestore();
  });

  it("logs deferred spawn when HERMES_WAKE without bin", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await main(
      { HERMES_WAKE: "1" },
      [`--org-id=${ORG}`, "--idempotency-key=run-1"],
    );
    expect(code).toBe(0);
    expect(log.mock.calls.flat().join(" ")).toMatch(/deferred/i);
    log.mockRestore();
  });

  it("logs spawn command when HERMES_WAKE with bin (stub)", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const code = await main(
      { HERMES_WAKE: "1", HERMES_KANBAN_BIN: "/usr/local/bin/hermes" },
      [`--org-id=${ORG}`, "--idempotency-key=run-1"],
    );
    expect(code).toBe(0);
    const out = log.mock.calls.flat().join(" ");
    expect(out).toContain("/usr/local/bin/hermes");
    expect(out).toMatch(/deferred|would run/i);
    log.mockRestore();
  });
});
