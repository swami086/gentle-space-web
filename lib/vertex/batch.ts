import { getVertexAccessToken } from "./auth";

function projectId(): string {
  const id = process.env.GOOGLE_CLOUD_PROJECT;
  if (!id) throw new Error("GOOGLE_CLOUD_PROJECT is not set");
  return id;
}

function location(): string {
  return process.env.GOOGLE_CLOUD_LOCATION || "us-central1";
}

function chatModel(): string {
  return process.env.VERTEX_CHAT_MODEL || "gemini-2.5-flash-lite";
}

async function authHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
  const token = await getVertexAccessToken();
  return {
    Authorization: `Bearer ${token}`,
    ...extra,
  };
}

async function readError(res: Response): Promise<never> {
  throw new Error(`${res.status} ${await res.text()}`);
}

async function readJson<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) await readError(res);
  return (await res.json()) as T;
}

async function readText(url: string, init: RequestInit): Promise<string> {
  const res = await fetch(url, init);
  if (!res.ok) await readError(res);
  return res.text();
}

export async function putGcsObject(
  bucket: string,
  object: string,
  body: string,
  contentType = "text/plain; charset=utf-8",
): Promise<void> {
  const url =
    `https://storage.googleapis.com/upload/storage/v1/b/${bucket}/o` +
    `?uploadType=media&name=${encodeURIComponent(object)}`;

  await readText(url, {
    method: "POST",
    headers: await authHeaders({ "Content-Type": contentType }),
    body,
  });
}

export async function listGcsObjects(bucket: string, prefix: string): Promise<string[]> {
  const url =
    `https://storage.googleapis.com/storage/v1/b/${bucket}/o` +
    `?prefix=${encodeURIComponent(prefix)}`;

  const body = await readJson<{ items?: { name?: string }[] }>(url, {
    method: "GET",
    headers: await authHeaders(),
  });

  return (body.items || []).flatMap((item) => (item.name ? [item.name] : []));
}

export async function getGcsObject(bucket: string, object: string): Promise<string> {
  const url =
    `https://storage.googleapis.com/storage/v1/b/${bucket}/o/${encodeURIComponent(object)}` +
    "?alt=media";

  return readText(url, {
    method: "GET",
    headers: await authHeaders(),
  });
}

export async function createBatchPredictionJob(input: {
  displayName: string;
  inputUri: string;
  outputUriPrefix: string;
}): Promise<{ name: string }> {
  const region = location();

  return readJson<{ name: string }>(
    `https://${region}-aiplatform.googleapis.com/v1/projects/${projectId()}/locations/${region}/batchPredictionJobs`,
    {
      method: "POST",
      headers: await authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        displayName: input.displayName,
        model: `projects/${projectId()}/locations/${region}/publishers/google/models/${chatModel()}`,
        inputConfig: {
          instancesFormat: "jsonl",
          gcsSource: { uris: [input.inputUri] },
        },
        outputConfig: {
          predictionsFormat: "jsonl",
          gcsDestination: { outputUriPrefix: input.outputUriPrefix },
        },
      }),
    },
  );
}

export async function getBatchPredictionJob(name: string): Promise<{
  name: string;
  state: string;
  outputInfo?: { gcsOutputDirectory?: string };
}> {
  return readJson(`https://${location()}-aiplatform.googleapis.com/v1/${name}`, {
    method: "GET",
    headers: await authHeaders(),
  });
}
