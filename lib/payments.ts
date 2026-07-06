import type { Tone } from "@/components/ui/badge";
import type { InterviewRequest, InterviewStatus } from "@/lib/types";

/**
 * Interview statuses at which a candidate can be billed and can pay. Cancelled,
 * rejected, and still-pending interviews are never "owed" — counting them
 * inflates outstanding revenue and shows dead Pay / Mark-paid buttons. This is
 * the single source of truth shared by the admin boards and candidate views.
 */
export const PAYABLE_STATUSES: ReadonlySet<InterviewStatus> = new Set<InterviewStatus>([
  "approved",
  "scheduled",
  "completed",
]);

export function isPayableStatus(status: InterviewStatus): boolean {
  return PAYABLE_STATUSES.has(status);
}

/** An invoiced interview whose payment is still collectible (unpaid + payable). */
export function isOutstandingInvoice(
  r: Pick<InterviewRequest, "price_cents" | "payment_status" | "status">,
): boolean {
  return r.price_cents != null && r.payment_status !== "paid" && PAYABLE_STATUSES.has(r.status);
}

export const PAYMENT_METHODS = [
  { value: "crypto_btc", label: "Bitcoin (BTC)", short: "BTC" },
  { value: "crypto_eth", label: "Ethereum (ETH)", short: "ETH" },
  { value: "crypto_sol", label: "Solana (SOL)", short: "SOL" },
  { value: "crypto_usdt_erc20", label: "USDT (ERC-20)", short: "USDT" },
  { value: "crypto_usdt_trc20", label: "USDT (TRC-20)", short: "USDT" },
  { value: "crypto_usdt_bep20", label: "USDT (BEP-20)", short: "USDT" },
  { value: "crypto_bnb", label: "BNB", short: "BNB" },
  { value: "bank_transfer", label: "Bank transfer", short: "Bank" },
  { value: "cash", label: "Cash", short: "Cash" },
  { value: "stripe", label: "Stripe", short: "Stripe" },
  { value: "paypal", label: "PayPal", short: "PayPal" },
  { value: "free", label: "Free", short: "Free" },
  { value: "training", label: "Training", short: "Training" },
] as const;

export const METHOD_LABEL: Record<string, string> = Object.fromEntries(
  PAYMENT_METHODS.map((m) => [m.value, m.short]),
);

export const PAYMENT_STATUS_TONE: Record<string, Tone> = {
  paid: "green",
  pending: "amber",
  overdue: "red",
  refunded: "slate",
  partial: "blue",
  free: "slate",
};

/** amount is stored in dollars (numeric); format via the shared money helper. */
export function formatAmount(amount: number | string, currency = "USD"): string {
  const cents = Math.round(Number(amount) * 100);
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}
