import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const compose = readFileSync(join(__dirname, "..", "..", "docker-compose.yml"), "utf8");

describe("langfuse deployment", () => {
  it.each(["langfuse-web:", "langfuse-worker:", "langfuse-redis:"])("declares the %s service", (service) => {
    expect(compose).toContain(service);
  });

  it("reuses the ClickHouse already being operated rather than starting a second one", () => {
    expect(compose).toContain("CLICKHOUSE_URL: http://clickhouse:8123");
    expect(compose.match(/^\s{2}clickhouse:/gm) ?? []).toHaveLength(0);
  });

  it("gives context-mcp the OTLP endpoint and the dual-emission opt-in", () => {
    expect(compose).toContain("LANGFUSE_OTLP_ENDPOINT: http://langfuse-web:3000/api/public/otel/v1/traces");
    expect(compose).toContain("OTEL_SEMCONV_STABILITY_OPT_IN: gen_ai_latest_experimental");
  });

  it("never gives context-mcp the owner DATABASE_URL", () => {
    const service = compose.slice(compose.indexOf("  context-mcp:"));
    const block = service.slice(0, service.indexOf("\n  langfuse-web:"));
    expect(block).toContain("AGENT_RO_DATABASE_URL");
    expect(block).not.toMatch(/^\s+DATABASE_URL:/m);
  });

  it("keeps secrets out of the file: every credential is an env reference", () => {
    for (const key of ["LANGFUSE_SECRET_KEY", "LANGFUSE_PUBLIC_KEY", "LANGFUSE_SALT", "NEXTAUTH_SECRET"]) {
      const line = compose.split("\n").find((l) => l.trim().startsWith(`${key}:`));
      expect(line, `${key} must be present`).toBeDefined();
      expect(line, `${key} must come from the environment`).toContain("${");
    }
  });
});
