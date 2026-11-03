export type UrgencyTier = "CRITICAL" | "SOON" | "SAFE" | "EXPIRED";

export interface UrgencyInfo {
  tier: UrgencyTier;
  daysRemaining: number;
  label: string;
  badgeClass: string;
}

export function getUrgencyInfo(expiryDateStr: string): UrgencyInfo {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const expiry = new Date(expiryDateStr);
  expiry.setHours(0, 0, 0, 0);

  const diffTime = expiry.getTime() - today.getTime();
  const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (daysRemaining < 0) {
    return {
      tier: "EXPIRED",
      daysRemaining,
      label: `Expired ${Math.abs(daysRemaining)}d ago`,
      badgeClass: "bg-red-100 text-red-800 border-red-200",
    };
  }

  if (daysRemaining <= 7) {
    return {
      tier: "CRITICAL",
      daysRemaining,
      label: `${daysRemaining}d left (Action Required)`,
      badgeClass: "bg-rose-100 text-rose-800 border-rose-200 animate-pulse",
    };
  }

  if (daysRemaining <= 30) {
    return {
      tier: "SOON",
      daysRemaining,
      label: `${daysRemaining}d left (Renewal Due)`,
      badgeClass: "bg-amber-100 text-amber-800 border-amber-200",
    };
  }

  return {
    tier: "SAFE",
    daysRemaining,
    label: `${daysRemaining}d left (Safe)`,
    badgeClass: "bg-emerald-100 text-emerald-800 border-emerald-200",
  };
}