/** Pure vetting logic for public booking submissions (honeypot + timing + validation). */

export const MIN_ELAPSED_MS = 2500;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export interface RawSubmission {
  name?: unknown;
  email?: unknown;
  role?: unknown;
  preferred_at?: unknown;
  timezone?: unknown;
  notes?: unknown;
  website?: unknown; // honeypot
  elapsedMs?: unknown; // ms since the form loaded
}

export interface VettedValues {
  name: string;
  email: string;
  role: string;
  preferred_at: string | null;
  timezone: string | null;
  notes: string | null;
}

export type VetResult =
  | { ok: true; values: VettedValues }
  | { ok: false; drop: true } // silently drop (looks like a bot)
  | { ok: false; drop: false; error: string }; // show this to the user

/** Decide whether to accept, silently drop, or reject a submission — no I/O. */
export function vetSubmission(body: RawSubmission): VetResult {
  // Honeypot: a hidden field only bots fill.
  const website = typeof body.website === "string" ? body.website : "";
  if (website.trim() !== "") return { ok: false, drop: true };

  // Submitted implausibly fast → bot.
  const elapsed = typeof body.elapsedMs === "number" ? body.elapsedMs : NaN;
  if (Number.isFinite(elapsed) && elapsed >= 0 && elapsed < MIN_ELAPSED_MS) {
    return { ok: false, drop: true };
  }

  const name = String(body.name ?? "").trim();
  const email = String(body.email ?? "").trim();
  const role = String(body.role ?? "").trim();
  if (name.length < 2) return { ok: false, drop: false, error: "Please enter your name." };
  if (!EMAIL_RE.test(email)) return { ok: false, drop: false, error: "Please enter a valid email." };
  if (role.length < 2) return { ok: false, drop: false, error: "Tell us the role or topic." };

  return {
    ok: true,
    values: {
      name: name.slice(0, 100),
      email: email.slice(0, 200),
      role: role.slice(0, 120),
      preferred_at: body.preferred_at ? String(body.preferred_at) : null,
      timezone: body.timezone ? String(body.timezone).slice(0, 60) : null,
      notes: body.notes ? String(body.notes).slice(0, 2000) : null,
    },
  };
}
