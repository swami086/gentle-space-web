import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./tx", () => ({
  withTenantTransaction: async (_scope: unknown, fn: (c: unknown) => Promise<unknown>) =>
    fn({ query }),
}));

import type { Scope } from "./scope-sql";
import {
  createContact,
  getContactById,
  markContactMergedAway,
  markContactMergedIntoPerson,
  markContactSyncFailed,
  markContactSynced,
} from "./contacts";

const scope: Scope = { kind: "org", orgId: "org-1" };

const row = {
  id: "contact-1",
  org_id: "org-1",
  twenty_person_id: null,
  name: "Asha Rao",
  phone: "+919800000000",
  email: null,
  sync_state: "pending",
  synced_at: null,
  merged_into: null,
  sync_attempts: 0,
};

beforeEach(() => query.mockReset());

describe("createContact", () => {
  it("inserts under the scope's org and starts life pending", async () => {
    query.mockResolvedValue({ rows: [row] });
    const contact = await createContact(scope, { name: "Asha Rao", phone: "+919800000000" });
    expect(contact).toEqual({
      id: "contact-1",
      orgId: "org-1",
      twentyPersonId: null,
      name: "Asha Rao",
      phone: "+919800000000",
      email: null,
      syncState: "pending",
      syncedAt: null,
      mergedInto: null,
      syncAttempts: 0,
    });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("INSERT INTO adsagent.contacts");
    expect(params).toEqual(["org-1", "Asha Rao", "+919800000000", null]);
  });

  it("refuses platform scope", async () => {
    await expect(
      createContact({ kind: "platform", orgId: "org-1" }, { name: "Asha Rao" }),
    ).rejects.toThrow(/platform scope cannot write/i);
  });
});

describe("getContactById", () => {
  it("returns null when nothing matches", async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(getContactById(scope, "missing")).resolves.toBeNull();
  });

  it("follows exactly one merge hop to the survivor", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ ...row, merged_into: "contact-2", sync_state: "merged_away" }] })
      .mockResolvedValueOnce({ rows: [{ ...row, id: "contact-2", sync_state: "synced" }] });
    const contact = await getContactById(scope, "contact-1");
    expect(contact?.id).toBe("contact-2");
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("logs and stops rather than following a second hop", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    query
      .mockResolvedValueOnce({ rows: [{ ...row, merged_into: "contact-2" }] })
      .mockResolvedValueOnce({ rows: [{ ...row, id: "contact-2", merged_into: "contact-3" }] });
    const contact = await getContactById(scope, "contact-1");
    expect(contact?.id).toBe("contact-2");
    expect(query).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("merge chain longer than one hop"),
      expect.objectContaining({ contactId: "contact-1" }),
    );
    warn.mockRestore();
  });
});

describe("sync bookkeeping", () => {
  it("markContactSynced overwrites the cache wholesale with Twenty's values", async () => {
    query.mockResolvedValue({ rows: [] });
    await markContactSynced(scope, "contact-1", "person-9", {
      name: "Asha R Rao",
      phone: "+919800000001",
      email: "asha@example.com",
    });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/sync_state\s*=\s*'synced'/);
    expect(sql).toMatch(/synced_at\s*=\s*now\(\)/);
    expect(params).toEqual([
      "org-1",
      "contact-1",
      "person-9",
      "Asha R Rao",
      "+919800000001",
      "asha@example.com",
    ]);
  });

  it("markContactSyncFailed increments attempts so backoff can widen", async () => {
    query.mockResolvedValue({ rows: [] });
    await markContactSyncFailed(scope, "contact-1", "connect ECONNREFUSED");
    const [sql] = query.mock.calls[0];
    expect(sql).toMatch(/sync_attempts\s*=\s*adsagent\.contacts\.sync_attempts \+ 1/);
    expect(sql).toMatch(/sync_state\s*=\s*'failed'/);
  });

  it("markContactMergedAway tombstones the loser and points at the survivor", async () => {
    query.mockResolvedValue({ rows: [] });
    await markContactMergedAway(scope, "contact-1", "contact-2");
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("sync_state = 'merged_away'");
    expect(sql).toContain("merged_into = $3");
    expect(params).toEqual(["org-1", "contact-1", "contact-2"]);
  });

  it("markContactMergedIntoPerson resolves the survivor by Twenty person id", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: "contact-2" }] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(markContactMergedIntoPerson(scope, "contact-1", "person-9")).resolves.toBe(
      "contact-2",
    );
    expect(String(query.mock.calls[1][0])).toContain("sync_state = 'merged_away'");
  });

  it("markContactMergedIntoPerson returns null when no local row holds that person yet", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(markContactMergedIntoPerson(scope, "contact-1", "person-9")).resolves.toBeNull();
    expect(query).toHaveBeenCalledTimes(1);
  });
});
