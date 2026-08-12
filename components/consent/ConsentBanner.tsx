"use client";

import { useEffect, useState } from "react";

/**
 * Per DPDP Rule 3 a notice must be standalone, itemise what is collected, state the
 * specific purpose, and link to withdrawal. Tracking consent needs granular choices,
 * so each purpose is its own decision rather than one all-or-nothing toggle.
 */
const PURPOSES = [
  { code: "site_analytics", label: "Site analytics", detail: "Which pages are visited, and where visits arrive from." },
  { code: "space_recommendation", label: "Space recommendations", detail: "Searches, filters, listings viewed and shortlisted, so we can recommend spaces." },
  { code: "enquiry_handling", label: "Enquiry handling", detail: "Contact details revealed and enquiries submitted, so we can respond." },
] as const;

const STORAGE_KEY = "gs_consent_decided";

export function ConsentBanner() {
  const [visible, setVisible] = useState(false);
  const [chosen, setChosen] = useState<string[]>(["space_recommendation"]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setVisible(window.localStorage.getItem(STORAGE_KEY) === null);
  }, []);

  async function submit(purposes: string[], action: "granted" | "withdrawn") {
    setBusy(true);
    try {
      await fetch("/api/portal/consent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ purposes, action }),
      });
      window.localStorage.setItem(STORAGE_KEY, new Date().toISOString());
      setVisible(false);
    } finally {
      setBusy(false);
    }
  }

  if (!visible) return null;

  return (
    <aside
      aria-label="Privacy choices"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-neutral-200 bg-white p-4 text-sm text-neutral-800 shadow-lg"
    >
      <p className="mb-3 max-w-3xl">
        We record what you look for on this site so we can recommend spaces and respond to enquiries.
        Choose what you are happy for us to collect. You can withdraw any choice at any time.
      </p>
      <ul className="mb-3 space-y-2">
        {PURPOSES.map((purpose) => (
          <li key={purpose.code} className="flex items-start gap-2">
            <input
              id={`consent-${purpose.code}`}
              type="checkbox"
              className="mt-1"
              checked={chosen.includes(purpose.code)}
              onChange={(e) =>
                setChosen((prev) =>
                  e.target.checked ? [...prev, purpose.code] : prev.filter((c) => c !== purpose.code),
                )
              }
            />
            <label htmlFor={`consent-${purpose.code}`}>
              <span className="font-medium">{purpose.label}</span> — {purpose.detail}
            </label>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || chosen.length === 0}
          onClick={() => submit(chosen, "granted")}
          className="rounded bg-neutral-900 px-3 py-1.5 text-white disabled:opacity-40"
        >
          Accept selected
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => submit(PURPOSES.map((p) => p.code), "withdrawn")}
          className="rounded border border-neutral-300 px-3 py-1.5"
        >
          Reject all
        </button>
        <a href="/privacy" className="px-3 py-1.5 underline">
          Privacy notice and withdrawal
        </a>
      </div>
    </aside>
  );
}
