"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Condition = "effort_aware" | "vanilla" | "refuse" | "random";

const OPTIONS: { value: Condition; label: string; blurb: string }[] = [
  {
    value: "effort_aware",
    label: "Effort-aware",
    blurb: "Full Counterweight — adapts to how you work, spars, and probes.",
  },
  {
    value: "vanilla",
    label: "Vanilla",
    blurb: "A plain, helpful assistant. No gating, no challenge (control).",
  },
  {
    value: "refuse",
    label: "Socratic refusal",
    blurb: "Never answers — only ever asks guiding questions.",
  },
  {
    value: "random",
    label: "Random",
    blurb: "Assign one of the three conditions at random.",
  },
];

export default function StartPage() {
  const router = useRouter();
  const [participantId, setParticipantId] = useState("");
  const [condition, setCondition] = useState<Condition>("effort_aware");
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function begin() {
    if (!consent || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId, condition, consent }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? "Could not start the session.");
      const params = new URLSearchParams({ sid: data.sessionId, condition: data.condition });
      if (data.participantId) params.set("pid", data.participantId);
      router.push(`/?${params.toString()}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the session.");
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto max-w-lg px-4 py-12">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold tracking-tight">Research session setup</h1>
        <Link
          href="/"
          className="rounded text-sm text-black/50 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40"
        >
          Skip →
        </Link>
      </div>
      <p className="mt-1 text-sm text-black/50">
        Sets up a session for the study: records a participant ID, consent, and the
        assigned condition.
      </p>

      <div className="mt-8 space-y-6">
        <div>
          <label htmlFor="pid" className="block text-sm font-medium">
            Participant ID
          </label>
          <input
            id="pid"
            value={participantId}
            onChange={(e) => setParticipantId(e.target.value)}
            placeholder="e.g. P017"
            className="mt-1.5 w-full rounded-xl border border-black/15 bg-white px-3.5 py-2.5 text-sm outline-none placeholder:text-black/30 focus-visible:border-black/40 focus-visible:ring-2 focus-visible:ring-ink/20"
          />
        </div>

        <fieldset>
          <legend className="text-sm font-medium">Condition</legend>
          <div className="mt-2 space-y-2">
            {OPTIONS.map((o) => (
              <label
                key={o.value}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border px-3.5 py-3 transition ${
                  condition === o.value
                    ? "border-ink/50 bg-black/[0.03]"
                    : "border-black/15 hover:bg-black/[0.02]"
                }`}
              >
                <input
                  type="radio"
                  name="condition"
                  value={o.value}
                  checked={condition === o.value}
                  onChange={() => setCondition(o.value)}
                  className="mt-0.5 accent-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40"
                />
                <span>
                  <span className="block text-sm font-medium">{o.label}</span>
                  <span className="block text-xs text-black/50">{o.blurb}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 accent-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40"
          />
          <span className="text-sm text-black/70">
            I consent to my chat and the resulting behavioural metrics being recorded
            for this study.
          </span>
        </label>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700">
            {error}
          </div>
        )}

        <button
          onClick={begin}
          disabled={!consent || submitting}
          className="w-full rounded-xl bg-ink px-4 py-3 text-sm font-medium text-paper transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/40 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? "Starting…" : "Begin session"}
        </button>
        <p className="text-center text-xs text-black/30">
          Consent is required to begin. You can leave the participant ID blank for a
          casual run.
        </p>
      </div>
    </main>
  );
}
