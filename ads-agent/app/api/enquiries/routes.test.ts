import { beforeEach, describe, expect, it, vi } from "vitest";

const guard = vi.fn();
const createContact = vi.fn();
const createEnquiry = vi.fn();
const listEnquiries = vi.fn();
const countEnquiriesByState = vi.fn();
const getEnquiryById = vi.fn();
const setReplyState = vi.fn();
const addMessage = vi.fn();
const listMessages = vi.fn();
const logCall = vi.fn();
const logStateChange = vi.fn();
const listActivities = vi.fn();
const getRequirement = vi.fn();
const upsertRequirement = vi.fn();
const createRevision = vi.fn();
const withTenantTransaction = vi.fn(
  async (_scope: unknown, fn: (c: unknown) => Promise<unknown>) => fn({}),
);

vi.mock("@/lib/auth/guard", () => ({ guard }));
vi.mock("@/lib/db/contacts", () => ({ createContact }));
vi.mock("@/lib/db/enquiries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/enquiries")>();
  return {
    ...actual,
    createEnquiry,
    listEnquiries,
    countEnquiriesByState,
    getEnquiryById,
    setReplyState,
  };
});
vi.mock("@/lib/db/enquiry-messages", () => ({ addMessage, listMessages }));
vi.mock("@/lib/db/enquiry-activities", () => ({
  logCall,
  logStateChange,
  listActivities,
  CALL_OUTCOMES: [
    "spoke_interested",
    "spoke_not_interested",
    "no_answer",
    "voicemail",
    "wrong_number",
    "callback_requested",
  ],
}));
vi.mock("@/lib/db/enquiry-requirements", () => ({
  getRequirement,
  upsertRequirement,
  createRevision,
}));
vi.mock("@/lib/db/tx", () => ({ withTenantTransaction }));

const scope = { kind: "org", orgId: "org-1" } as const;
const session = { userId: "user-7", email: "a@b.c", orgId: "org-1", role: "operator" as const };

beforeEach(() => {
  for (const fn of [
    guard,
    createContact,
    createEnquiry,
    listEnquiries,
    countEnquiriesByState,
    getEnquiryById,
    setReplyState,
    addMessage,
    listMessages,
    logCall,
    logStateChange,
    listActivities,
    getRequirement,
    upsertRequirement,
    createRevision,
  ]) {
    fn.mockReset();
  }
  guard.mockResolvedValue({ ok: true, session, scope });
});

describe("GET /api/enquiries", () => {
  it("returns the list and the badge counts", async () => {
    listEnquiries.mockResolvedValue([{ id: "enq-1" }]);
    countEnquiriesByState.mockResolvedValue({ waiting: 1, called: 0, closed: 0 });
    const { GET } = await import("./route");
    const res = await GET(new Request("http://x/api/enquiries?state=waiting"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      enquiries: [{ id: "enq-1" }],
      counts: { waiting: 1, called: 0, closed: 0 },
    });
    expect(listEnquiries).toHaveBeenCalledWith(scope, { replyState: "waiting" });
  });

  it("rejects an unknown state rather than silently listing everything", async () => {
    const { GET } = await import("./route");
    const res = await GET(new Request("http://x/api/enquiries?state=nonsense"));
    expect(res.status).toBe(400);
  });

  it("passes the auth failure response straight through", async () => {
    guard.mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 401 }),
    });
    const { GET } = await import("./route");
    expect((await GET(new Request("http://x/api/enquiries"))).status).toBe(401);
  });
});

describe("POST /api/enquiries", () => {
  it("creates contact, enquiry and first message in one transaction and touches no CRM", async () => {
    createContact.mockResolvedValue({ id: "contact-1" });
    createEnquiry.mockResolvedValue({ id: "enq-1" });
    addMessage.mockResolvedValue({ id: "msg-1" });
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://x/api/enquiries", {
        method: "POST",
        body: JSON.stringify({
          name: "Asha Rao",
          phone: "+919800000000",
          brief: "38 desks in HSR",
        }),
      }),
    );
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({ enquiryId: "enq-1", contactId: "contact-1" });
    expect(withTenantTransaction).toHaveBeenCalledOnce();
    expect(addMessage.mock.calls[0][1]).toMatchObject({ channel: "web_form" });
  });

  it("rejects a body with no name or phone", async () => {
    const { POST } = await import("./route");
    const res = await POST(
      new Request("http://x/api/enquiries", { method: "POST", body: JSON.stringify({}) }),
    );
    expect(res.status).toBe(400);
    expect(createEnquiry).not.toHaveBeenCalled();
  });
});

describe("GET /api/enquiries/[id]", () => {
  it("returns 404, not 403, for another tenant's enquiry", async () => {
    getEnquiryById.mockResolvedValue(null);
    const { GET } = await import("./[id]/route");
    const res = await GET(new Request("http://x"), { params: Promise.resolve({ id: "enq-other" }) });
    expect(res.status).toBe(404);
  });

  it("returns the enquiry with its thread, log and requirement", async () => {
    getEnquiryById.mockResolvedValue({ id: "enq-1" });
    listMessages.mockResolvedValue([{ id: "msg-1" }]);
    listActivities.mockResolvedValue([{ id: "act-1" }]);
    getRequirement.mockResolvedValue({ enquiryId: "enq-1", desksMin: 38 });
    const { GET } = await import("./[id]/route");
    const res = await GET(new Request("http://x"), { params: Promise.resolve({ id: "enq-1" }) });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      enquiry: { id: "enq-1" },
      messages: [{ id: "msg-1" }],
      activities: [{ id: "act-1" }],
      requirement: { enquiryId: "enq-1", desksMin: 38 },
    });
  });
});

describe("PATCH /api/enquiries/[id]/state", () => {
  it("sets the state and logs the change", async () => {
    setReplyState.mockResolvedValue({ id: "enq-1", replyState: "called" });
    logStateChange.mockResolvedValue({ id: "act-1" });
    const { PATCH } = await import("./[id]/state/route");
    const res = await PATCH(
      new Request("http://x", { method: "PATCH", body: JSON.stringify({ replyState: "called" }) }),
      { params: Promise.resolve({ id: "enq-1" }) },
    );
    expect(res.status).toBe(200);
    expect(logStateChange).toHaveBeenCalledWith(scope, {
      enquiryId: "enq-1",
      actorUserId: "user-7",
      body: "Reply state set to called",
    });
  });

  it("404s when the update matched nothing", async () => {
    setReplyState.mockResolvedValue(null);
    const { PATCH } = await import("./[id]/state/route");
    const res = await PATCH(
      new Request("http://x", { method: "PATCH", body: JSON.stringify({ replyState: "closed" }) }),
      { params: Promise.resolve({ id: "enq-other" }) },
    );
    expect(res.status).toBe(404);
  });

  it("rejects an unknown reply state", async () => {
    const { PATCH } = await import("./[id]/state/route");
    const res = await PATCH(
      new Request("http://x", { method: "PATCH", body: JSON.stringify({ replyState: "maybe" }) }),
      { params: Promise.resolve({ id: "enq-1" }) },
    );
    expect(res.status).toBe(400);
    expect(setReplyState).not.toHaveBeenCalled();
  });
});

describe("POST /api/enquiries/[id]/calls", () => {
  it("logs the call against the session user", async () => {
    getEnquiryById.mockResolvedValue({ id: "enq-1" });
    logCall.mockResolvedValue({ id: "act-1" });
    const { POST } = await import("./[id]/calls/route");
    const res = await POST(
      new Request("http://x", {
        method: "POST",
        body: JSON.stringify({
          outcome: "spoke_interested",
          direction: "outgoing",
          seconds: 240,
          occurredAt: "2026-08-12T05:00:00.000Z",
          notes: "Wants a tour",
        }),
      }),
      { params: Promise.resolve({ id: "enq-1" }) },
    );
    expect(res.status).toBe(201);
    expect(logCall).toHaveBeenCalledWith(scope, {
      enquiryId: "enq-1",
      actorUserId: "user-7",
      outcome: "spoke_interested",
      direction: "outgoing",
      seconds: 240,
      occurredAt: "2026-08-12T05:00:00.000Z",
      body: "Wants a tour",
    });
  });

  it("rejects an outcome outside the vocabulary (C2)", async () => {
    getEnquiryById.mockResolvedValue({ id: "enq-1" });
    const { POST } = await import("./[id]/calls/route");
    const res = await POST(
      new Request("http://x", {
        method: "POST",
        body: JSON.stringify({
          outcome: "had a nice chat",
          direction: "outgoing",
          seconds: 1,
          occurredAt: "2026-08-12T05:00:00.000Z",
        }),
      }),
      { params: Promise.resolve({ id: "enq-1" }) },
    );
    expect(res.status).toBe(400);
    expect(logCall).not.toHaveBeenCalled();
  });

  it("404s before logging when the enquiry is not this tenant's", async () => {
    getEnquiryById.mockResolvedValue(null);
    const { POST } = await import("./[id]/calls/route");
    const res = await POST(
      new Request("http://x", {
        method: "POST",
        body: JSON.stringify({
          outcome: "no_answer",
          direction: "outgoing",
          seconds: 0,
          occurredAt: "2026-08-12T05:00:00.000Z",
        }),
      }),
      { params: Promise.resolve({ id: "enq-other" }) },
    );
    expect(res.status).toBe(404);
    expect(logCall).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/enquiries/[id]/requirements", () => {
  it("writes the requirement and records a manual revision (A4)", async () => {
    getEnquiryById.mockResolvedValue({ id: "enq-1" });
    upsertRequirement.mockResolvedValue({ enquiryId: "enq-1", desksMin: 38 });
    createRevision.mockResolvedValue({ id: "rev-1" });
    const { PATCH } = await import("./[id]/requirements/route");
    const res = await PATCH(
      new Request("http://x", {
        method: "PATCH",
        body: JSON.stringify({ desksMin: 38, desksMax: 38 }),
      }),
      { params: Promise.resolve({ id: "enq-1" }) },
    );
    expect(res.status).toBe(200);
    expect(createRevision.mock.calls[0][1]).toMatchObject({ source: "manual" });
  });
});
