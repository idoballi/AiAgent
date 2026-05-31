import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOpenAiApiKey, getOpenAiModel, isOpenAiConfigured } from "@/lib/env";

export const dynamic = "force-dynamic";

/** בדיקה שהשרת רואה את מפתח OpenAI (בלי לחשוף את המפתח). */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "צריך להתחבר" }, { status: 401 });
  }

  const configured = isOpenAiConfigured();
  const key = getOpenAiApiKey();

  return NextResponse.json({
    configured,
    model: getOpenAiModel(),
    keyPrefix: key ? `${key.slice(0, 7)}...` : null,
    hint: configured
      ? "המפתח נטען בשרת. אם הצ'אט עדיין נכשל, בדוק מודל או מכסת OpenAI."
      : "הוסף OPENAI_API_KEY ב-Vercel → Production → Redeploy. אל תשתמש ב-NEXT_PUBLIC_OPENAI_API_KEY."
  });
}
