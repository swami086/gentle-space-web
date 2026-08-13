import { describe, expect, it, vi } from "vitest";
import {
  buildCampaignWakeMessage,
  buildDockerWakeArgs,
  buildPerformanceWakeMessage,
  hermesProfileChatUrl,
  invokeHermesProfileWakeApi,
  resolveWakeTransport,
} from "./wake-invoke";

describe("resolveWakeTransport", () => {
  it("defaults to cli", () => {
    expect(resolveWakeTransport({})).toBe("cli");
  });

  it("accepts api", () => {
    expect(resolveWakeTransport({ HERMES_WAKE_TRANSPORT: "api" })).toBe("api");
  });
});

describe("hermesProfileChatUrl", () => {
  it("builds /p/<profile>/v1/chat/completions", () => {
    expect(hermesProfileChatUrl("http://127.0.0.1:8642", "performance")).toBe(
      "http://127.0.0.1:8642/p/performance/v1/chat/completions",
    );
  });
});

describe("wake messages", () => {
  it("performance message names MCP tools", () => {
    const msg = buildPerformanceWakeMessage({ orgId: "org-1", corridor: "Whitefield" });
    expect(msg).toContain("mcp__context_mcp__get_campaign_performance");
    expect(msg).toContain("campaign.pause");
  });

  it("campaign message defaults corridor", () => {
    const msg = buildCampaignWakeMessage({ orgId: "org-2" });
    expect(msg).toContain("Whitefield");
    expect(msg).toContain("campaign.create");
  });
});

describe("buildDockerWakeArgs", () => {
  it("uses hermes -p <profile> and passes mint env", () => {
    const args = buildDockerWakeArgs({
      container: "hermes",
      profile: "performance",
      skill: "performance-review",
      message: "go",
      passEnv: { AGENT_INTERNAL_API_KEY: "k", PERFORMANCE_ORG_ID: "o" },
    });
    expect(args).toEqual([
      "exec",
      "-e",
      "AGENT_INTERNAL_API_KEY=k",
      "-e",
      "PERFORMANCE_ORG_ID=o",
      "hermes",
      "/opt/hermes/bin/hermes",
      "-p",
      "performance",
      "chat",
      "--yolo",
      "--accept-hooks",
      "-s",
      "performance-review",
      "-q",
      "go",
    ]);
  });

  it("redirects via sh -c when outFile set", () => {
    const args = buildDockerWakeArgs({
      container: "hermes",
      profile: "performance",
      skill: "performance-review",
      message: "go",
      passEnv: {},
      outFile: "/tmp/wake.log",
    });
    expect(args.slice(0, 3)).toEqual(["exec", "hermes", "sh"]);
    expect(args[3]).toBe("-c");
    expect(args[4]).toContain("/opt/hermes/bin/hermes");
    expect(args[4]).toContain("-p");
    expect(args[4]).toContain("performance");
    expect(args[4]).toContain("> '/tmp/wake.log'");
    expect(args[4]).toContain("WAKE_EXIT");
  });
});

describe("session helpers", () => {
  it("extracts session id and completion marker", async () => {
    const { extractHermesSessionId, wakeLooksComplete } = await import("./wake-invoke");
    expect(
      extractHermesSessionId("Session:        20260813_042052_c80439\nTitle: x"),
    ).toBe("20260813_042052_c80439");
    expect(wakeLooksComplete("proposalId=94142935-2a48-4c70-97b9-7ced3b5cb4eb")).toBe(true);
    expect(wakeLooksComplete("still working")).toBe(false);
  });
});

describe("invokeHermesProfileWakeApi", () => {
  it("POSTs non-streaming completion and returns content", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "proposalId=abc pending=true" } }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const result = await invokeHermesProfileWakeApi({
      profile: "performance",
      message: "go",
      baseUrl: "http://127.0.0.1:8642",
      apiKey: "k",
      fetchFn: fetchFn as unknown as typeof fetch,
      timeoutMs: 5_000,
    });
    expect(result).toEqual({
      ok: true,
      status: 200,
      content: "proposalId=abc pending=true",
    });
  });
});
