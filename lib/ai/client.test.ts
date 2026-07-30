import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyQueryEntities } from "../graph/types";

const openaiExtract = vi.fn();
const vertexExtract = vi.fn();

vi.mock("../openai/client", () => ({
  extractSearchEntities: (...args: unknown[]) => openaiExtract(...args),
}));

vi.mock("../vertex/client", () => ({
  extractSearchEntities: (...args: unknown[]) => vertexExtract(...args),
}));

import { extractSearchEntities } from "./client";

describe("extractSearchEntities facade", () => {
  afterEach(() => {
    delete process.env.AI_PROVIDER;
    openaiExtract.mockReset();
    vertexExtract.mockReset();
  });

  it("returns emptyQueryEntities when openai extract throws", async () => {
    process.env.AI_PROVIDER = "openai";
    openaiExtract.mockRejectedValue(new Error("openai down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(extractSearchEntities("query")).resolves.toEqual(emptyQueryEntities());
    expect(openaiExtract).toHaveBeenCalledWith("query");

    errSpy.mockRestore();
  });

  it("returns emptyQueryEntities when vertex extract throws", async () => {
    process.env.AI_PROVIDER = "vertex";
    vertexExtract.mockRejectedValue(new Error("vertex down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(extractSearchEntities("query")).resolves.toEqual(emptyQueryEntities());
    expect(vertexExtract).toHaveBeenCalledWith("query");

    errSpy.mockRestore();
  });
});
