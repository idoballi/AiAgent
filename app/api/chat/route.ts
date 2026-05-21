import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensureUserProfile, getRecentMessages } from "@/lib/data";
import { generateAssistantReply } from "@/lib/ai";
import { getCalendarEvents } from "@/lib/google-calendar";
import type { CalendarEvent, DbTask, DbTaskSession } from "@/lib/types";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "צריך להתחבר מחדש" }, { status: 401 });
  await ensureUserProfile(supabase, user);

  const { message } = (await request.json()) as { message?: string };
  const cleanMessage = message?.trim();

  if (!cleanMessage) {
    return NextResponse.json({ error: "צריך לכתוב הודעה" }, { status: 400 });
  }

  const { error: userMessageError } = await supabase.from("messages").insert({
    user_id: user.id,
    role: "user",
    chatInput: cleanMessage,
    source: "web"
  });

  if (userMessageError) {
    return NextResponse.json({ error: "לא הצלחתי לשמור את ההודעה" }, { status: 500 });
  }

  const [recentMessages, tasksResult, sessionsResult] = await Promise.all([
    getRecentMessages(supabase, user.id, 10),
    supabase.from("tasks").select("*").eq("user_id", user.id),
    supabase
      .from("task_sessions")
      .select("*, tasks:task_id(tasks_id, task_title, course_name, deadline, priority, estimated_minutes)")
      .eq("user_id", user.id)
  ]);

  if (tasksResult.error) throw new Error(tasksResult.error.message);
  if (sessionsResult.error) throw new Error(sessionsResult.error.message);

  let events: CalendarEvent[] = [];
  try {
    events = await getCalendarEvents(supabase, user.id);
  } catch {
    events = [];
  }

  const reply = await generateAssistantReply({
    userMessage: cleanMessage,
    recentMessages,
    tasks: (tasksResult.data ?? []) as DbTask[],
    sessions: (sessionsResult.data ?? []) as DbTaskSession[],
    events
  });

  const { data: assistantMessage, error: assistantError } = await supabase
    .from("messages")
    .insert({
      user_id: user.id,
      role: "assistant",
      chatInput: reply,
      source: "web"
    })
    .select("*")
    .single();

  if (assistantError) {
    return NextResponse.json({ error: "לא הצלחתי לשמור את תשובת הסוכן" }, { status: 500 });
  }

  return NextResponse.json({ reply, assistantMessage });
}
