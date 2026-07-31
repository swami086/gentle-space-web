import { describe, expect, it } from "vitest";
import { hashEmbeddingTextValue } from "../sync/content-hash";
import { EXTRACT_SYSTEM } from "./extract";
import { emptyQueryEntities } from "./types";
import {
  buildEntityBatchJsonl,
  buildEntityBatchJsonlLine,
  parseEntityBatchOutput,
  parseEntityBatchOutputLine,
} from "./batch-extract";

const LISTING_ID = "550e8400-e29b-41d4-a716-446655440000";

function makeOutputLine(parts: Record<string, unknown> = {}): string {
  return JSON.stringify({
    status: "",
    request: {
      contents: [{ parts: [{ text: `LISTING_ID: ${LISTING_ID}\nhello` }] }],
    },
    response: {
      candidates: [
        {
          content: {
            parts: [
              {
                text: JSON.stringify({
                  areas: [],
                  amenities: [],
                  deskTypes: [],
                  landmarks: ["Indiranagar Metro"],
                  budgetSignals: [],
                }),
              },
            ],
          },
        },
      ],
    },
    ...parts,
  });
}

describe("buildEntityBatchJsonlLine", () => {
  it("embeds the listing id prefix and reuses EXTRACT_SYSTEM", () => {
    const line = buildEntityBatchJsonlLine(LISTING_ID, "hello");
    const parsed = JSON.parse(line) as {
      request?: {
        systemInstruction?: { parts?: { text?: string }[] };
        contents?: { parts?: { text?: string }[] }[];
        generationConfig?: Record<string, unknown>;
      };
    };

    expect(parsed.request?.systemInstruction?.parts?.[0]?.text).toContain(EXTRACT_SYSTEM);
    expect(parsed.request?.systemInstruction?.parts?.[0]?.text).toContain("LISTING_ID:");
    expect(parsed.request?.contents?.[0]?.parts?.[0]?.text).toBe(`LISTING_ID: ${LISTING_ID}\nhello`);
    expect(parsed.request?.generationConfig).toEqual({
      responseMimeType: "application/json",
      temperature: 0,
    });
  });

  it("joins lines with trailing newline", () => {
    expect(
      buildEntityBatchJsonl([
        { id: LISTING_ID, text: "hello" },
        { id: LISTING_ID, text: "world" },
      ]),
    ).toBe(
      `${buildEntityBatchJsonlLine(LISTING_ID, "hello")}\n${buildEntityBatchJsonlLine(
        LISTING_ID,
        "world",
      )}\n`,
    );
  });
});

describe("parseEntityBatchOutputLine", () => {
  it("recovers the listing id from the echoed request text and normalizes entities", () => {
    expect(parseEntityBatchOutputLine(makeOutputLine())).toEqual({
      listingId: LISTING_ID,
      submittedText: "hello",
      submittedHash: hashEmbeddingTextValue("hello"),
      entities: {
        ...emptyQueryEntities(),
        landmarks: ["indiranagar metro"],
      },
      failed: false,
    });
  });

  it("marks non-empty status lines as failed", () => {
    expect(
      parseEntityBatchOutputLine(
        JSON.stringify({
          status: "FAILED",
          request: {
            contents: [{ parts: [{ text: `LISTING_ID: ${LISTING_ID}\nhello` }] }],
          },
          response: {},
        }),
      ),
    ).toEqual({
      listingId: LISTING_ID,
      submittedText: "hello",
      submittedHash: hashEmbeddingTextValue("hello"),
      entities: null,
      failed: true,
    });
  });

  it("treats unparseable response text as a failed listing", () => {
    expect(
      parseEntityBatchOutputLine(
        JSON.stringify({
          status: "",
          request: {
            contents: [{ parts: [{ text: `LISTING_ID: ${LISTING_ID}\nhello` }] }],
          },
          response: {
            candidates: [
              {
                content: {
                  parts: [{ text: "{\"areas\": [" }],
                },
              },
            ],
          },
        }),
      ),
    ).toEqual({
      listingId: LISTING_ID,
      submittedText: "hello",
      submittedHash: hashEmbeddingTextValue("hello"),
      entities: null,
      failed: true,
    });
  });

  it("returns a null listing id when the request text lacks a UUID", () => {
    expect(
      parseEntityBatchOutputLine(
        JSON.stringify({
          status: "",
          request: {
            contents: [{ parts: [{ text: "hello" }] }],
          },
          response: {},
        }),
      ),
    ).toEqual({
      listingId: null,
      submittedText: null,
      submittedHash: null,
      entities: null,
      failed: false,
    });
  });

  it("keeps the full submitted listing text after the id prefix", () => {
    expect(
      parseEntityBatchOutputLine(
        makeOutputLine({
          request: {
            contents: [{ parts: [{ text: `LISTING_ID: ${LISTING_ID}\nhello\nworld` }] }],
          },
        }),
      ),
    ).toEqual({
      listingId: LISTING_ID,
      submittedText: "hello\nworld",
      submittedHash: hashEmbeddingTextValue("hello\nworld"),
      entities: {
        ...emptyQueryEntities(),
        landmarks: ["indiranagar metro"],
      },
      failed: false,
    });
  });
});

describe("parseEntityBatchOutput", () => {
  it("merges files in order of appearance and counts malformed lines as skipped", () => {
    const secondId = "550e8400-e29b-41d4-a716-446655440001";
    const applied = parseEntityBatchOutput([
      [
        makeOutputLine({
          request: { contents: [{ parts: [{ text: `LISTING_ID: ${secondId}\nhello` }] }] },
          response: {
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        areas: ["Indiranagar"],
                        amenities: [],
                        deskTypes: [],
                        landmarks: [],
                        budgetSignals: [],
                      }),
                    },
                  ],
                },
              },
            ],
          },
        }),
        "not json",
      ].join("\n"),
      [
        JSON.stringify({
          status: "",
          request: {
            contents: [{ parts: [{ text: "hello" }] }],
          },
          response: {},
        }),
        makeOutputLine(),
      ].join("\n"),
    ]);

    expect(Array.from(applied.applied.entries())).toEqual([
      [
        secondId,
        {
          entities: {
            areas: ["indiranagar"],
            amenities: [],
            deskTypes: [],
            landmarks: [],
            budgetSignals: [],
          },
          submittedText: "hello",
          submittedHash: hashEmbeddingTextValue("hello"),
        },
      ],
      [
        LISTING_ID,
        {
          entities: {
            ...emptyQueryEntities(),
            landmarks: ["indiranagar metro"],
          },
          submittedText: "hello",
          submittedHash: hashEmbeddingTextValue("hello"),
        },
      ],
    ]);
    expect(applied.failed).toBe(0);
    expect(applied.skipped).toBe(2);
  });
});
