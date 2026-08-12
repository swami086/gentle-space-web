export type ChCredentials = {
  url: string;
  user: string;
  password: string;
  database: string;
};

export type ChOptions = {
  orgId?: string;
  params?: Record<string, string>;
  settings?: Record<string, string>;
  creds?: ChCredentials;
};

export function chFromEnv(): ChCredentials {
  return {
    url: process.env.CLICKHOUSE_URL ?? "http://127.0.0.1:8123",
    user: process.env.CLICKHOUSE_USER ?? "default",
    password: process.env.CLICKHOUSE_PASSWORD ?? "",
    database: process.env.CLICKHOUSE_DATABASE ?? "gentle_space",
  };
}

async function send(sql: string, opts: ChOptions): Promise<string> {
  const creds = opts.creds ?? chFromEnv();
  const url = new URL(creds.url);
  url.searchParams.set("database", creds.database);
  url.searchParams.set("default_format", "JSONEachRow");
  if (opts.orgId) url.searchParams.set("SQL_current_tenant_id", opts.orgId);
  for (const [k, v] of Object.entries(opts.settings ?? {})) url.searchParams.set(k, v);
  for (const [k, v] of Object.entries(opts.params ?? {})) url.searchParams.set(`param_${k}`, v);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "X-ClickHouse-User": creds.user,
      "X-ClickHouse-Key": creds.password,
      "content-type": "text/plain; charset=utf-8",
    },
    body: sql,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`ClickHouse ${res.status}: ${text}`);
  return text;
}

export async function chQuery<T>(sql: string, opts: ChOptions = {}): Promise<T[]> {
  const text = await send(sql, opts);
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
}

export async function chCommand(sql: string, opts: ChOptions = {}): Promise<void> {
  await send(sql, opts);
}
