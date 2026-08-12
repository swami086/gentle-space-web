import { describe, it, expect } from "vitest";
import {
  ARTIFACT_CONTENT_TYPES,
  artifactStorageKey,
  orgIdFromKey,
  tenantPrefix,
} from "./key";
import type { Scope } from "../db/scope-sql";

const ORG = "11111111-1111-1111-1111-111111111111";
const ID = "22222222-2222-2222-2222-222222222222";
const scope: Scope = { kind: "org", orgId: ORG };

describe("artifactStorageKey", () => {
  it("builds artifacts/{org_id}/{content_type}/{id}", () => {
    expect(artifactStorageKey(scope, "draft", ID)).toBe(`artifacts/${ORG}/draft/${ID}`);
  });

  it("covers exactly the five content types the CHECK constraint allows", () => {
    expect([...ARTIFACT_CONTENT_TYPES]).toEqual([
      "talking_points",
      "draft",
      "context_pack",
      "trace_payload",
      "call_recording",
    ]);
  });

  it("refuses an org id that is not a uuid, so a request param cannot become a prefix", () => {
    expect(() => artifactStorageKey({ kind: "org", orgId: "../other" }, "draft", ID)).toThrow(/uuid/);
  });

  it("refuses an artifact id that is not a uuid", () => {
    expect(() => artifactStorageKey(scope, "draft", "../../etc/passwd")).toThrow(/uuid/);
  });

  it("refuses a content type outside the vocabulary", () => {
    expect(() => artifactStorageKey(scope, "audio" as never, ID)).toThrow(/content type/);
  });
});

describe("orgIdFromKey", () => {
  it("recovers the tenant from a key it built", () => {
    expect(orgIdFromKey(artifactStorageKey(scope, "context_pack", ID))).toBe(ORG);
  });

  it("returns null for a traversal attempt", () => {
    expect(orgIdFromKey("artifacts/../draft/x")).toBeNull();
  });

  it("returns null for a key with no tenant segment", () => {
    expect(orgIdFromKey("artifacts/draft/x")).toBeNull();
  });
});

describe("tenantPrefix", () => {
  it("is the prefix a tenant-offboarding delete targets", () => {
    expect(tenantPrefix(scope)).toBe(`artifacts/${ORG}/`);
  });
});
