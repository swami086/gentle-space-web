import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
const clientQuery = vi.fn();
const release = vi.fn();

vi.hoisted(() => {
  vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
});

vi.mock("./client", () => ({
  getPool: () => ({
    query,
    connect: async () => ({ query: clientQuery, release }),
  }),
}));
vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => false),
  readFileSync: vi.fn((p: string) => {
    if (String(p).endsWith(".up.sql")) return "ALTER TABLE public.users SET role = role;";
    return "CREATE TABLE IF NOT EXISTS placeholder (id UUID);";
  }),
  readdirSync: vi.fn(() => []),
}));

import { migrate } from "./migrate";

beforeEach(() => {
  query.mockReset();
  clientQuery.mockReset();
  query.mockResolvedValue({ rows: [] });
});

describe("migrate", () => {
  it("returns no pending migrations when the ledger is current", async () => {
    const ran = await migrate();
    expect(ran).toEqual([]);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("CREATE TABLE IF NOT EXISTS public.schema_migrations"),
    );
  });

  it("propagates query errors", async () => {
    query.mockRejectedValue(new Error("connection refused"));
    await expect(migrate()).rejects.toThrow("connection refused");
  });
});
