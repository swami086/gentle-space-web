import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyQueryEntities } from "../graph/types";

const openaiExtract = vi.fn();
const vertexExtract = vi.fn();
const openaiQualify = vi.fn();
const vertexQualify = vi.fn();

vi.mock("../openai/client", () => ({
  extractSearchEntities: (...args: unknown[]) => openaiExtract(...args),
  qualifyLead: (...args: unknown[]) => openaiQualify(...args),
}));

vi.mock("../vertex/client", () => ({
  extractSearchEntities: (...args: unknown[]) => vertexExtract(...args),
  qualifyLead: (...args: unknown[]) => vertexQualify(...args),
}));

import { extractSearchEntities, qualifyLead } from "./client";

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

describe("qualifyLead facade", () => {
  afterEach(() => {
    delete process.env.AI_PROVIDER;
    openaiQualify.mockReset();
    vertexQualify.mockReset();
  });

  it("delegates to vertex when configured", async () => {
    process.env.AI_PROVIDER = "vertex";
    vertexQualify.mockResolvedValue({ tier: "hot", cheatSheet: "Ask about move-in." });

    await expect(
      qualifyLead({ need: "office", step2Answers: {}, notes: "" }),
    ).resolves.toEqual({ tier: "hot", cheatSheet: "Ask about move-in." });
  });

  it("falls back to unscored when the provider throws", async () => {
    process.env.AI_PROVIDER = "openai";
    openaiQualify.mockRejectedValue(new Error("openai down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      qualifyLead({ need: "retail", step2Answers: {}, notes: "" }),
    ).resolves.toEqual({ tier: "unscored", cheatSheet: "" });

    errSpy.mockRestore();
  });
});
