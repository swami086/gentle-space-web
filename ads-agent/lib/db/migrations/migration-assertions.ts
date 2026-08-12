import { readFileSync } from "node:fs";
import { join } from "node:path";

export function readMigration(name: string): string {
  return readFileSync(join(__dirname, name), "utf8");
}

export function assertTenantTableHardening(sql: string, qualifiedTable: string): void {
  const t = qualifiedTable.replace(/\./g, "\\.");
  const checks: Array<[string, RegExp]> = [
    [
      "ENABLE ROW LEVEL SECURITY",
      new RegExp(`ALTER\\s+TABLE\\s+${t}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, "i"),
    ],
    [
      "FORCE ROW LEVEL SECURITY",
      new RegExp(`ALTER\\s+TABLE\\s+${t}\\s+FORCE\\s+ROW\\s+LEVEL\\s+SECURITY`, "i"),
    ],
    ["a policy on the table", new RegExp(`CREATE\\s+POLICY\\s+\\w+\\s+ON\\s+${t}`, "i")],
    ["USING (org_id = public.current_tenant())", /USING\s*\(\s*org_id\s*=\s*public\.current_tenant\(\)\s*\)/i],
    [
      "WITH CHECK (org_id = public.current_tenant())",
      /WITH\s+CHECK\s*\(\s*org_id\s*=\s*public\.current_tenant\(\)\s*\)/i,
    ],
  ];
  const missing = checks.filter(([, re]) => !re.test(sql)).map(([label]) => label);
  if (missing.length > 0) {
    throw new Error(`${qualifiedTable} is not hardened; missing: ${missing.join(", ")}`);
  }
}
