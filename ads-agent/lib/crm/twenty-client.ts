import { getTwentyConnection } from "../db/twenty-connections";
import { resolveTwentyApiKey } from "./twenty-secrets";

export type TwentyPersonInput = {
  firstName: string;
  lastName: string;
  phone?: string | null;
  email?: string | null;
};

export type TwentyPerson = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
};

export type TwentyOpportunityInput = {
  name: string;
  personId: string;
  stage: string;
  listingUrl?: string | null;
  listingName?: string | null;
};

export type TwentyClient = {
  orgId: string;
  version: string;
  upsertPerson(input: TwentyPersonInput): Promise<TwentyPerson>;
  createOpportunity(input: TwentyOpportunityInput): Promise<{ id: string }>;
  updateOpportunityStage(id: string, stage: string): Promise<void>;
  createNote(opportunityId: string, body: string): Promise<{ id: string }>;
  listOpportunities(limit?: number): Promise<unknown>;
  getOpportunity(id: string): Promise<unknown>;
};

function extractId(json: unknown): string | undefined {
  if (!json || typeof json !== "object") return undefined;
  const rec = json as Record<string, unknown>;
  if (typeof rec.id === "string") return rec.id;
  const data = rec.data;
  if (!data || typeof data !== "object") return undefined;
  const dataRec = data as Record<string, unknown>;
  if (typeof dataRec.id === "string") return dataRec.id;
  for (const value of Object.values(dataRec)) {
    if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") {
      return (value as { id: string }).id;
    }
  }
  return undefined;
}

function splitIndianPhone(phone: string | null | undefined): Record<string, unknown> | undefined {
  if (!phone) return undefined;
  const digits = phone.replace(/[^\d+]/g, "");
  return {
    primaryPhoneNumber: digits.replace(/^\+?91/, "").replace(/^\+/, "") || digits,
    primaryPhoneCountryCode: "IN",
    primaryPhoneCallingCode: "+91",
  };
}

/**
 * The interim containment from the tenancy spec's Q4 resolution. Twenty's
 * deduplication has already merged contacts across tenant lines in the shared
 * instance, so no org except the platform may touch it. Removed by Task 24
 * once every org has its own instance — not before.
 */
function assertNotSharedInstance(orgId: string, baseUrl: string): void {
  const shared = process.env.SHARED_TWENTY_BASE_URL?.replace(/\/$/, "");
  if (!shared) return;
  if (baseUrl.replace(/\/$/, "") !== shared) return;
  if (orgId === process.env.PLATFORM_ORG_ID) return;
  throw new Error(
    `twenty: interim platform-only guard — org ${orgId} would reach the shared instance, ` +
      `whose contacts are merged across tenants and cannot be separated`,
  );
}

/**
 * The only constructor. Constructing a Twenty client any other way is the
 * equivalent of a missing scopeClause. It throws rather than returning an
 * empty result, because an empty result is indistinguishable from a customer
 * with no contacts, which is how a leak hides (tenancy spec §6).
 */
export async function getTwentyClient(orgId: string): Promise<TwentyClient> {
  const connection = await getTwentyConnection(orgId);
  if (!connection) throw new Error(`twenty: no Twenty connection for org ${orgId}`);
  if (connection.state !== "active") {
    throw new Error(`twenty: connection for org ${orgId} is in state ${connection.state}`);
  }
  assertNotSharedInstance(orgId, connection.baseUrl);

  const base = connection.baseUrl.replace(/\/$/, "");
  const key = await resolveTwentyApiKey(connection.apiKeyRef);

  async function request(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`twenty ${method} ${path} ${res.status}: ${text.slice(0, 200)}`);
    }
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`twenty ${method} ${path}: response was not JSON`);
    }
  }

  return {
    orgId,
    version: connection.twentyVersion,

    async upsertPerson(input) {
      const json = await request("POST", "/rest/people", {
        name: { firstName: input.firstName, lastName: input.lastName || "-" },
        ...(splitIndianPhone(input.phone) ? { phones: splitIndianPhone(input.phone) } : {}),
        ...(input.email ? { emails: { primaryEmail: input.email } } : {}),
      });
      const id = extractId(json);
      if (!id) throw new Error("twenty POST /rest/people: missing id in response");
      const record = (json as { data?: Record<string, unknown> }).data ?? {};
      const name = (record.name ?? {}) as { firstName?: string; lastName?: string };
      const phones = (record.phones ?? {}) as { primaryPhoneNumber?: string };
      const emails = (record.emails ?? {}) as { primaryEmail?: string };
      return {
        id,
        firstName: name.firstName ?? input.firstName,
        lastName: name.lastName ?? input.lastName,
        phone: phones.primaryPhoneNumber ?? input.phone ?? null,
        email: emails.primaryEmail ?? input.email ?? null,
      };
    },

    async createOpportunity(input) {
      const json = await request("POST", "/rest/opportunities", {
        name: input.name.slice(0, 120),
        pointOfContactId: input.personId,
        stage: input.stage,
        ...(input.listingUrl ? { listingUrl: input.listingUrl } : {}),
        ...(input.listingName ? { listingName: input.listingName } : {}),
      });
      const id = extractId(json);
      if (!id) throw new Error("twenty POST /rest/opportunities: missing id in response");
      return { id };
    },

    async updateOpportunityStage(id, stage) {
      await request("PATCH", `/rest/opportunities/${encodeURIComponent(id)}`, { stage });
    },

    async createNote(opportunityId, body) {
      const json = await request("POST", "/rest/notes", {
        title: body.split("\n")[0]?.slice(0, 80) || "Activity",
        bodyV2: { markdown: body },
        noteTargets: [{ opportunityId }],
      });
      const id = extractId(json);
      if (!id) throw new Error("twenty POST /rest/notes: missing id in response");
      return { id };
    },

    async listOpportunities(limit = 200) {
      return request("GET", `/rest/opportunities?limit=${limit}`);
    },

    async getOpportunity(id) {
      return request("GET", `/rest/opportunities/${encodeURIComponent(id)}`);
    },
  };
}
