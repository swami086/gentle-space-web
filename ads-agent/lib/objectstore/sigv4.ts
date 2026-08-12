import { createHash, createHmac } from "node:crypto";

export type S3Credentials = {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export type S3RequestSpec = {
  method: "GET" | "PUT" | "HEAD" | "DELETE" | "POST";
  bucket: string;
  key?: string;
  query?: Record<string, string>;
  body?: Uint8Array;
};

export type SignedRequest = { url: string; headers: Record<string, string> };

const UNRESERVED = /[A-Za-z0-9\-._~]/;

export function uriEncode(value: string, encodeSlash: boolean): string {
  let out = "";
  for (const byte of Buffer.from(value, "utf8")) {
    const ch = String.fromCharCode(byte);
    if (UNRESERVED.test(ch)) out += ch;
    else if (ch === "/" && !encodeSlash) out += ch;
    else out += "%" + byte.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

const sha256Hex = (data: Uint8Array | string): string =>
  createHash("sha256").update(data).digest("hex");

const hmac = (key: Buffer | string, data: string): Buffer =>
  createHmac("sha256", key).update(data, "utf8").digest();

export function signS3Request(
  spec: S3RequestSpec,
  creds: S3Credentials,
  now: Date = new Date(),
): SignedRequest {
  const body = spec.body ?? new Uint8Array();
  const payloadHash = sha256Hex(body);
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const dateStamp = amzDate.slice(0, 8);

  const canonicalUri = uriEncode("/" + spec.bucket + (spec.key ? "/" + spec.key : ""), false);

  const query = spec.query ?? {};
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${uriEncode(k, true)}=${uriEncode(query[k], true)}`)
    .join("&");

  const headers: Record<string, string> = {
    host: new URL(creds.endpoint).host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  const names = Object.keys(headers).sort();
  const signedHeaders = names.join(";");
  const canonicalHeaders = names.map((k) => `${k}:${headers[k].trim()}\n`).join("");

  const canonicalRequest = [
    spec.method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${creds.region}/s3/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256Hex(canonicalRequest)].join(
    "\n",
  );

  const signingKey = hmac(
    hmac(hmac(hmac("AWS4" + creds.secretAccessKey, dateStamp), creds.region), "s3"),
    "aws4_request",
  );
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

  return {
    url:
      creds.endpoint.replace(/\/$/, "") + canonicalUri + (canonicalQuery ? "?" + canonicalQuery : ""),
    headers: {
      ...headers,
      Authorization:
        `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${credentialScope}, ` +
        `SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}
