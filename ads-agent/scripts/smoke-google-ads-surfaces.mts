/**
 * Surface split smoke: listTools on read (:8766) vs write (:8769). Prints tool names only — no secrets.
 * Requires MCP servers reachable (Compose `google-ads-mcp` + `google-ads-mcp-write`).
 *   npm run smoke:google-ads-surfaces
 */
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import {
  GOOGLE_ADS_MCP_TOOLS,
  GOOGLE_ADS_MCP_URL,
  GOOGLE_ADS_MCP_WRITE_URL,
} from "../lib/bifrost/google-ads-mcp-tools";

async function listToolNames(url: string): Promise<string[]> {
  const client = new Client({ name: "ads-agent-surface-smoke", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  try {
    const { tools } = await client.listTools();
    return tools.map((t) => t.name);
  } finally {
    try {
      await client.close();
    } catch {
      /* ignore */
    }
  }
}

function publicEndpoint(url: string): string {
  const u = new URL(url);
  return `${u.protocol}//${u.host}${u.pathname}`;
}

async function main() {
  console.log("read MCP:", publicEndpoint(GOOGLE_ADS_MCP_URL));
  console.log("write MCP:", publicEndpoint(GOOGLE_ADS_MCP_WRITE_URL));

  let readNames: string[];
  let writeNames: string[];
  try {
    readNames = await listToolNames(GOOGLE_ADS_MCP_URL);
    writeNames = await listToolNames(GOOGLE_ADS_MCP_WRITE_URL);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("listTools failed:", msg);
    if (/invalid_grant/i.test(msg)) {
      console.error("Hint: refresh GOOGLE_ADS_REFRESH_TOKEN (OAuth) — smoke only needs MCP up, not API calls.");
    }
    process.exit(1);
  }

  readNames.sort();
  writeNames.sort();
  console.log("\nread tools:", readNames.join(", "));
  console.log("write tools:", writeNames.join(", "));

  const failures: string[] = [];
  if (readNames.includes(GOOGLE_ADS_MCP_TOOLS.createCampaign)) {
    failures.push("read surface must not expose create_campaign");
  }
  if (!writeNames.includes(GOOGLE_ADS_MCP_TOOLS.createCampaign)) {
    failures.push("write surface must expose create_campaign");
  }

  if (failures.length) {
    for (const f of failures) console.error("FAIL:", f);
    process.exit(1);
  }
  console.log("\nOK: read/write surface split verified");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
