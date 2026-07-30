import { afterEach, describe, expect, it, vi } from "vitest";
import type { InsightFacts } from "../spaces/insight-types";

const openaiExplain = vi.fn();
const vertexExplain = vi.fn();

vi.mock("../openai/client", () => ({
  explainListingFit: (...args: unknown[]) => openaiExplain(...args),
}));

vi.mock("../vertex/client", () => ({
  explainListingFit: (...args: unknown[]) => vertexExplain(...args),
}));

import { explainListingFit } from "./client";

const facts: InsightFacts = {
  title: "CoWrks Ecoworld",
  area: "Bellandur",
  city: "Bengaluru",
  propertyType: null,
  amenities: [],
  description: "",
  query: "coworking in bellandur",
  nearby: [],
};

afterEach(() => {
  delete process.env.AI_PROVIDER;
  openaiExplain.mockReset();
  vertexExplain.mockReset();
});

describe("explainListingFit facade", () => {
  it("delegates to vertex when configured", async () => {
    process.env.AI_PROVIDER = "vertex";
    vertexExplain.mockResolvedValue({ summary: "fits", highlights: [] });

    await expect(explainListingFit(facts)).resolves.toEqual({ summary: "fits", highlights: [] });
    expect(vertexExplain).toHaveBeenCalledWith(facts);
  });

  it("returns empty content when the provider throws", async () => {
    process.env.AI_PROVIDER = "openai";
    openaiExplain.mockRejectedValue(new Error("openai down"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(explainListingFit(facts)).resolves.toEqual({ summary: "", highlights: [] });

    errSpy.mockRestore();
  });
});
