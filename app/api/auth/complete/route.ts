import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "לא מחובר" }, { status: 401 });
  }

  const {
    data: { session }
  } = await supabase.auth.getSession();

  const sessionWithProvider = session as typeof session & {
    provider_token?: string;
    provider_refresh_token?: string;
  };

  const profileUpdate: Record<string, string | null> = {
    id: user.id,
    email: user.email ?? null
  };

  if (sessionWithProvider?.provider_token) {
    profileUpdate.google_access_token = sessionWithProvider.provider_token;
  }
  if (sessionWithProvider?.provider_refresh_token) {
    profileUpdate.google_refresh_token = sessionWithProvider.provider_refresh_token;
  }

  const { error } = await supabase.from("users").upsert(profileUpdate, { onConflict: "id" });

  if (error) {
    return NextResponse.json({ error: "לא הצלחתי לשמור פרופיל" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
