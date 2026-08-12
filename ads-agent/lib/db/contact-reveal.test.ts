import { beforeEach, describe, expect, it, vi } from "vitest";

const { query, recordAccess } = vi.hoisted(() => ({
  query: vi.fn(),
  recordAccess: vi.fn(),
}));
vi.mock("./tx", () => ({
  withTenantTransaction: async (_scope: unknown, fn: (c: unknown) => Promise<unknown>) =>
    fn({ query }),
}));
vi.mock("./access-log", () => ({ recordAccess }));

import { revealContact } from "./contact-reveal";

const scope = { kind: "org", orgId: "org-1" } as const;

beforeEach(() => {
  query.mockReset();
  recordAccess.mockReset().mockResolvedValue(undefined);
});

describe("revealContact", () => {
  it("prefers the Twenty-reconciled value and says so", async () => {
    query.mockResolvedValue({
      rows: [
        {
          captured_name: "Asha Rao",
          captured_phone: "+919800000000",
          captured_email: null,
          contact_name: "Asha R Rao",
          contact_phone: "+919800000001",
          contact_email: "asha@example.com",
          sync_state: "synced",
        },
      ],
    });
    await expect(revealContact(scope, "enq-1", "user-7")).resolves.toEqual({
      name: "Asha R Rao",
      phone: "+919800000001",
      email: "asha@example.com",
      source: "twenty",
    });
  });

  it("falls back to the as-captured value when the contact has not synced", async () => {
    query.mockResolvedValue({
      rows: [
        {
          captured_name: "Asha Rao",
          captured_phone: "+919800000000",
          captured_email: null,
          contact_name: "Asha Rao",
          contact_phone: null,
          contact_email: null,
          sync_state: "pending",
        },
      ],
    });
    await expect(revealContact(scope, "enq-1", "user-7")).resolves.toEqual({
      name: "Asha Rao",
      phone: "+919800000000",
      email: null,
      source: "captured",
    });
  });

  it("audits the reveal in the same transaction as the read", async () => {
    query.mockResolvedValue({
      rows: [
        {
          captured_name: "Asha Rao",
          captured_phone: "+919800000000",
          captured_email: null,
          contact_name: null,
          contact_phone: null,
          contact_email: null,
          sync_state: null,
        },
      ],
    });
    await revealContact(scope, "enq-1", "user-7");
    expect(recordAccess).toHaveBeenCalledWith(
      scope,
      {
        actorKind: "user",
        actorRef: "user-7",
        action: "contact.reveal",
        subjectKind: "enquirer",
        subjectRef: "enq-1",
      },
      expect.anything(),
    );
  });

  it("returns null and audits nothing for another tenant's enquiry", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(revealContact(scope, "enq-other", "user-7")).resolves.toBeNull();
    expect(recordAccess).not.toHaveBeenCalled();
  });

  it("does not reveal a suppressed enquiry's contact", async () => {
    query.mockResolvedValue({ rows: [] });
    await revealContact(scope, "enq-1", "user-7");
    expect(String(query.mock.calls[0][0])).toContain("lifecycle = 'active'");
  });
});
