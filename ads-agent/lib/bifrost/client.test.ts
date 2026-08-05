import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("bifrost client", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      BIFROST_BASE_URL: "http://localhost:8080",
      BIFROST_CHAT_MODEL: "vertex/gemini-2.5-flash-lite",
    };
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("isBifrostConfigured is true when BIFROST_BASE_URL is set", async () => {
    const { isBifrostConfigured } = await import("./client");
    expect(isBifrostConfigured()).toBe(true);
  });

  it("isBifrostConfigured is false when BIFROST_BASE_URL is empty", async () => {
    process.env.BIFROST_BASE_URL = "   ";
    const { isBifrostConfigured } = await import("./client");
    expect(isBifrostConfigured()).toBe(false);
  });

  it("fallbacksForModel escalates cheap → complex → reasoning", async () => {
    const { fallbacksForModel } = await import("./client");
    expect(fallbacksForModel("vertex/gemini-2.5-flash-lite")).toEqual([
      "vertex/gemini-2.5-flash",
      "vertex/gemini-2.5-pro",
    ]);
    expect(fallbacksForModel("vertex/cheap")).toEqual([
      "vertex/gemini-2.5-flash",
      "vertex/gemini-2.5-pro",
    ]);
    expect(fallbacksForModel("vertex/gemini-2.5-flash")).toEqual(["vertex/gemini-2.5-pro"]);
    expect(fallbacksForModel("vertex/gemini-2.5-pro")).toEqual([]);
  });

  it("chatCompletion POSTs OpenAI-shaped body with fallbacks and returns content", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { role: "assistant", content: "hello" } }],
          extra_fields: { provider: "vertex" },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { chatCompletion, firstChoiceContent } = await import("./client");
    const response = await chatCompletion({
      messages: [{ role: "user", content: "hi" }],
      temperature: 0.2,
      maxTokens: 50,
    });

    expect(firstChoiceContent(response)).toBe("hello");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:8080/v1/chat/completions");
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe("vertex/gemini-2.5-flash-lite");
    expect(body.fallbacks).toEqual(["vertex/gemini-2.5-flash", "vertex/gemini-2.5-pro"]);
    expect(body.messages).toEqual([{ role: "user", content: "hi" }]);
    expect(body.temperature).toBe(0.2);
    expect(body.max_tokens).toBe(50);
  });

  it("chatCompletion parses id, model, and usage from the response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: "req-abc",
          model: "gemini-2.5-flash-lite",
          choices: [{ message: { role: "assistant", content: "hello" } }],
          usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
          extra_fields: { provider: "vertex" },
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { chatCompletion } = await import("./client");
    const response = await chatCompletion({ messages: [{ role: "user", content: "hi" }] });

    expect(response.id).toBe("req-abc");
    expect(response.model).toBe("gemini-2.5-flash-lite");
    expect(response.usage?.prompt_tokens).toBe(100);
    expect(response.usage?.completion_tokens).toBe(50);
    expect(response.usage?.total_tokens).toBe(150);
  });

  it("chatCompletion includes response_format when provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const { chatCompletion } = await import("./client");
    await chatCompletion({
      messages: [{ role: "user", content: "x" }],
      responseFormat: {
        type: "json_schema",
        json_schema: { name: "draft", schema: { type: "object" }, strict: false },
      },
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.response_format.type).toBe("json_schema");
    expect(body.response_format.json_schema.name).toBe("draft");
  });

  it("chatCompletion throws on non-2xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("boom", { status: 502 })),
    );
    const { chatCompletion } = await import("./client");
    await expect(chatCompletion({ messages: [{ role: "user", content: "x" }] })).rejects.toThrow(
      /bifrost chatCompletion failed: 502/,
    );
  });

  describe("chatCompletion with tool_calls", () => {
    it("passes a tools param through to the request body", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ choices: [{ message: { role: "assistant", content: "hi" } }] }),
          { status: 200 },
        ),
      );
      vi.stubGlobal("fetch", fetchMock);

      const { chatCompletion } = await import("./client");
      const tools = [{ type: "function" as const, function: { name: "list_opportunities", description: "", parameters: {} } }];
      await chatCompletion({ messages: [{ role: "user", content: "hi" }], tools });

      const [, init] = fetchMock.mock.calls[0];
      const body = JSON.parse(init.body as string);
      expect(body.tools).toEqual(tools);
    });

    it("returns tool_calls on the response message when present", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  role: "assistant",
                  content: null,
                  tool_calls: [{ id: "call_1", type: "function", function: { name: "twenty_list_opportunities", arguments: "{}" } }],
                },
              },
            ],
          }),
          { status: 200 },
        ),
      );
      vi.stubGlobal("fetch", fetchMock);

      const { chatCompletion } = await import("./client");
      const response = await chatCompletion({ messages: [{ role: "user", content: "show leads" }] });

      expect(response.choices?.[0]?.message?.tool_calls).toEqual([
        { id: "call_1", type: "function", function: { name: "twenty_list_opportunities", arguments: "{}" } },
      ]);
    });

    it("accepts a tool-role message with tool_call_id in the request", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ choices: [{ message: { role: "assistant", content: "done" } }] }),
          { status: 200 },
        ),
      );
      vi.stubGlobal("fetch", fetchMock);

      const { chatCompletion } = await import("./client");
      await chatCompletion({
        messages: [
          { role: "user", content: "show leads" },
          { role: "assistant", content: "", tool_calls: [{ id: "call_1", type: "function", function: { name: "twenty_list_opportunities", arguments: "{}" } }] },
          { role: "tool", content: "[]", tool_call_id: "call_1" },
        ],
      });

      const [, init] = fetchMock.mock.calls[0];
      const body = JSON.parse(init.body as string);
      expect(body.messages[2]).toEqual({ role: "tool", content: "[]", tool_call_id: "call_1" });
    });
  });
});
