export type MeteringContext = { orgId: string; userId: string; feature: string };

export class InsufficientCreditsError extends Error {
  constructor(message = "Insufficient credits") {
    super(message);
    this.name = "InsufficientCreditsError";
  }
}
