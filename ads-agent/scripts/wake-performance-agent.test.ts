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

  it("cli transport invokes docker hermes chat", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const invokeCli = vi.fn(async () => ({
      ok: true as const,
      status: 0,
      content: "proposalId=94142935-2a48-4c70-97b9-7ced3b5cb4eb pending=true",
    }));
    const invokeApi = vi.fn();
    const code = await main(
      {
        HERMES_WAKE: "1",
        AGENT_INTERNAL_API_KEY: "k",
        PERFORMANCE_ORG_ID: ORG,
        ADS_AGENT_BASE_URL: "http://host.docker.internal:3030",
      },
      [`--org-id=${ORG}`, "--corridor=koramangala"],
      { invokeCli, invokeApi },
    );
    expect(code).toBe(0);
    expect(invokeCli).toHaveBeenCalledOnce();
    expect(invokeApi).not.toHaveBeenCalled();
    expect(invokeCli.mock.calls[0]![0].skill).toBe("performance-review");
    expect(invokeCli.mock.calls[0]![0].passEnv?.AGENT_INTERNAL_API_KEY).toBe("k");
    expect(log.mock.calls.flat().join(" ")).toMatch(/transport=cli/);
    log.mockRestore();
  });

  it("api transport requires Hermes URL/key", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const code = await main(
      { HERMES_WAKE: "1", HERMES_WAKE_TRANSPORT: "api" },
      [`--org-id=${ORG}`],
      { invokeCli: vi.fn(), invokeApi: vi.fn() },
    );
    expect(code).toBe(1);
    expect(err.mock.calls.flat().join(" ")).toMatch(/HERMES_API_SERVER/);
    err.mockRestore();
  });

  it("api transport calls invokeApi", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const invokeApi = vi.fn(async () => ({
      ok: true as const,
      status: 200,
      content: "proposalId=94142935-2a48-4c70-97b9-7ced3b5cb4eb pending=true",
    }));
    const code = await main(
      {
        HERMES_WAKE: "1",
        HERMES_WAKE_TRANSPORT: "api",
        HERMES_API_SERVER_URL: "http://127.0.0.1:8642",
        HERMES_API_SERVER_KEY: "secret",
      },
      [`--org-id=${ORG}`],
      { invokeCli: vi.fn(), invokeApi },
    );
    expect(code).toBe(0);
    expect(invokeApi).toHaveBeenCalledOnce();
    expect(invokeApi.mock.calls[0]![0].profile).toBe("performance");
    log.mockRestore();
  });
});
