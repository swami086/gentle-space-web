import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();

vi.hoisted(() => {
  vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
});

vi.mock("./client", () => ({ getPool: () => ({ query }) }));
vi.mock("node:fs", () => ({
  readFileSync: vi.fn(() => "CREATE TABLE IF NOT EXISTS placeholder (id UUID);"),
}));

import { migrate } from "./migrate";

beforeEach(() => {
  query.mockReset();
});

describe("migrate", () => {
  it("applies schema.sql contents to the pool", async () => {
    query.mockResolvedValue({});
    await migrate();
    expect(query).toHaveBeenCalledWith("CREATE TABLE IF NOT EXISTS placeholder (id UUID);");
  });

  it("propagates query errors", async () => {
    query.mockRejectedValue(new Error("connection refused"));
    await expect(migrate()).rejects.toThrow("connection refused");
  });
});
