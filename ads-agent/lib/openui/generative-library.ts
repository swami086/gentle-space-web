/**
 * S13 generative surfaces (F2/F3) — Why, call-prep, and action-proposal cards.
 *
 * Root is `WhyCard`: Ask/Why routes default to an explanatory body + citations; CallPrep and
 * ActionProposal are sibling components the model may emit when the surface fits.
 *
 * Citation convention (see lib/generative/citation-gate.ts):
 *   - citationIds([...]) — positional on WhyCard / ActionProposal
 *   - citationIds: [...] — object field inside CallPrepCard point literals
 *   - cite("id") — inline in prose (extracted by citation gate, not a component prop)
 */
import { createLibrary, defineComponent } from "@openuidev/react-lang";
import React from "react";
import { z } from "zod/v4";

const CallPrepPointSchema = z.object({
  text: z.string(),
  citationIds: z.array(z.string()),
});

const WhyCardSchema = z.object({
  body: z.string(),
  citationIds: z.array(z.string()).optional().default([]),
  followUps: z.array(z.string()).optional().default([]),
});
export type WhyCardProps = z.infer<typeof WhyCardSchema>;
export type WhyCardViewInput = { [K in keyof WhyCardProps]?: WhyCardProps[K] | null };

/** Pure, read-only Why answer — dual-mode (direct call or OpenUI Renderer). */
export function WhyCardView(raw: WhyCardViewInput) {
  const body = raw.body ?? "";
  const citationIds = raw.citationIds ?? [];
  const followUps = raw.followUps ?? [];
  return React.createElement(
    "div",
    { className: "flex flex-col gap-2 rounded-lg border border-border bg-card p-4 text-sm" },
    React.createElement("p", { className: "text-card-foreground whitespace-pre-wrap" }, body),
    citationIds.length > 0 &&
      React.createElement(
        "div",
        { className: "flex flex-wrap gap-1" },
        ...citationIds.map((id, i) =>
          React.createElement(
            "span",
            { key: i, className: "rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground" },
            id,
          ),
        ),
      ),
    followUps.length > 0 &&
      React.createElement(
        "ul",
        { className: "flex flex-col gap-1 border-t border-border pt-2 text-xs text-muted-foreground" },
        ...followUps.map((q, i) => React.createElement("li", { key: i }, q)),
      ),
  );
}

const WhyCard = defineComponent({
  name: "WhyCard",
  description:
    "Explains why something is true for a proposal/enquiry/campaign: body (prose), citationIds " +
    "(string[] grounding pack row ids), optional followUps (suggested next questions). Args are " +
    "POSITIONAL in that key order; omit trailing followUps when none.",
  props: WhyCardSchema,
  component: ({ props }: { props: WhyCardViewInput }) => React.createElement(WhyCardView, props),
});

const CallPrepCardSchema = z.object({
  points: z.array(CallPrepPointSchema).length(3),
});
export type CallPrepCardProps = z.infer<typeof CallPrepCardSchema>;
export type CallPrepCardViewInput = {
  points?: ({ text?: string | null; citationIds?: (string | null)[] | null } | null)[] | null;
};

/** Exactly three cited talking points for an enquiry call — dual-mode. */
export function CallPrepCardView(raw: CallPrepCardViewInput) {
  const points = (raw.points ?? [])
    .filter((p): p is NonNullable<typeof p> => p != null && typeof p === "object")
    .map((p) => ({
      text: p.text ?? "",
      citationIds: (p.citationIds ?? []).filter((id): id is string => typeof id === "string"),
    }));
  if (points.length === 0) {
    return React.createElement("p", { className: "text-sm text-muted-foreground" }, "No call-prep points yet.");
  }
  return React.createElement(
    "ol",
    { className: "flex list-decimal flex-col gap-2 rounded-lg border border-border bg-card p-4 pl-8 text-sm" },
    ...points.map((p, i) =>
      React.createElement(
        "li",
        { key: i, className: "flex flex-col gap-1" },
        React.createElement("span", { className: "text-card-foreground" }, p.text),
        p.citationIds.length > 0 &&
          React.createElement(
            "span",
            { className: "text-xs text-muted-foreground" },
            p.citationIds.join(", "),
          ),
      ),
    ),
  );
}

const CallPrepCard = defineComponent({
  name: "CallPrepCard",
  description:
    "Call-prep card with exactly three talking points for an enquiry. Each point is " +
    "{ text, citationIds: string[] } inside the points array positional arg. Use on enquiry " +
    "surfaces when the user needs call guidance — never fewer or more than three points.",
  props: CallPrepCardSchema,
  component: ({ props }: { props: CallPrepCardViewInput }) => React.createElement(CallPrepCardView, props),
});

const ActionProposalSchema = z.object({
  title: z.string(),
  summary: z.string(),
  kind: z.string(),
  citationIds: z.array(z.string()),
  href: z.string().optional().default(""),
});
export type ActionProposalProps = z.infer<typeof ActionProposalSchema>;
export type ActionProposalViewInput = { [K in keyof ActionProposalProps]?: ActionProposalProps[K] | null };

/** Proposed in-app action (navigate or pending proposal) — never executes spend directly. */
export function ActionProposalView(raw: ActionProposalViewInput) {
  const title = raw.title ?? "";
  const summary = raw.summary ?? "";
  const kind = raw.kind ?? "";
  const href = raw.href ?? "";
  const citationIds = raw.citationIds ?? [];
  return React.createElement(
    "div",
    { className: "flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 text-sm" },
    React.createElement("span", { className: "font-medium" }, title),
    React.createElement("span", { className: "text-muted-foreground" }, summary),
    kind && React.createElement("span", { className: "text-xs uppercase tracking-wide text-muted-foreground" }, kind),
    href &&
      React.createElement("span", { className: "text-xs text-primary" }, href),
    citationIds.length > 0 &&
      React.createElement(
        "div",
        { className: "flex flex-wrap gap-1" },
        ...citationIds.map((id, i) =>
          React.createElement(
            "span",
            { key: i, className: "rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground" },
            id,
          ),
        ),
      ),
  );
}

const ActionProposal = defineComponent({
  name: "ActionProposal",
  description:
    "Proposes a confirmable in-app action: title, summary, kind (machine label), citationIds " +
    "(string[]), optional href (safe relative path starting with /). Args are POSITIONAL in that " +
    "key order; omit trailing href when navigation uses proposalId via onAction instead.",
  props: ActionProposalSchema,
  component: ({ props }: { props: ActionProposalViewInput }) =>
    React.createElement(ActionProposalView, props),
});

export const generativeLibrary = createLibrary({
  root: "WhyCard",
  components: [WhyCard, CallPrepCard, ActionProposal] as NonNullable<
    Parameters<typeof createLibrary>[0]["components"]
  >,
});
