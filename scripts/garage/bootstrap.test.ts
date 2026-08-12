import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

describe("garage local stack", () => {
  it("pins a v2 image, because task 11 calls admin API v2", () => {
    expect(read("docker-compose.garage.yml")).toMatch(/image:\s*dxflrs\/garage:v2\./);
  });

  it("exposes the S3 and admin ports the app expects", () => {
    const cfg = read("docker/garage.toml");
    expect(cfg).toContain('api_bind_addr = "[::]:3900"');
    expect(cfg).toContain('api_bind_addr = "[::]:3903"');
  });

  it("mounts the config and persists both metadata and data", () => {
    const compose = read("docker-compose.garage.yml");
    expect(compose).toContain("docker/garage.toml:/etc/garage.toml");
    expect(compose).toContain("garage_meta:/var/lib/garage/meta");
    expect(compose).toContain("garage_data:/var/lib/garage/data");
  });

  it("declares single-node replication and the region the signer signs for", () => {
    const cfg = read("docker/garage.toml");
    expect(cfg).toContain("replication_factor = 1");
    expect(cfg).toContain('s3_region = "garage"');
    expect(cfg).toMatch(/\[admin\][\s\S]*admin_token/);
  });

  it("bootstraps exactly the two buckets the app names", () => {
    const sh = read("scripts/garage/bootstrap.sh");
    expect(sh).toContain("bucket create gs-artifacts");
    expect(sh).toContain("bucket create gs-graph-staging");
    expect(sh).toContain("layout apply");
    expect(sh).toContain("key create");
  });
});
