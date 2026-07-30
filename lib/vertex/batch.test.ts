import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./auth", () => ({
  getVertexAccessToken: vi.fn().mockResolvedValue("vertex-test-token"),
}));

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
  process.env.GOOGLE_CLOUD_PROJECT = "test-project";
  process.env.GOOGLE_CLOUD_LOCATION = "us-central1";
  process.env.VERTEX_CHAT_MODEL = "gemini-test-model";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.GOOGLE_CLOUD_PROJECT;
  delete process.env.GOOGLE_CLOUD_LOCATION;
  delete process.env.VERTEX_CHAT_MODEL;
});

describe("putGcsObject", () => {
  it("uploads text bodies to the GCS media upload endpoint", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => "",
    });

    const { putGcsObject } = await import("./batch");
    await putGcsObject("test-bucket", "batch/input file.jsonl", "hello", "application/jsonl");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://storage.googleapis.com/upload/storage/v1/b/test-bucket/o?uploadType=media&name=batch%2Finput%20file.jsonl",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer vertex-test-token",
          "Content-Type": "application/jsonl",
        },
        body: "hello",
      },
    );
  });
});

describe("listGcsObjects", () => {
  it("lists object names for a prefix", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [{ name: "batch/out-0001.jsonl" }, { name: "batch/out-0002.jsonl" }],
      }),
    });

    const { listGcsObjects } = await import("./batch");
    await expect(listGcsObjects("test-bucket", "batch/")).resolves.toEqual([
      "batch/out-0001.jsonl",
      "batch/out-0002.jsonl",
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      "https://storage.googleapis.com/storage/v1/b/test-bucket/o?prefix=batch%2F",
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer vertex-test-token" },
      }),
    );
  });
});

describe("getGcsObject", () => {
  it("downloads object text with alt=media", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => '{"ok":true}',
    });

    const { getGcsObject } = await import("./batch");
    await expect(getGcsObject("test-bucket", "batch/out-0001.jsonl")).resolves.toBe('{"ok":true}');

    expect(fetchMock).toHaveBeenCalledWith(
      "https://storage.googleapis.com/storage/v1/b/test-bucket/o/batch%2Fout-0001.jsonl?alt=media",
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer vertex-test-token" },
      }),
    );
  });
});

describe("batch prediction jobs", () => {
  it("creates and fetches batch prediction jobs", async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ name: "projects/test-project/locations/us-central1/batchPredictionJobs/123" }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          name: "projects/test-project/locations/us-central1/batchPredictionJobs/123",
          state: "JOB_STATE_SUCCEEDED",
          outputInfo: {
            gcsOutputDirectory: "gs://test-bucket/output/prediction-test",
          },
        }),
      });

    const { createBatchPredictionJob, getBatchPredictionJob } = await import("./batch");

    await expect(
      createBatchPredictionJob({
        displayName: "prediction-test",
        inputUri: "gs://test-bucket/input.jsonl",
        outputUriPrefix: "gs://test-bucket/output/",
      }),
    ).resolves.toEqual({
      name: "projects/test-project/locations/us-central1/batchPredictionJobs/123",
    });

    await expect(
      getBatchPredictionJob("projects/test-project/locations/us-central1/batchPredictionJobs/123"),
    ).resolves.toEqual({
      name: "projects/test-project/locations/us-central1/batchPredictionJobs/123",
      state: "JOB_STATE_SUCCEEDED",
      outputInfo: {
        gcsOutputDirectory: "gs://test-bucket/output/prediction-test",
      },
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://us-central1-aiplatform.googleapis.com/v1/projects/test-project/locations/us-central1/batchPredictionJobs",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer vertex-test-token",
          "Content-Type": "application/json",
        }),
      }),
    );

    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toEqual({
      displayName: "prediction-test",
      model:
        "projects/test-project/locations/us-central1/publishers/google/models/gemini-test-model",
      inputConfig: {
        instancesFormat: "jsonl",
        gcsSource: { uris: ["gs://test-bucket/input.jsonl"] },
      },
      outputConfig: {
        predictionsFormat: "jsonl",
        gcsDestination: { outputUriPrefix: "gs://test-bucket/output/" },
      },
    });

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "https://us-central1-aiplatform.googleapis.com/v1/projects/test-project/locations/us-central1/batchPredictionJobs/123",
      expect.objectContaining({
        method: "GET",
        headers: { Authorization: "Bearer vertex-test-token" },
      }),
    );
  });

  it("throws status and body text on non-ok responses", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
      text: async () => "backend unavailable",
    });

    const { getBatchPredictionJob } = await import("./batch");
    await expect(getBatchPredictionJob("projects/test/jobs/123")).rejects.toThrow(
      "503 backend unavailable",
    );
  });
});
