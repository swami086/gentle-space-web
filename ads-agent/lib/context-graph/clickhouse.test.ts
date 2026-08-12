import { describe, it, expect, vi, afterEach } from "vitest";
import { chCommand, chQuery, type ChCredentials } from "./clickhouse";

const creds: ChCredentials = {
  url: "http://ch.test:8123",
  user: "u",
  password: "p",
  database: "gentle_space",
};

function stubFetch(status: number, body: string) {
  const fn = vi.fn().mockResolvedValue({ ok: status < 400, status, text: async () => body });
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("chQuery", () => {
  it("parses JSONEachRow into objects", async () => {
    stubFetch(200, '{"a":1}\n{"a":2}\n');
    await expect(chQuery<{ a: number }>("SELECT 1", { creds })).resolves.toEqual([
      { a: 1 },
      { a: 2 },
    ]);
  });

  it("sends the tenant as the custom setting the row policy reads", async () => {
    const fetchFn = stubFetch(200, "");
    await chQuery("SELECT 1", { creds, orgId: "11111111-1111-1111-1111-111111111111" });
    const url = new URL(fetchFn.mock.calls[0][0].toString());
    expect(url.searchParams.get("SQL_current_tenant_id")).toBe(
      "11111111-1111-1111-1111-111111111111",
    );
    expect(url.searchParams.get("default_format")).toBe("JSONEachRow");
    expect(url.searchParams.get("database")).toBe("gentle_space");
  });

  it("binds parameters as param_* rather than interpolating them", async () => {
    const fetchFn = stubFetch(200, "");
    await chQuery("SELECT {x:String}", { creds, params: { x: "'; DROP TABLE t; --" } });
    const url = new URL(fetchFn.mock.calls[0][0].toString());
    expect(url.searchParams.get("param_x")).toBe("'; DROP TABLE t; --");
    expect(fetchFn.mock.calls[0][1].body).toBe("SELECT {x:String}");
  });

  it("sends credentials as headers, never in the query string", async () => {
    const fetchFn = stubFetch(200, "");
    await chQuery("SELECT 1", { creds });
    expect(fetchFn.mock.calls[0][1].headers["X-ClickHouse-Key"]).toBe("p");
    expect(fetchFn.mock.calls[0][0].toString()).not.toContain("password");
  });

  it("throws with the server's message on a non-2xx", async () => {
    stubFetch(400, "Code: 47. Unknown identifier");
    await expect(chQuery("SELECT nope", { creds })).rejects.toThrow(/Code: 47/);
  });
});

describe("chCommand", () => {
  it("resolves on success and does not parse a body", async () => {
    stubFetch(200, "");
    await expect(
      chCommand("CREATE TABLE t (a UInt8) ENGINE = Memory", { creds }),
    ).resolves.toBeUndefined();
  });
});
