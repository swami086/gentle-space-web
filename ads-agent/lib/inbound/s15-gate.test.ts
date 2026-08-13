/**
 * S15 inbound expansion gate — build-sequence checkpoint (B2–B4, BD2).
 * Run: npx vitest run lib/inbound/s15-gate.test.ts
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { ARTIFACT_CONTENT_TYPES } from "../artifacts/key";
import { addMessage } from "../db/enquiry-messages";
import { OUTBOX_TOPICS } from "../events/topics";

function repoPath(...segments: string[]): string {
  return join(__dirname, "..", "..", ...segments);
}

function collectTsSources(rootDir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(rootDir)) {
    const full = join(rootDir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...collectTsSources(full));
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

/** BD2: inbound paths must not POST to Graph /messages or import send clients. */
function assertNoOutboundSendInSource(source: string, filePath: string): void {
  const rel = filePath.replace(repoPath(), "ads-agent");

  if (/\/messages\b/i.test(source)) {
    throw new Error(`${rel}: references Graph /messages (outbound send path)`);
  }

  if (/method:\s*["']POST["']/i.test(source) && /graph\.facebook\.com/i.test(source)) {
    throw new Error(`${rel}: POST to graph.facebook.com (only media GET allowed)`);
  }

  if (/\bsendWhatsApp\b|\bsendMessage\b|whatsapp.*send|messages.*POST/i.test(source)) {
    throw new Error(`${rel}: suspected outbound send helper`);
  }
}

describe("s15-gate: vocabulary", () => {
  it("OUTBOX_TOPICS includes inbound.message_received", () => {
    expect(OUTBOX_TOPICS).toContain("inbound.message_received");
  });

  it("ARTIFACT_CONTENT_TYPES includes inbound_media", () => {
    expect(ARTIFACT_CONTENT_TYPES).toContain("inbound_media");
  });
});

describe("s15-gate: BD2 no outbound send under inbound paths", () => {
  const roots = [
    repoPath("lib", "inbound"),
    repoPath("app", "api", "inbound"),
  ];

  for (const root of roots) {
    for (const file of collectTsSources(root)) {
      it(`static scan: ${file.replace(repoPath(), "ads-agent")}`, () => {
        const source = readFileSync(file, "utf8");
        assertNoOutboundSendInSource(source, file);
      });
    }
  }
});

describe("s15-gate: addMessage keeps is_untrusted default true", () => {
  it("INSERT omits is_untrusted so SQL DEFAULT true applies", () => {
    const fn = addMessage.toString();
    expect(fn).toMatch(/INSERT INTO adsagent\.enquiry_messages/);
    expect(fn).not.toMatch(/is_untrusted/);
  });

  it("migration 022 defines is_untrusted NOT NULL DEFAULT true", () => {
    const sql = readFileSync(
      repoPath("lib", "db", "migrations", "022_enquiry_messages.up.sql"),
      "utf8",
    );
    expect(sql).toMatch(/is_untrusted\s+BOOLEAN NOT NULL DEFAULT true/);
  });
});

describe("s15-gate: module smoke imports", () => {
  it("processInboundEvent exports", async () => {
    const mod = await import("./process");
    expect(typeof mod.processInboundEvent).toBe("function");
  });

  it("inbound webhook routes export handlers", async () => {
    const wa = await import("../../app/api/inbound/whatsapp/route");
    const email = await import("../../app/api/inbound/email/route");
    expect(typeof wa.GET).toBe("function");
    expect(typeof wa.POST).toBe("function");
    expect(typeof email.POST).toBe("function");
  });

  it("verify helpers export", async () => {
    const wa = await import("./whatsapp-verify");
    const pm = await import("./postmark-auth");
    expect(typeof wa.verifyWhatsAppHubChallenge).toBe("function");
    expect(typeof wa.verifyWhatsAppSignature).toBe("function");
    expect(typeof pm.verifyPostmarkBasicAuth).toBe("function");
  });
});
