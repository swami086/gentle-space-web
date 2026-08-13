import { describe, it, expect, vi } from "vitest";
import type { Scope } from "../db/scope-sql";
import type { ArtifactRow } from "../artifacts/store";
import type { InboundMediaItem } from "./media";

const SCOPE: Scope = {
  kind: "org",
  orgId: "11111111-1111-1111-1111-111111111111",
};

const SUBJECT = {
  enquiryId: "22222222-2222-2222-2222-222222222222",
  contactId: "33333333-3333-3333-3333-333333333333",
};

const NOW = new Date("2026-08-13T12:00:00Z");

function makeArtifact(
  id: string,
  input: { contentType: string; mediaType?: string; body: Uint8Array; subjectRefs?: string[] },
): ArtifactRow {
  return {
    id,
    orgId: SCOPE.orgId,
    storageKey: `artifacts/${SCOPE.orgId}/inbound_media/${id}`,
    contentType: input.contentType as ArtifactRow["contentType"],
    mediaType: input.mediaType ?? "application/octet-stream",
    byteSize: input.body.byteLength,
    checksum: "test-checksum",
    subjectRefs: input.subjectRefs ?? [],
    createdAt: NOW,
    eraseAfter: NOW,
    erasedAt: null,
  };
}

describe("storeInboundMedia", () => {
  it("stores inbound media items and returns artifact ids", async () => {
    const fetched = new Uint8Array([1, 2, 3]);
    const inline = new Uint8Array([4, 5]);

    const fetchWhatsAppMedia = vi.fn(async (_mediaId: string) => ({
      bytes: fetched,
      mime: "image/jpeg",
    }));

    let nextId = 1;
    const putArtifactImpl = vi.fn(async (_scope: Scope, input: unknown): Promise<ArtifactRow> => {
      const id = `a${nextId++}`;
      const { contentType, mediaType, body, subjectRefs } = input as {
        contentType: string;
        mediaType?: string;
        body: Uint8Array;
        subjectRefs?: string[];
      };
      return makeArtifact(id, { contentType, mediaType, body, subjectRefs });
    });

    const { storeInboundMedia } = await import("./media");

    const items: InboundMediaItem[] = [
      { source: "whatsapp", mediaType: "image/jpeg", whatsappMediaId: "m1" },
      {
        source: "postmark",
        mediaType: "image/png",
        bytes: inline,
        filenameHint: "inline.png",
      },
    ];

    const result = await storeInboundMedia(SCOPE, SUBJECT, items, {
      fetchWhatsAppMedia,
      putArtifact: putArtifactImpl as never,
      inboundMediaMaxBytes: 10,
    });

    expect(fetchWhatsAppMedia).toHaveBeenCalledWith("m1");
    expect(putArtifactImpl).toHaveBeenCalledTimes(2);
    expect(result.artifactIds).toEqual(["a1", "a2"]);
    expect(result.skipped).toEqual([]);

    const firstCall = putArtifactImpl.mock.calls[0][1] as {
      contentType: string;
      mediaType?: string;
      body: Uint8Array;
      subjectRefs?: string[];
    };
    expect(firstCall.contentType).toBe("inbound_media");
    expect(firstCall.subjectRefs).toEqual([SUBJECT.enquiryId, SUBJECT.contactId]);
    expect(firstCall.body).toBeInstanceOf(Uint8Array);
    expect(firstCall.mediaType).toBe("image/jpeg");

    const secondCall = putArtifactImpl.mock.calls[1][1] as {
      mediaType?: string;
      body: Uint8Array;
    };
    expect(secondCall.mediaType).toBe("image/png");
    expect(secondCall.body).toBe(inline);
  });

  it("skips items whose byte size exceeds the cap without throwing", async () => {
    const bytes = new Uint8Array(5);
    const putArtifactImpl = vi.fn();
    const fetchWhatsAppMedia = vi.fn(async () => ({
      bytes,
      mime: "image/jpeg",
    }));

    const { storeInboundMedia } = await import("./media");

    const items: InboundMediaItem[] = [
      { source: "whatsapp", mediaType: "image/jpeg", whatsappMediaId: "oversize" },
    ];

    const result = await storeInboundMedia(SCOPE, SUBJECT, items, {
      fetchWhatsAppMedia,
      putArtifact: putArtifactImpl as never,
      inboundMediaMaxBytes: 4,
    });

    expect(putArtifactImpl).not.toHaveBeenCalled();
    expect(result.artifactIds).toEqual([]);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0]).toContain("oversize");
  });

  it("returns empty arrays for an empty list without calling dependencies", async () => {
    const putArtifactImpl = vi.fn();
    const fetchWhatsAppMedia = vi.fn();

    const { storeInboundMedia } = await import("./media");

    const result = await storeInboundMedia(SCOPE, SUBJECT, [], {
      fetchWhatsAppMedia,
      putArtifact: putArtifactImpl as never,
      inboundMediaMaxBytes: 1,
    });

    expect(result).toEqual({ artifactIds: [], skipped: [] });
    expect(putArtifactImpl).not.toHaveBeenCalled();
    expect(fetchWhatsAppMedia).not.toHaveBeenCalled();
  });
}
);

