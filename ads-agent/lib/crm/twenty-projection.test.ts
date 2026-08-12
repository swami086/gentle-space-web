// ads-agent/lib/crm/twenty-projection.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  claimPendingContacts,
  markContactSynced,
  markContactSyncFailed,
  markContactMergedIntoPerson,
  listEnquiriesAwaitingOpportunity,
  setTwentyOpportunityId,
  claimUnsyncedActivities,
  markActivitySynced,
  touchTwentyLastSync,
  getTwentyClient,
} = vi.hoisted(() => ({
  claimPendingContacts: vi.fn(),
  markContactSynced: vi.fn(),
  markContactSyncFailed: vi.fn(),
  markContactMergedIntoPerson: vi.fn(),
  listEnquiriesAwaitingOpportunity: vi.fn(),
  setTwentyOpportunityId: vi.fn(),
  claimUnsyncedActivities: vi.fn(),
  markActivitySynced: vi.fn(),
  touchTwentyLastSync: vi.fn(),
  getTwentyClient: vi.fn(),
}));

vi.mock("../db/contacts", () => ({
  claimPendingContacts,
  markContactSynced,
  markContactSyncFailed,
  markContactMergedIntoPerson,
}));
vi.mock("../db/enquiries", () => ({
  listEnquiriesAwaitingOpportunity,
  setTwentyOpportunityId,
}));
vi.mock("../db/enquiry-activities", () => ({ claimUnsyncedActivities, markActivitySynced }));
vi.mock("../db/twenty-connections", () => ({ touchTwentyLastSync }));
vi.mock("../db/cross-tenant", () => ({
  withCrossTenantRead: async (_actor: string, fn: (c: unknown) => Promise<unknown>) => fn({}),
}));
vi.mock("./twenty-client", () => ({ getTwentyClient }));

import {
  REPLY_STATE_TO_STAGE,
  formatActivityNote,
  projectPendingActivities,
  projectPendingContacts,
} from "./twenty-projection";

const contact = {
  id: "contact-1",
  orgId: "org-1",
  twentyPersonId: null,
  name: "Asha Rao",
  phone: "+919800000000",
  email: null,
  syncState: "pending" as const,
  syncedAt: null,
  mergedInto: null,
  syncAttempts: 0,
};

function twentyClient(overrides: Record<string, unknown> = {}) {
  return {
    orgId: "org-1",
    version: "1.9.0",
    upsertPerson: vi.fn(async () => ({
      id: "person-9",
      firstName: "Asha",
      lastName: "Rao",
      phone: "+919800000001",
      email: null,
    })),
    createOpportunity: vi.fn(async () => ({ id: "opp-9" })),
    updateOpportunityStage: vi.fn(async () => undefined),
    createNote: vi.fn(async () => ({ id: "note-9" })),
    listOpportunities: vi.fn(async () => []),
    getOpportunity: vi.fn(async () => null),
    ...overrides,
  };
}

beforeEach(() => {
  for (const fn of [
    claimPendingContacts,
    markContactSynced,
    markContactSyncFailed,
    markContactMergedIntoPerson,
    listEnquiriesAwaitingOpportunity,
    setTwentyOpportunityId,
    claimUnsyncedActivities,
    markActivitySynced,
    touchTwentyLastSync,
    getTwentyClient,
  ]) {
    fn.mockReset();
  }
  claimPendingContacts.mockResolvedValue([]);
  claimUnsyncedActivities.mockResolvedValue([]);
  listEnquiriesAwaitingOpportunity.mockResolvedValue([]);
});

describe("REPLY_STATE_TO_STAGE", () => {
  it("maps waiting and called, and deliberately refuses to guess for closed", () => {
    expect(REPLY_STATE_TO_STAGE).toEqual({
      waiting: "NEW_BRIEF",
      called: "SHORTLIST",
      closed: null,
    });
  });
});

describe("projectPendingContacts", () => {
  it("writes back Twenty's canonical values, because its dedup is the authority", async () => {
    claimPendingContacts.mockResolvedValue([contact]);
    const client = twentyClient();
    getTwentyClient.mockResolvedValue(client);

    const result = await projectPendingContacts();

    expect(result).toEqual({ attempted: 1, succeeded: 1, failed: 0 });
    expect(markContactSynced).toHaveBeenCalledWith(
      { kind: "org", orgId: "org-1" },
      "contact-1",
      "person-9",
      { name: "Asha Rao", phone: "+919800000001", email: null },
    );
    expect(touchTwentyLastSync).toHaveBeenCalledWith("org-1");
  });

  it("creates the opportunity for every enquiry still missing one", async () => {
    claimPendingContacts.mockResolvedValue([contact]);
    listEnquiriesAwaitingOpportunity.mockResolvedValue([
      {
        id: "enq-1",
        contactName: "Asha Rao",
        listingUrl: "https://gentlespace.in/spaces/hsr-1",
        listingId: null,
        replyState: "waiting",
      },
    ]);
    const client = twentyClient();
    getTwentyClient.mockResolvedValue(client);

    await projectPendingContacts();

    expect(client.createOpportunity).toHaveBeenCalledWith({
      name: "Asha Rao",
      personId: "person-9",
      stage: "NEW_BRIEF",
      listingUrl: "https://gentlespace.in/spaces/hsr-1",
      listingName: null,
    });
    expect(setTwentyOpportunityId).toHaveBeenCalledWith(
      { kind: "org", orgId: "org-1" },
      "enq-1",
      "opp-9",
    );
  });

  it("tombstones the loser when the unique person id collides, which is a dedup merge", async () => {
    claimPendingContacts.mockResolvedValue([contact]);
    getTwentyClient.mockResolvedValue(twentyClient());
    const collision = Object.assign(new Error("duplicate key"), { code: "23505" });
    markContactSynced.mockRejectedValue(collision);
    markContactMergedIntoPerson.mockResolvedValue("contact-2");

    const result = await projectPendingContacts();

    expect(markContactMergedIntoPerson).toHaveBeenCalledWith(
      { kind: "org", orgId: "org-1" },
      "contact-1",
      "person-9",
    );
    expect(result.succeeded).toBe(1);
    expect(markContactSyncFailed).not.toHaveBeenCalled();
  });

  it("records the failure on the contact and never on the connection state", async () => {
    claimPendingContacts.mockResolvedValue([contact]);
    getTwentyClient.mockRejectedValue(new Error("connect ECONNREFUSED"));

    const result = await projectPendingContacts();

    expect(result).toEqual({ attempted: 1, succeeded: 0, failed: 1 });
    expect(markContactSyncFailed).toHaveBeenCalledWith(
      { kind: "org", orgId: "org-1" },
      "contact-1",
      expect.stringContaining("ECONNREFUSED"),
    );
    expect(touchTwentyLastSync).not.toHaveBeenCalled();
  });
});

describe("formatActivityNote", () => {
  it("renders a call as something a human reading Twenty can use", () => {
    expect(
      formatActivityNote({
        id: "act-1",
        orgId: "org-1",
        enquiryId: "enq-1",
        twentyOpportunityId: "opp-9",
        kind: "call",
        body: "Wants a tour on Friday",
        callOutcome: "spoke_interested",
        callSeconds: 240,
        occurredAt: "2026-08-12T05:00:00.000Z",
      }),
    ).toBe(
      "Call on 2026-08-12: spoke interested (4m 0s)\n\nWants a tour on Friday",
    );
  });

  it("renders a note without inventing call fields", () => {
    expect(
      formatActivityNote({
        id: "act-2",
        orgId: "org-1",
        enquiryId: "enq-1",
        twentyOpportunityId: "opp-9",
        kind: "note",
        body: "Sent the shortlist",
        callOutcome: null,
        callSeconds: null,
        occurredAt: "2026-08-12T06:00:00.000Z",
      }),
    ).toBe("Note on 2026-08-12\n\nSent the shortlist");
  });
});

describe("projectPendingActivities", () => {
  it("writes the note and stamps the activity synced (C7)", async () => {
    claimUnsyncedActivities.mockResolvedValue([
      {
        id: "act-1",
        orgId: "org-1",
        enquiryId: "enq-1",
        twentyOpportunityId: "opp-9",
        kind: "call",
        body: "Wants a tour on Friday",
        callOutcome: "spoke_interested",
        callSeconds: 240,
        occurredAt: "2026-08-12T05:00:00.000Z",
      },
    ]);
    const client = twentyClient();
    getTwentyClient.mockResolvedValue(client);

    const result = await projectPendingActivities();

    expect(client.createNote).toHaveBeenCalledWith("opp-9", expect.stringContaining("Call on"));
    expect(markActivitySynced).toHaveBeenCalledWith({ kind: "org", orgId: "org-1" }, "act-1");
    expect(result).toEqual({ attempted: 1, succeeded: 1, failed: 0 });
  });

  it("leaves the activity unsynced when Twenty is down, so the next tick retries", async () => {
    claimUnsyncedActivities.mockResolvedValue([
      {
        id: "act-1",
        orgId: "org-1",
        enquiryId: "enq-1",
        twentyOpportunityId: "opp-9",
        kind: "note",
        body: "Sent the shortlist",
        callOutcome: null,
        callSeconds: null,
        occurredAt: "2026-08-12T06:00:00.000Z",
      },
    ]);
    getTwentyClient.mockRejectedValue(new Error("no Twenty connection for org org-1"));

    const result = await projectPendingActivities();

    expect(markActivitySynced).not.toHaveBeenCalled();
    expect(result).toEqual({ attempted: 1, succeeded: 0, failed: 1 });
  });
});
