/**
 * Garage administration API v2. Endpoints are RPC-style POSTs under /v2/,
 * authenticated with a bearer token. v1 used a different, REST-ish shape, which
 * is why docker-compose.garage.yml pins a v2.x image.
 */
export type GarageAdmin = { endpoint: string; token: string };

export function garageAdminFromEnv(): GarageAdmin {
  const endpoint = process.env.GARAGE_ADMIN_ENDPOINT;
  const token = process.env.GARAGE_ADMIN_TOKEN;
  if (!endpoint) throw new Error("GARAGE_ADMIN_ENDPOINT is not set");
  if (!token) throw new Error("GARAGE_ADMIN_TOKEN is not set");
  return { endpoint: endpoint.replace(/\/$/, ""), token };
}

async function call<T>(
  admin: GarageAdmin,
  operation: string,
  init: { method: "GET" | "POST"; body?: unknown; query?: Record<string, string> },
): Promise<T | null> {
  const search = init.query ? "?" + new URLSearchParams(init.query).toString() : "";
  const res = await fetch(`${admin.endpoint}/v2/${operation}${search}`, {
    method: init.method,
    headers: {
      Authorization: `Bearer ${admin.token}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    // 404 means "no such thing", which callers handle; anything else is a fault.
    if (res.status === 404) return null;
    throw new Error(`garage ${operation} failed: ${res.status} ${text}`);
  }
  return text ? (JSON.parse(text) as T) : null;
}

export async function createBucket(
  admin: GarageAdmin,
  globalAlias: string,
): Promise<{ id: string }> {
  const body = await call<{ id: string }>(admin, "CreateBucket", {
    method: "POST",
    body: { globalAlias },
  });
  if (!body) throw new Error(`CreateBucket ${globalAlias} returned no body`);
  return { id: body.id };
}

export async function getBucketByAlias(
  admin: GarageAdmin,
  globalAlias: string,
): Promise<{ id: string } | null> {
  const body = await call<{ id: string }>(admin, "GetBucketInfo", {
    method: "GET",
    query: { globalAlias },
  });
  return body ? { id: body.id } : null;
}

/** The secret is returned exactly once and is never retrievable again. */
export async function createKey(
  admin: GarageAdmin,
  name: string,
): Promise<{ accessKeyId: string; secretAccessKey: string }> {
  const body = await call<{ accessKeyId: string; secretAccessKey: string | null }>(
    admin,
    "CreateKey",
    { method: "POST", body: { name } },
  );
  if (!body?.secretAccessKey) throw new Error(`CreateKey ${name} returned no secret`);
  return { accessKeyId: body.accessKeyId, secretAccessKey: body.secretAccessKey };
}

export async function allowBucketKey(
  admin: GarageAdmin,
  bucketId: string,
  accessKeyId: string,
  permissions: { read: boolean; write: boolean; owner: boolean },
): Promise<void> {
  await call(admin, "AllowBucketKey", {
    method: "POST",
    body: { bucketId, accessKeyId, permissions },
  });
}

export async function deleteBucket(admin: GarageAdmin, bucketId: string): Promise<void> {
  await call(admin, "DeleteBucket", { method: "POST", query: { id: bucketId } });
}
