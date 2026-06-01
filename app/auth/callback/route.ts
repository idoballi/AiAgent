import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

function safeNextPath(next: string | null) {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/app";
  return next;
}

export async function GET(request: NextRequest) {
  const requestUrl = request.nextUrl;
  const code = requestUrl.searchParams.get("code");
  const tokenHash = requestUrl.searchParams.get("token_hash");
  const type = requestUrl.searchParams.get("type") as EmailOtpType | null;
  const next = safeNextPath(requestUrl.searchParams.get("next"));
  const origin = requestUrl.origin;

  const successUrl = new URL(next, origin);
  const loginUrl = new URL("/login", origin);

  if (!code && !(tokenHash && type)) {
    loginUrl.searchParams.set("error", "missing_code");
    return NextResponse.redirect(loginUrl);
  }

  const supabaseResponse = NextResponse.redirect(successUrl);

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(name, value, options);
          });
        }
      }
    }
  );

  let authError: Error | null = null;
  let userId: string | null = null;
  let providerToken: string | undefined;
  let providerRefreshToken: string | undefined;

  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    authError = error;
    userId = data.user?.id ?? null;
    const session = data.session as typeof data.session & {
      provider_token?: string;
      provider_refresh_token?: string;
    };
    providerToken = session?.provider_token;
    providerRefreshToken = session?.provider_refresh_token;
  } else if (tokenHash && type) {
    const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    authError = error;
    userId = data.user?.id ?? null;
  }

  if (authError || !userId) {
    loginUrl.searchParams.set("error", "auth_failed");
    return NextResponse.redirect(loginUrl);
  }

  const {
    data: { user }
  } = await supabase.auth.getUser();

  const profileUpdate: Record<string, string | null> = {
    id: userId,
    email: user?.email ?? null
  };

  if (providerToken) profileUpdate.google_access_token = providerToken;
  if (providerRefreshToken) profileUpdate.google_refresh_token = providerRefreshToken;

  await supabase.from("users").upsert(profileUpdate, { onConflict: "id" });

  return supabaseResponse;
}
