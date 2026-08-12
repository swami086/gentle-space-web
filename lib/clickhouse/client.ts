export type ClickHouseTarget = "local" | "cloud";

export type ClickHouseConfig = {
  url: string;
  user: string;
  password: string;
  target: ClickHouseTarget;
};

export type ClickHouseOptions = {
  params?: Record<string, string>;
  settings?: Record<string, string>;
  config?: ClickHouseConfig;
};

export function clickhouseConfig(env: NodeJS.ProcessEnv = process.env): ClickHouseConfig {
  const url = env.CLICKHOUSE_URL;
  if (!url) throw new Error("CLICKHOUSE_URL is not set");
  return {
    url,
    user: env.CLICKHOUSE_USER ?? "etl_writer",
    password: env.CLICKHOUSE_PASSWORD ?? "",
    target: env.CLICKHOUSE_TARGET === "cloud" ? "cloud" : "local",
  };
}

function searchFor(options: ClickHouseOptions): Record<string, string> {
  const search: Record<string, string> = {};
  for (const [key, value] of Object.entries(options.params ?? {})) search[`param_${key}`] = value;
  for (const [key, value] of Object.entries(options.settings ?? {})) search[key] = value;
  return search;
}

async function post(sql: string, search: Record<string, string>, config: ClickHouseConfig): Promise<string> {
  const url = new URL(config.url);
  for (const [key, value] of Object.entries(search)) url.searchParams.set(key, value);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "X-ClickHouse-User": config.user,
      "X-ClickHouse-Key": config.password,
      "Content-Type": "text/plain; charset=utf-8",
    },
    body: sql,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`clickhouse ${res.status}: ${text.slice(0, 500)}`);
  return text;
}

export async function chExec(sql: string, options: ClickHouseOptions = {}): Promise<void> {
  await post(sql, searchFor(options), options.config ?? clickhouseConfig());
}

export async function chQuery<T>(sql: string, options: ClickHouseOptions = {}): Promise<T[]> {
  const text = await post(
    sql,
    { ...searchFor(options), default_format: "JSONEachRow" },
    options.config ?? clickhouseConfig(),
  );
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
}
