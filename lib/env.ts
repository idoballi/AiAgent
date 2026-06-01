export function getBaseUrl() {
  return process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "http://localhost:3000";
}

/** Base URL from the incoming request (preferred for auth redirects on custom domains). */
export function getBaseUrlFromRequest(request: Request) {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

export function getTimeZone() {
  return process.env.APP_TIME_ZONE || "Asia/Jerusalem";
}

export function getRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }
  return value;
}

function normalizeSecret(value: string | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim() || null;
  }
  return trimmed;
}

/** Reads OpenAI key from server env (never use NEXT_PUBLIC_* for secrets). */
export function getOpenAiApiKey() {
  return (
    normalizeSecret(process.env.OPENAI_API_KEY) ||
    normalizeSecret(process.env.OPENAI_KEY) ||
    null
  );
}

export function getOpenAiModel() {
  return normalizeSecret(process.env.OPENAI_MODEL) || "gpt-4o-mini";
}

export function isOpenAiConfigured() {
  return Boolean(getOpenAiApiKey());
}
