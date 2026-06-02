import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getConfiguredAppOrigin } from "@/lib/public-url";

function redirectToCanonicalHost(request: NextRequest) {
  const canonical = getConfiguredAppOrigin();
  if (!canonical) return null;

  let canonicalUrl: URL;
  try {
    canonicalUrl = new URL(canonical);
  } catch {
    return null;
  }

  const host = request.nextUrl.host;
  if (host === canonicalUrl.host) return null;

  const isVercelHost = host.endsWith(".vercel.app");
  if (!isVercelHost) return null;

  const target = new URL(request.nextUrl.pathname + request.nextUrl.search, canonicalUrl.origin);
  return NextResponse.redirect(target);
}

export async function updateSession(request: NextRequest) {
  const canonicalRedirect = redirectToCanonicalHost(request);
  if (canonicalRedirect) return canonicalRedirect;

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) => {
            supabaseResponse.cookies.set(name, value, options);
          });
        }
      }
    }
  );

  const {
    data: { user }
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;

  if (pathname.startsWith("/auth/callback")) {
    return supabaseResponse;
  }

  if (!user && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/app";
    url.search = request.nextUrl.search;
    return NextResponse.redirect(url);
  }

  if (user && (pathname === "/login" || pathname === "/")) {
    const url = request.nextUrl.clone();
    url.pathname = "/app";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
