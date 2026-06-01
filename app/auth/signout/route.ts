import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getBaseUrlFromRequest } from "@/lib/env";

export async function POST(request: Request) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login", getBaseUrlFromRequest(request)));
}
