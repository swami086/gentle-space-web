// lib/leads/qualify-types.ts
import type { NeedType } from "../whatsapp";
import type { Step2Answers } from "./step2-fields";

export type LeadTier = "hot" | "warm" | "cold" | "unscored";

export type LeadQualification = {
  tier: LeadTier;
  cheatSheet: string;
};

export type LeadQualificationInput = {
  need: NeedType;
  step2Answers: Step2Answers;
  notes: string;
};

export function emptyLeadQualification(): LeadQualification {
  return { tier: "unscored", cheatSheet: "" };
}
