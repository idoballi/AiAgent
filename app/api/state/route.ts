import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensureUserProfile, getAppState } from "@/lib/data";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "צריך להתחבר מחדש" }, { status: 401 });
  }

  await ensureUserProfile(supabase, user);
  const state = await getAppState(supabase, user.id);
  return NextResponse.json(state);
}
