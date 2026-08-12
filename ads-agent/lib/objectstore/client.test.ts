import { describe, it, expect, vi, afterEach } from "vitest";
import { ObjectStore } from "./client";
import type { S3Credentials } from "./sigv4";

const creds: S3Credentials = {
  endpoint: "http://127.0.0.1:3900",
  region: "garage",
  accessKeyId: "GK",
  secretAccessKey: "S",
};
const store = new ObjectStore(creds);

afterEach(() => vi.unstubAllGlobals());

function page(keys: string[], nextToken?: string): string {
  return `<?xml version="1.0"?><ListBucketResult>
    ${keys
      .map(
        (k) =>
          `<Contents><Key>${k}</Key><Size>7</Size>` +
          `<LastModified>2026-08-12T08:00:00.000Z</LastModified></Contents>`,
      )
      .join("")}
    <IsTruncated>${nextToken ? "true" : "false"}</IsTruncated>
    ${nextToken ? `<NextContinuationToken>${nextToken}</NextContinuationToken>` : ""}
  </ListBucketResult>`;
}

describe("ObjectStore.put", () => {
  it("PUTs the body with a signed Authorization header", async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "" });
    vi.stubGlobal("fetch", fetchFn);
    await store.put(
      "gs-artifacts",
      "artifacts/a/draft/b",
      new TextEncoder().encode("hello"),
      "text/plain",
    );

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:3900/gs-artifacts/artifacts/a/draft/b");
    expect(init.method).toBe("PUT");
    expect(init.headers.Authorization).toContain("AWS4-HMAC-SHA256");
    expect(init.headers["content-type"]).toBe("text/plain");
  });

  it("throws with the status and body on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => "AccessDenied",
      }),
    );
    await expect(store.put("b", "k", new Uint8Array(), "application/json")).rejects.toThrow(
      /403.*AccessDenied/,
    );
  });
});

describe("ObjectStore.get", () => {
  it("returns the bytes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        arrayBuffer: async () => new TextEncoder().encode("hi").buffer,
      }),
    );
    const body = await store.get("b", "k");
    expect(new TextDecoder().decode(body!)).toBe("hi");
  });

  it("returns null on 404 rather than throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => "",
      }),
    );
    await expect(store.get("b", "k")).resolves.toBeNull();
  });
});

describe("ObjectStore.head", () => {
  it("returns size and last-modified", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({
          "content-length": "42",
          "last-modified": "Wed, 12 Aug 2026 08:00:00 GMT",
        }),
      }),
    );
    await expect(store.head("b", "k")).resolves.toEqual({
      key: "k",
      byteSize: 42,
      lastModified: new Date("Wed, 12 Aug 2026 08:00:00 GMT"),
    });
  });

  it("returns null on 404, which is what proves an erasure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => "",
      }),
    );
    await expect(store.head("b", "k")).resolves.toBeNull();
  });

  it("throws on 403 rather than reporting absence", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: async () => "",
      }),
    );
    await expect(store.head("b", "k")).rejects.toThrow(/403/);
  });
});

describe("ObjectStore.remove", () => {
  it("treats a missing key as success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => "",
      }),
    );
    await expect(store.remove("b", "k")).resolves.toBeUndefined();
  });
});

describe("ObjectStore.list", () => {
  it("follows the continuation token across pages", async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => page(["a", "b"], "TOKEN-1"),
      })
      .mockResolvedValueOnce({ ok: true, status: 200, text: async () => page(["c"]) });
    vi.stubGlobal("fetch", fetchFn);

    const keys: string[] = [];
    for await (const obj of store.list("gs-artifacts", "artifacts/")) keys.push(obj.key);

    expect(keys).toEqual(["a", "b", "c"]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(fetchFn.mock.calls[1][0]).toContain("continuation-token=TOKEN-1");
  });

  it("parses size and timestamp from each entry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => page(["only"]),
      }),
    );
    for await (const obj of store.list("b", "p")) {
      expect(obj).toEqual({
        key: "only",
        byteSize: 7,
        lastModified: new Date("2026-08-12T08:00:00.000Z"),
      });
    }
  });
});
