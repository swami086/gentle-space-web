import { describe, it, expect } from "vitest";
import { signS3Request, uriEncode, type S3Credentials } from "./sigv4";

const creds: S3Credentials = {
  endpoint: "http://127.0.0.1:3900",
  region: "garage",
  accessKeyId: "GKtestaccesskey",
  secretAccessKey: "testsecretkey",
};
const AT = new Date("2026-08-12T08:30:00.000Z");
const KEY =
  "artifacts/11111111-1111-1111-1111-111111111111/draft/22222222-2222-2222-2222-222222222222";

describe("uriEncode", () => {
  it("leaves unreserved characters alone", () => {
    expect(uriEncode("aZ0-._~", true)).toBe("aZ0-._~");
  });
  it("keeps slashes in a path and encodes them in a query value", () => {
    expect(uriEncode("a/b", false)).toBe("a/b");
    expect(uriEncode("a/b", true)).toBe("a%2Fb");
  });
  it("percent-encodes per UTF-8 byte", () => {
    expect(uriEncode("é", true)).toBe("%C3%A9");
  });
});

describe("signS3Request", () => {
  it("signs a GET with the documented canonical form", () => {
    const signed = signS3Request({ method: "GET", bucket: "gs-artifacts", key: KEY }, creds, AT);
    expect(signed.url).toBe(`http://127.0.0.1:3900/gs-artifacts/${KEY}`);
    expect(signed.headers["x-amz-date"]).toBe("20260812T083000Z");
    expect(signed.headers["x-amz-content-sha256"]).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    expect(signed.headers.Authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=GKtestaccesskey/20260812/garage/s3/aws4_request, " +
        "SignedHeaders=host;x-amz-content-sha256;x-amz-date, " +
        "Signature=d41bc96ced9cec7acf644a51e0aa95faa7b7a2b60f4e94419bf697fe02e60a78",
    );
  });

  it("signs the payload hash, so the body changes the signature", () => {
    const signed = signS3Request(
      { method: "PUT", bucket: "gs-artifacts", key: KEY, body: new TextEncoder().encode("hello") },
      creds,
      AT,
    );
    expect(signed.headers["x-amz-content-sha256"]).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
    expect(signed.headers.Authorization).toContain(
      "Signature=a8f17e081ff5365ab9afcd27741f3fe0929b238afdd0a08c96950f4fb23424bd",
    );
  });

  it("canonicalises a sorted, encoded query string", () => {
    const signed = signS3Request(
      {
        method: "GET",
        bucket: "gs-artifacts",
        query: { "list-type": "2", prefix: "artifacts/11111111-1111-1111-1111-111111111111/" },
      },
      creds,
      AT,
    );
    expect(signed.url).toBe(
      "http://127.0.0.1:3900/gs-artifacts?list-type=2&prefix=artifacts%2F11111111-1111-1111-1111-111111111111%2F",
    );
    expect(signed.headers.Authorization).toContain(
      "Signature=5a1ea5912128b4448edba31ff9ce5a1812373ca8b0a410533b31351d30556245",
    );
  });

  it("signs the host including the port, which is what Garage receives", () => {
    const signed = signS3Request({ method: "GET", bucket: "gs-artifacts", key: KEY }, creds, AT);
    expect(signed.headers.host).toBe("127.0.0.1:3900");
  });
});
