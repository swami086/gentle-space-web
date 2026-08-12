/** `record` = a Postgres system-of-record row. `derived` = anything projected back into
 *  Postgres from ClickHouse, which lives in the `derived` quarantine schema. */
export type Authority = "record" | "derived";

export type Justification = { authority: Authority; ref: string };

export class DerivedOnlyJustificationError extends Error {
  constructor() {
    super(
      "every justification is a derived figure: the `derived` schema is a quarantine and may " +
        "never be the sole justification for a proposal (data model §0, dataflow review A-5)",
    );
    this.name = "DerivedOnlyJustificationError";
  }
}

export function assertNotSoleDerivedJustification(js: Justification[]): void {
  if (!js.some((j) => j.authority === "record")) throw new DerivedOnlyJustificationError();
}
