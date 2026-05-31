import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const type = requestUrl.searchParams.get("type") as EmailOtpType | null;
  const next = requestUrl.searchParams.get("next") ?? "/app";
  const redirectUrl = new URL(next, requestUrl.origin);

  if (!code && (!tokenHash || !type)) {
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("error", "missing_code");
    return NextResponse.redirect(redirectUrl);
  }

  const supabase = await createClient();
  const authResponse = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : await supabase.auth.verifyOtp({
        token_hash: tokenHash!,
        type: type!
      });
  const { data, error } = authResponse;

  if (error || !data.user) {
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("error", "auth_failed");
    return NextResponse.redirect(redirectUrl);
  }

  const sessionWithProvider = data.session as typeof data.session & {
    provider_token?: string;
    provider_refresh_token?: string;
  };

  const profileUpdate: Record<string, string | null> = {
    id: data.user.id,
    email: data.user.email ?? null
  };

  if (sessionWithProvider?.provider_token) {
    profileUpdate.google_access_token = sessionWithProvider.provider_token;
  }
  if (sessionWithProvider?.provider_refresh_token) {
    profileUpdate.google_refresh_token = sessionWithProvider.provider_refresh_token;
  }

  await supabase.from("users").upsert(profileUpdate, { onConflict: "id" });

  return NextResponse.redirect(redirectUrl);
}
