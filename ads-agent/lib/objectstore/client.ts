import { signS3Request, type S3Credentials, type S3RequestSpec } from "./sigv4";

export type ObjectSummary = { key: string; byteSize: number; lastModified: Date };

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

/**
 * The single server-side accessor for the object store. Access is server-side
 * only (datastore §13.1) -- no presigned URLs, because a presigned URL is a
 * bearer token that escapes tenant checks for its whole lifetime.
 */
export class ObjectStore {
  constructor(private readonly creds: S3Credentials) {}

  static fromEnv(): ObjectStore {
    return new ObjectStore({
      endpoint: requireEnv("GARAGE_S3_ENDPOINT"),
      region: process.env.GARAGE_REGION ?? "garage",
      accessKeyId: requireEnv("ARTIFACT_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("ARTIFACT_SECRET_ACCESS_KEY"),
    });
  }

  private async send(
    spec: S3RequestSpec,
    extraHeaders: Record<string, string> = {},
  ): Promise<Response> {
    const { url, headers } = signS3Request(spec, this.creds);
    return fetch(url, {
      method: spec.method,
      headers: { ...headers, ...extraHeaders },
      body: spec.body ? Buffer.from(spec.body) : undefined,
    });
  }

  async put(bucket: string, key: string, body: Uint8Array, mediaType: string): Promise<void> {
    const res = await this.send({ method: "PUT", bucket, key, body }, { "content-type": mediaType });
    if (!res.ok) {
      throw new Error(`PUT ${bucket}/${key} failed: ${res.status} ${await res.text()}`);
    }
  }

  async get(bucket: string, key: string): Promise<Uint8Array | null> {
    const res = await this.send({ method: "GET", bucket, key });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GET ${bucket}/${key} failed: ${res.status} ${await res.text()}`);
    return new Uint8Array(await res.arrayBuffer());
  }

  /**
   * null means provably absent. Any other failure throws, so an erasure check
   * can never mistake "forbidden" for "gone".
   */
  async head(bucket: string, key: string): Promise<ObjectSummary | null> {
    const res = await this.send({ method: "HEAD", bucket, key });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`HEAD ${bucket}/${key} failed: ${res.status}`);
    return {
      key,
      byteSize: Number(res.headers.get("content-length") ?? 0),
      lastModified: new Date(res.headers.get("last-modified") ?? Date.now()),
    };
  }

  async remove(bucket: string, key: string): Promise<void> {
    const res = await this.send({ method: "DELETE", bucket, key });
    // S3 DELETE is idempotent: a missing key is a successful delete.
    if (![200, 202, 204, 404].includes(res.status)) {
      throw new Error(`DELETE ${bucket}/${key} failed: ${res.status} ${await res.text()}`);
    }
  }

  /**
   * Prefix listing is the only enumeration an object store offers, and a
   * ListObjectsV2 response caps at 1000 keys -- hence a generator that follows
   * the continuation token rather than an array that silently truncates.
   */
  async *list(bucket: string, prefix: string): AsyncGenerator<ObjectSummary> {
    let token: string | undefined;
    do {
      const query: Record<string, string> = { "list-type": "2", prefix };
      if (token) query["continuation-token"] = token;

      const res = await this.send({ method: "GET", bucket, query });
      if (!res.ok) throw new Error(`LIST ${bucket} failed: ${res.status} ${await res.text()}`);
      const xml = await res.text();

      for (const entry of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        // Keys are built by artifactStorageKey from UUIDs and a fixed enum, so
        // they can never contain XML entities needing unescaping.
        yield {
          key: /<Key>([\s\S]*?)<\/Key>/.exec(entry[1])![1],
          byteSize: Number(/<Size>(\d+)<\/Size>/.exec(entry[1])![1]),
          lastModified: new Date(/<LastModified>([\s\S]*?)<\/LastModified>/.exec(entry[1])![1]),
        };
      }

      token = /<IsTruncated>true<\/IsTruncated>/.test(xml)
        ? /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml)?.[1]
        : undefined;
    } while (token);
  }
}
