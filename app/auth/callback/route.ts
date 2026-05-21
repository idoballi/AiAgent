import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getBaseUrl } from "@/lib/env";

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const next = requestUrl.searchParams.get("next") ?? "/app";
  const redirectUrl = new URL(next, getBaseUrl());

  if (!code) {
    redirectUrl.pathname = "/login";
    redirectUrl.searchParams.set("error", "missing_code");
    return NextResponse.redirect(redirectUrl);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

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
