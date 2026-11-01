// Lead credits, payments and Razorpay Checkout (shared by the Billing and Payments pages).

export interface Credits {
  freeLeads: number;
  freeLeadsUsed: number;
  freeLeadsLeft: number;
  balancePaise: number;
  pricePerLeadPaise: number;
  leadsLeft: number;
}

export interface CreditEntry {
  id: string;
  userId: string;
  type: "recharge" | "manual_credit" | "manual_debit" | "lead_charge";
  amountPaise: number;
  balanceAfterPaise: number;
  note: string | null;
  createdAt: string;
}

export interface Payment {
  id: string;
  userId: string;
  orderId: string;
  paymentId: string | null;
  amountPaise: number;
  status: "created" | "paid" | "failed";
  method: string | null;
  failureReason: string | null;
  createdAt: string;
  paidAt: string | null;
  user?: { id: string; email: string; username: string | null } | null;
}

export interface MyBilling {
  credits: Credits;
  razorpay: { enabled: false } | { enabled: true; keyId: string; mode: "test" | "live" };
  limits: { minPaise: number; maxPaise: number };
  entries: CreditEntry[];
  payments: Payment[];
}

export const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;

export const ENTRY_LABEL: Record<CreditEntry["type"], string> = {
  recharge: "Recharge (online)",
  manual_credit: "Added by admin",
  manual_debit: "Removed by admin",
  lead_charge: "New lead",
};

export const PAYMENT_STYLE: Record<Payment["status"], string> = {
  paid: "bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300",
  created: "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300",
  failed: "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-300",
};
export const PAYMENT_LABEL: Record<Payment["status"], string> = { paid: "Paid", created: "Not completed", failed: "Failed" };

// ---------- Razorpay Checkout ----------

interface CheckoutResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}
interface RazorpayInstance {
  open(): void;
  on(event: "payment.failed", cb: (r: { error?: { description?: string } }) => void): void;
}
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

let loading: Promise<void> | null = null;
function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => resolve();
    script.onerror = () => {
      loading = null;
      reject(new Error("Could not load Razorpay. Check your internet connection and try again."));
    };
    document.head.appendChild(script);
  });
  return loading;
}

export interface OrderInfo {
  orderId: string;
  amountPaise: number;
  currency: string;
  keyId: string;
  name: string;
  description: string;
  prefill: { email: string; contact: string; name: string };
}

/** Opens Razorpay Checkout; resolves with the signed ids on success, null when closed. */
export async function payWithRazorpay(order: OrderInfo): Promise<{ orderId: string; paymentId: string; signature: string } | null> {
  await loadCheckout();
  return new Promise((resolve, reject) => {
    const rzp = new window.Razorpay!({
      key: order.keyId,
      amount: order.amountPaise,
      currency: order.currency,
      name: order.name,
      description: order.description,
      order_id: order.orderId,
      prefill: order.prefill,
      theme: { color: "#117a57" },
      handler: (r: CheckoutResponse) => resolve({ orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature }),
      modal: { ondismiss: () => resolve(null) },
    });
    rzp.on("payment.failed", (r) => reject(new Error(r.error?.description ?? "The payment failed")));
    rzp.open();
  });
}
