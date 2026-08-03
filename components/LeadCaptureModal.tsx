"use client";

import { useEffect, useState, type FormEvent } from "react";
import { buildWhatsAppUrl, NEED_LABELS, type LeadPayload, type NeedType } from "@/lib/whatsapp";
import { step2FieldsFor, type Step2Answers } from "@/lib/leads/step2-fields";
import {
  canAdvanceFromIdentify,
  nextStepIndex,
  previousStepIndex,
  wizardSteps,
} from "@/lib/leads/wizard-steps";
import { useLeadCapture } from "./LeadCaptureContext";

const NEED_OPTIONS: NeedType[] = ["office", "retail", "lease"];
const LEADS_FETCH_TIMEOUT_MS = 2500;

function IconClose({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function IconWhatsApp({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.435 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z" />
    </svg>
  );
}

async function postLead(payload: LeadPayload) {
  try {
    await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(LEADS_FETCH_TIMEOUT_MS),
    });
  } catch {
    // Soft-fail: WhatsApp always opens regardless. The server keeps working
    // on the AI qualification + CRM write even after this fetch gives up —
    // see docs/superpowers/specs/2026-08-03-whatsapp-ai-lead-qualification-design.md.
  }
}

export function LeadCaptureModal() {
  const { open, propertyContext, closeModal } = useLeadCapture();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [need, setNeed] = useState<NeedType>("office");
  const [step2Answers, setStep2Answers] = useState<Step2Answers>({});
  const [notes, setNotes] = useState("");
  const [stepIndex, setStepIndex] = useState(0);

  const steps = wizardSteps(Boolean(propertyContext));
  const currentStep = steps[stepIndex];

  useEffect(() => {
    if (!open) {
      setName("");
      setPhone("");
      setNeed("office");
      setStep2Answers({});
      setNotes("");
      setStepIndex(0);
      return;
    }
    setStep2Answers({});
    setStepIndex(0);
    if (propertyContext) {
      setNeed("office");
      setNotes(`Interested in: ${propertyContext.propertyName}\nListing: ${propertyContext.propertyUrl}`);
    } else {
      setNeed("office");
      setNotes("");
    }
  }, [open, propertyContext]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeModal();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closeModal, open]);

  if (!open) return null;

  const canAdvance = currentStep !== "identify" || canAdvanceFromIdentify(name, phone);
  const isLastStep = stepIndex === steps.length - 1;

  const handleNeedChange = (option: NeedType) => {
    setNeed(option);
    setStep2Answers({});
  };

  const handleNext = () => setStepIndex((index) => nextStepIndex(steps, index));
  const handleBack = () => setStepIndex((index) => previousStepIndex(index));

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canAdvance) return;
    if (!isLastStep) {
      handleNext();
      return;
    }
    const lead: LeadPayload = {
      name,
      phone,
      need,
      brief: notes,
      ...(Object.keys(step2Answers).length > 0 && { step2Answers }),
      ...(propertyContext && {
        propertyName: propertyContext.propertyName,
        propertyUrl: propertyContext.propertyUrl,
      }),
    };
    await postLead(lead);
    window.open(buildWhatsAppUrl(lead), "_blank", "noopener,noreferrer");
    closeModal();
  };

  const title = propertyContext ? "Message on WhatsApp" : "Get your private property e-brochure";
  const headerHelper = propertyContext
    ? `About: ${propertyContext.propertyName}`
    : "Share your brief. We'll send a private shortlist on WhatsApp.";
  const submitLabel = isLastStep ? (propertyContext ? "Open WhatsApp draft" : "Send on WhatsApp") : "Next";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--ink)]/60 px-4 py-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeModal();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="lead-capture-title"
        className="flex w-full max-w-[600px] flex-col gap-6 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--bg)] p-8 shadow-[0_24px_80px_rgba(30,22,48,0.18)]"
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <h2 id="lead-capture-title" className="text-[24px] font-bold tracking-tight text-[var(--ink)]">
              {title}
            </h2>
            <p className="text-[15px] leading-[1.45] text-[var(--ink-secondary)]">{headerHelper}</p>
            <p className="text-[12px] font-semibold uppercase tracking-wide text-[var(--muted)]">
              Step {stepIndex + 1} of {steps.length}
            </p>
          </div>
          <button
            type="button"
            onClick={closeModal}
            aria-label="Close lead capture modal"
            className="shrink-0 rounded-[var(--radius)] border border-transparent p-1.5 text-[var(--muted)] transition hover:border-[var(--border)] hover:bg-[var(--surface)] hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
          >
            <IconClose className="h-[22px] w-[22px]" />
          </button>
        </div>

        <form className="flex flex-col gap-4" onSubmit={handleSubmit}>
          {currentStep === "identify" && (
            <>
              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] font-semibold text-[var(--ink-secondary)]">Full name</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[15px] text-[var(--ink)] outline-none transition placeholder:text-[var(--muted)] dark:placeholder:text-[var(--ink-secondary)] focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
                  placeholder="Your name"
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] font-semibold text-[var(--ink-secondary)]">WhatsApp number</span>
                <input
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[15px] text-[var(--ink)] outline-none transition placeholder:text-[var(--muted)] dark:placeholder:text-[var(--ink-secondary)] focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
                  placeholder="+91 …"
                />
              </label>

              <fieldset className="flex flex-col gap-2">
                <legend className="text-[13px] font-semibold text-[var(--ink-secondary)]">I need</legend>
                <div className="flex flex-wrap gap-2">
                  {NEED_OPTIONS.map((option) => {
                    const selected = need === option;
                    return (
                      <button
                        key={option}
                        type="button"
                        onClick={() => handleNeedChange(option)}
                        className={`rounded-[var(--radius)] px-3.5 py-2.5 text-[13px] font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] ${
                          selected
                            ? "border border-[var(--accent)] bg-[var(--accent)] text-[var(--on-accent)] shadow-sm"
                            : "border border-[var(--border)] bg-[var(--surface)] text-[var(--ink-secondary)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                        }`}
                      >
                        {NEED_LABELS[option]}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            </>
          )}

          {currentStep === "details" &&
            step2FieldsFor(need).map((field) => (
              <label key={field.key} className="flex flex-col gap-1.5">
                <span className="text-[13px] font-semibold text-[var(--ink-secondary)]">{field.label}</span>
                <input
                  value={step2Answers[field.key] ?? ""}
                  onChange={(event) =>
                    setStep2Answers((prev) => ({ ...prev, [field.key]: event.target.value }))
                  }
                  className="w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-4 py-3 text-[15px] text-[var(--ink)] outline-none transition placeholder:text-[var(--muted)] dark:placeholder:text-[var(--ink-secondary)] focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
                  placeholder={field.placeholder}
                />
              </label>
            ))}

          {currentStep === "notes" && (
            <label className="flex flex-col gap-1.5">
              <span className="text-[13px] font-semibold text-[var(--ink-secondary)]">
                Anything else? (optional)
              </span>
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={4}
                className="h-[100px] w-full resize-none rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4 text-[15px] text-[var(--ink)] outline-none transition placeholder:text-[var(--muted)] dark:placeholder:text-[var(--ink-secondary)] focus-visible:border-[var(--accent)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)]"
                placeholder="Corridors, size, budget, timing…"
              />
            </label>
          )}

          <div className="flex flex-col gap-2.5">
            <div className="flex gap-2.5">
              {stepIndex > 0 && (
                <button
                  type="button"
                  onClick={handleBack}
                  className="inline-flex flex-1 items-center justify-center rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] px-5 py-3.5 text-[15px] font-semibold text-[var(--ink-secondary)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
                >
                  Back
                </button>
              )}
              <button
                type="submit"
                disabled={!canAdvance}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-[var(--radius)] bg-[var(--accent)] px-5 py-3.5 text-[15px] font-semibold text-[var(--on-accent)] transition hover:bg-[var(--accent-dark)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isLastStep && <IconWhatsApp className="h-[18px] w-[18px]" />}
                {submitLabel}
              </button>
            </div>
            {isLastStep && (
              <p className="text-center text-[13px] text-[var(--muted)]">
                {propertyContext
                  ? "We'll open WhatsApp with your message ready. Nothing is sent automatically."
                  : "Opens WhatsApp with your brief ready to send to Gentle Space CRE."}
              </p>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
