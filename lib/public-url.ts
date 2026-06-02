/** Canonical site URL for auth redirects (set in Vercel: https://automationsstudypilot.tech). */
export function getConfiguredAppOrigin() {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  return configured || null;
}

/** Client-side origin: prefers configured domain over vercel.app preview URL. */
export function getPublicAppOrigin() {
  const configured = getConfiguredAppOrigin();
  if (configured) return configured;
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

export function getAuthCallbackUrl(next = "/app") {
  const origin = getPublicAppOrigin();
  return `${origin}/auth/callback?next=${encodeURIComponent(next)}`;
}
