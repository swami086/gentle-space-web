export type ReallocateShareInput = {
  id: string;
  budgetMinor: number;
  spendMinor: number;
  leads: number;
};

export type ReallocateListingInput = {
  writesEnabled: boolean;
  dayNumber: number;
  alreadyMovedToday: boolean;
  ceilingChangedToday: boolean;
  ceilingMinor: number;
  shares: ReallocateShareInput[];
};

export type ReallocateSkip = { action: "skip"; reason: string };

export type ReallocateMove = {
  action: "move";
  shares: { id: string; budgetMinor: number }[];
  text: { oldShares: number[]; newShares: number[]; ceilingMinor: number };
};

export type ReallocateResult = ReallocateSkip | ReallocateMove;

function unspentMinor(budgetMinor: number, spendMinor: number): number {
  return Math.max(0, budgetMinor - spendMinor);
}

function distributeByLeads(
  poolMinor: number,
  recipients: { id: string; leads: number }[],
): Map<string, number> | null {
  const totalLeads = recipients.reduce((sum, r) => sum + r.leads, 0);
  if (totalLeads <= 0 || poolMinor <= 0) {
    return new Map(recipients.map((r) => [r.id, 0]));
  }

  const parts = recipients.map((r) => {
    const exact = (poolMinor * r.leads) / totalLeads;
    const base = Math.floor(exact);
    return { id: r.id, base, fraction: exact - base };
  });

  let remainder = poolMinor - parts.reduce((sum, p) => sum + p.base, 0);
  const order = [...parts].sort((a, b) => b.fraction - a.fraction || a.id.localeCompare(b.id));

  const out = new Map<string, number>();
  for (const p of parts) {
    out.set(p.id, p.base);
  }
  for (let i = 0; remainder > 0; i += 1, remainder -= 1) {
    const target = order[i % order.length];
    out.set(target.id, (out.get(target.id) ?? 0) + 1);
  }

  const distributed = [...out.values()].reduce((sum, n) => sum + n, 0);
  if (distributed !== poolMinor) {
    return null;
  }
  return out;
}

export function reallocateListing(input: ReallocateListingInput): ReallocateResult {
  if (!input.writesEnabled) {
    return { action: "skip", reason: "writes_disabled" };
  }
  if (input.dayNumber < 3) {
    return { action: "skip", reason: "before_day_three" };
  }
  if (input.alreadyMovedToday) {
    return { action: "skip", reason: "already_moved_today" };
  }
  if (input.ceilingChangedToday) {
    return { action: "skip", reason: "ceiling_changed_today" };
  }

  const { shares, ceilingMinor } = input;
  if (shares.length === 0) {
    return { action: "skip", reason: "infeasible" };
  }

  const anyWithLeads = shares.some((s) => s.leads > 0);
  const anyWithoutLeads = shares.some((s) => s.leads === 0);
  if (!anyWithLeads) {
    return { action: "skip", reason: "no_share_has_leads" };
  }
  if (!anyWithoutLeads) {
    return { action: "skip", reason: "all_shares_have_leads" };
  }

  const budgetSum = shares.reduce((sum, s) => sum + s.budgetMinor, 0);
  if (budgetSum !== ceilingMinor) {
    return { action: "skip", reason: "infeasible" };
  }

  for (const s of shares) {
    if (s.budgetMinor < s.spendMinor || s.leads < 0) {
      return { action: "skip", reason: "infeasible" };
    }
  }

  const poolMinor = shares
    .filter((s) => s.leads === 0)
    .reduce((sum, s) => sum + unspentMinor(s.budgetMinor, s.spendMinor), 0);

  const recipients = shares.filter((s) => s.leads > 0);
  const additions = distributeByLeads(poolMinor, recipients);
  if (!additions) {
    return { action: "skip", reason: "infeasible" };
  }

  const oldShares = shares.map((s) => s.budgetMinor);
  const newShareRows = shares.map((s) => {
    if (s.leads === 0) {
      const next = s.budgetMinor - unspentMinor(s.budgetMinor, s.spendMinor);
      return { id: s.id, budgetMinor: next };
    }
    const add = additions.get(s.id) ?? 0;
    return { id: s.id, budgetMinor: s.budgetMinor + add };
  });

  for (const row of newShareRows) {
    const spend = shares.find((s) => s.id === row.id)?.spendMinor ?? 0;
    if (row.budgetMinor < spend) {
      return { action: "skip", reason: "infeasible" };
    }
  }

  const newSum = newShareRows.reduce((sum, s) => sum + s.budgetMinor, 0);
  if (newSum !== ceilingMinor) {
    return { action: "skip", reason: "infeasible" };
  }

  return {
    action: "move",
    shares: newShareRows,
    text: {
      oldShares,
      newShares: newShareRows.map((s) => s.budgetMinor),
      ceilingMinor,
    },
  };
}
