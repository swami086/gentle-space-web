export type WizardStep = "identify" | "details" | "notes";

export function wizardSteps(skipDetails: boolean): WizardStep[] {
  return skipDetails ? ["identify", "notes"] : ["identify", "details", "notes"];
}

export function nextStepIndex(steps: WizardStep[], index: number): number {
  return Math.min(index + 1, steps.length - 1);
}

export function previousStepIndex(index: number): number {
  return Math.max(index - 1, 0);
}

export function canAdvanceFromIdentify(name: string, phone: string): boolean {
  return Boolean(name.trim() && phone.trim());
}
