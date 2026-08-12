import { describe, it, expect, vi, afterEach } from "vitest";
import { chQuery, clickhouseConfig } from "./client";

afterEach(() => vi.unstubAllGlobals());

describe("clickhouseConfig", () => {
  it("throws when the url is absent rather than defaulting to localhost", () => {
    expect(() => clickhouseConfig({})).toThrow("CLICKHOUSE_URL");
  });

  it("defaults the target to local so cloud-only DDL is never applied by accident", () => {
    expect(clickhouseConfig({ CLICKHOUSE_URL: "http://x:8123" }).target).toBe("local");
  });
});

describe("chQuery", () => {
  it("parses JSONEachRow and sends query parameters prefixed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('{"a":1}\n{"a":2}\n', { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const rows = await chQuery<{ a: number }>("SELECT {n:UInt8} AS a", {
      params: { n: "1" },
      config: { url: "http://x:8123", user: "etl_writer", password: "p", target: "local" },
    });

    expect(rows).toEqual([{ a: 1 }, { a: 2 }]);
    const called = new URL(fetchMock.mock.calls[0][0]);
    expect(called.searchParams.get("param_n")).toBe("1");
    expect(called.searchParams.get("default_format")).toBe("JSONEachRow");
  });

  it("throws with the server body when the response is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Syntax error", { status: 400 })));
    await expect(
      chQuery("NOPE", { config: { url: "http://x:8123", user: "u", password: "", target: "local" } }),
    ).rejects.toThrow("clickhouse 400: Syntax error");
  });
});
