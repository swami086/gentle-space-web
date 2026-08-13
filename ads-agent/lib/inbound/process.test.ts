import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Scope } from "../db/scope-sql";
import type { InboundEvent } from "../db/inbound-events";
import type { Enquiry } from "../db/enquiries";
import type { Contact } from "../db/contacts";
import type { EnquiryMessage } from "../db/enquiry-messages";
import type { MatchInput, MatchResult } from "./match";
import type { InboundMediaItem } from "./media";

const {
  matchOrCreateEnquiry,
  storeInboundMedia,
  addMessage,
  refreshEnquirySignals,
  touchLastActivity,
  markInboundEventProcessed,
  markInboundEventFailed,
} = vi.hoisted(() => ({
  matchOrCreateEnquiry: vi.fn(),
  storeInboundMedia: vi.fn(),
  addMessage: vi.fn(),
  refreshEnquirySignals: vi.fn(),
  touchLastActivity: vi.fn(),
  markInboundEventProcessed: vi.fn(),
  markInboundEventFailed: vi.fn(),
}));

vi.mock("./match", () => ({ matchOrCreateEnquiry }));
vi.mock("./media", () => ({ storeInboundMedia }));
vi.mock("../db/enquiry-messages", () => ({ addMessage }));
vi.mock("../db/enquiry-signals", () => ({ refreshEnquirySignals }));
vi.mock("../db/enquiries", () => ({ touchLastActivity }));
vi.mock("../db/inbound-events", () => ({
  markInboundEventProcessed,
  markInboundEventFailed,
}));

import { processInboundEvent } from "./process";

const scope: Scope = { kind: "org", orgId: "org-platform" };

const enquiry = {
  id: "enq-1",
  inboundReplyToken: "reply-token-1",
} as Enquiry;

const contact = { id: "contact-1" } as Contact;

const matchResult: MatchResult = { enquiry, contact, created: false };

const deps = {
  matchOrCreateEnquiry,
  storeInboundMedia,
  addMessage,
  refreshEnquirySignals,
  touchLastActivity,
  markInboundEventProcessed,
  markInboundEventFailed,
};

function makeEvent(overrides: Partial<InboundEvent> = {}): InboundEvent {
  return {
    id: "evt-1",
    orgId: scope.orgId,
    channel: "whatsapp",
    externalId: "wamid-1",
    payload: {
      id: "wamid-1",
      from: "919800000000",
      type: "text",
      text: { body: "Hello from WhatsApp" },
    },
    status: "pending",
    lastError: null,
    createdAt: "2026-08-13T12:00:00.000Z",
    processedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  for (const fn of Object.values(deps)) {
    fn.mockReset();
  }
  matchOrCreateEnquiry.mockResolvedValue(matchResult);
  storeInboundMedia.mockResolvedValue({ artifactIds: [], skipped: [] });
  addMessage.mockResolvedValue({ id: "msg-1" } as EnquiryMessage);
  refreshEnquirySignals.mockResolvedValue([]);
  touchLastActivity.mockResolvedValue(undefined);
  markInboundEventProcessed.mockResolvedValue(undefined);
  markInboundEventFailed.mockResolvedValue(undefined);
});

describe("processInboundEvent", () => {
  it("processes a text-only WhatsApp event through match, message, signals, and mark processed", async () => {
    await processInboundEvent(makeEvent(), deps);

    expect(matchOrCreateEnquiry).toHaveBeenCalledWith(scope, {
      channel: "whatsapp",
      fromPhoneRaw: "919800000000",
      profileName: null,
    } satisfies MatchInput);

    expect(storeInboundMedia).toHaveBeenCalledWith(
      scope,
      { enquiryId: enquiry.id, contactId: contact.id },
      [],
      undefined,
    );

    expect(addMessage).toHaveBeenCalledWith(scope, {
      enquiryId: enquiry.id,
      channel: "whatsapp",
      body: "Hello from WhatsApp",
      externalId: "wamid-1",
      replyToken: enquiry.inboundReplyToken,
    });

    expect(refreshEnquirySignals).toHaveBeenCalledWith(scope, enquiry.id);
    expect(touchLastActivity).toHaveBeenCalledWith(scope, enquiry.id);
    expect(markInboundEventProcessed).toHaveBeenCalledWith(scope, "evt-1");
    expect(markInboundEventFailed).not.toHaveBeenCalled();
  });

  it("stores media before addMessage for a WhatsApp image", async () => {
    const callOrder: string[] = [];

    storeInboundMedia.mockImplementation(async () => {
      callOrder.push("storeInboundMedia");
      return { artifactIds: ["artifact-1"], skipped: [] };
    });
    addMessage.mockImplementation(async () => {
      callOrder.push("addMessage");
      return { id: "msg-1" } as EnquiryMessage;
    });

    await processInboundEvent(
      makeEvent({
        payload: {
          id: "wamid-2",
          from: "919800000000",
          type: "image",
          image: { id: "media-1", mime_type: "image/jpeg" },
        },
        externalId: "wamid-2",
      }),
      deps,
    );

    expect(callOrder).toEqual(["storeInboundMedia", "addMessage"]);

    const mediaItems = storeInboundMedia.mock.calls[0][2] as InboundMediaItem[];
    expect(mediaItems).toEqual([
      {
        source: "whatsapp",
        mediaType: "image/jpeg",
        whatsappMediaId: "media-1",
      },
    ]);

    expect(addMessage).toHaveBeenCalledWith(scope, {
      enquiryId: enquiry.id,
      channel: "whatsapp",
      body: "[image]",
      externalId: "wamid-2",
      replyToken: enquiry.inboundReplyToken,
    });
  });
});
