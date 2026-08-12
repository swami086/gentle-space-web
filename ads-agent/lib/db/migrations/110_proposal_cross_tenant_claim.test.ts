import { describe, expect, it } from "vitest";
import { readMigration } from "./migration-assertions";

const up = readMigration("110_proposal_cross_tenant_claim.up.sql");
const down = readMigration("110_proposal_cross_tenant_claim.down.sql");

describe("110_proposal_cross_tenant_claim", () => {
  it("adds cross_tenant_read SELECT policy on proposals", () => {
    expect(up).toMatch(/CREATE POLICY cross_tenant_read ON adsagent\.proposals/i);
    expect(up).toContain("FOR SELECT");
    expect(up).toMatch(/current_setting\('app\.cross_tenant', true\) = 'projector'/);
  });

  it("down drops the cross_tenant_read policy", () => {
    expect(down).toContain("DROP POLICY IF EXISTS cross_tenant_read ON adsagent.proposals");
  });
});
