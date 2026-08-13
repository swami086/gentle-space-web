import { describe, expect, it, vi } from "vitest";
import { main, parseWakeArgs } from "./wake-campaign-agent";

const ORG = "00000000-0000-4000-8000-0000000000aa";

describe("wake-campaign-agent", () => {
  it("parses org and corridor", () => {
    expect(parseWakeArgs([`--org-id=${ORG}`, "--corridor=whitefield"])).toEqual({
      orgId: ORG,
      corridor: "whitefield",
    });
  });

  it("rejects empty corridor", () => {
    expect(() => parseWakeArgs([`--org-id=${ORG}`, "--corridor="])).toThrow(/corridor/);
  });

  it("no-ops without HERMES_WAKE", async () => {
    const code = await main({}, [`--org-id=${ORG}`]);
    expect(code).toBe(0);
  });

  it("cli transport invokes campaign-draft skill", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const invokeCli = vi.fn(async () => ({
      ok: true as const,
      status: 0,
      content: "proposalId=94142935-2a48-4c70-97b9-7ced3b5cb4eb kind=campaign.create pending=true",
    }));
    const code = await main(
      {
        HERMES_WAKE: "1",
        AGENT_INTERNAL_API_KEY: "k",
        CAMPAIGN_ORG_ID: ORG,
        ADS_AGENT_BASE_URL: "http://host.docker.internal:3030",
      },
      [`--org-id=${ORG}`, "--corridor=koramangala"],
      { invokeCli, invokeApi: vi.fn() },
    );
    expect(code).toBe(0);
    expect(invokeCli.mock.calls[0]![0].profile).toBe("campaign");
    expect(invokeCli.mock.calls[0]![0].skill).toBe("campaign-draft");
    expect(log.mock.calls.flat().join(" ")).toContain("koramangala");
    log.mockRestore();
  });
});
