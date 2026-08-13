import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
vi.mock("./tx", () => ({
  withTenantTransaction: (_scope: unknown, fn: (c: { query: typeof query }) => unknown) =>
    fn({ query }),
}));

import type { Scope } from "./scope-sql";
import {
  getGenerativeAnswer,
  insertGenerativeAnswer,
  listGenerativeAnswers,
} from "./generative-answers";

const ORG: Scope = { kind: "org", orgId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };
const PLATFORM: Scope = { kind: "platform", orgId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" };

const row = {
  id: "answer-1",
  org_id: ORG.orgId,
  surface: "why" as const,
  subject_type: "proposal",
  subject_id: "prop-42",
  pack_row_ids: ["row-a", "row-b"],
  openui_lang: '<WhyCard body="Because" citationIds={["row-a"]} />',
  follow_ups: ["What changed?"],
  created_by: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  created_at: new Date("2026-08-13T00:00:00.000Z"),
};

beforeEach(() => query.mockReset().mockResolvedValue({ rows: [row], rowCount: 1 }));

describe("insertGenerativeAnswer", () => {
  it("stores org_id from the caller scope and returns the row", async () => {
    const answer = await insertGenerativeAnswer(ORG, {
      surface: "why",
      subjectType: "proposal",
      subjectId: "prop-42",
      packRowIds: ["row-a", "row-b"],
      openuiLang: row.openui_lang,
      followUps: ["What changed?"],
      createdBy: row.created_by,
    });
    expect(answer.id).toBe("answer-1");
    expect(answer.orgId).toBe(ORG.orgId);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("INSERT INTO adsagent.generative_answers");
    expect(params).toEqual([
      ORG.orgId,
      "why",
      "proposal",
      "prop-42",
      ["row-a", "row-b"],
      row.openui_lang,
      JSON.stringify(["What changed?"]),
      row.created_by,
    ]);
  });

  it("defaults followUps to an empty array", async () => {
    await insertGenerativeAnswer(ORG, {
      surface: "ask",
      subjectType: "campaign",
      subjectId: "camp-1",
      packRowIds: ["row-x"],
      openuiLang: '<Card body="Hi" />',
    });
    expect(query.mock.calls[0][1][6]).toBe("[]");
    expect(query.mock.calls[0][1][7]).toBeNull();
  });

  it("rejects platform scope writes", async () => {
    await expect(
      insertGenerativeAnswer(PLATFORM, {
        surface: "why",
        subjectType: "proposal",
        subjectId: "prop-1",
        packRowIds: [],
        openuiLang: "",
      }),
    ).rejects.toThrow(/platform scope cannot write/i);
    expect(query).not.toHaveBeenCalled();
  });
});

describe("getGenerativeAnswer", () => {
  it("scopes the read by org and id", async () => {
    const answer = await getGenerativeAnswer(ORG, row.id);
    expect(answer?.surface).toBe("why");
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("FROM adsagent.generative_answers");
    expect(sql).toContain("org_id = $1::uuid");
    expect(sql).toContain("id = $2");
    expect(params).toEqual([ORG.orgId, row.id]);
  });

  it("returns null when nothing matched", async () => {
    query.mockResolvedValue({ rows: [], rowCount: 0 });
    await expect(getGenerativeAnswer(ORG, "missing")).resolves.toBeNull();
  });
});

describe("listGenerativeAnswers", () => {
  it("filters by surface, subject type, and subject id", async () => {
    const answers = await listGenerativeAnswers(ORG, {
      surface: "why",
      subjectType: "proposal",
      subjectId: "prop-42",
    });
    expect(answers).toHaveLength(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("surface = $2");
    expect(sql).toContain("subject_type = $3");
    expect(sql).toContain("subject_id = $4");
    expect(sql).toContain("ORDER BY created_at DESC");
    expect(params).toEqual([ORG.orgId, "why", "proposal", "prop-42"]);
  });
});
