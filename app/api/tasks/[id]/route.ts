import { NextResponse } from "next/server";
import { deleteCalendarEvent } from "@/lib/google-calendar";
import { createClient } from "@/lib/supabase/server";
import { parseRequestJson } from "@/lib/api-json";

type Params = {
  params: Promise<{ id: string }>;
};

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "צריך להתחבר מחדש" }, { status: 401 });

  const body = await parseRequestJson<{ status?: string }>(request);
  const status = body?.status;
  if (!status) {
    return NextResponse.json({ error: "לא נבחר סטטוס" }, { status: 400 });
  }

  const { error } = await supabase
    .from("tasks")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("tasks_id", id)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: "לא הצלחתי לעדכן את המשימה" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "צריך להתחבר מחדש" }, { status: 401 });
  }

  const { data: task } = await supabase
    .from("tasks")
    .select("tasks_id")
    .eq("tasks_id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!task) {
    return NextResponse.json({ error: "לא מצאתי את המשימה" }, { status: 404 });
  }

  const { data: sessions } = await supabase
    .from("task_sessions")
    .select("google_calendar_event_id")
    .eq("task_id", id)
    .eq("user_id", user.id);

  for (const session of sessions ?? []) {
    if (!session.google_calendar_event_id) continue;
    try {
      await deleteCalendarEvent(supabase, user.id, session.google_calendar_event_id);
    } catch {
      // Keep deleting the task even if Google Calendar is unavailable.
    }
  }

  const { error: sessionsError } = await supabase
    .from("task_sessions")
    .delete()
    .eq("task_id", id)
    .eq("user_id", user.id);

  if (sessionsError) {
    return NextResponse.json({ error: "לא הצלחתי למחוק את השיבוצים של המשימה" }, { status: 500 });
  }

  const { error: taskError } = await supabase.from("tasks").delete().eq("tasks_id", id).eq("user_id", user.id);

  if (taskError) {
    return NextResponse.json({ error: "לא הצלחתי למחוק את המשימה" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    message: "המשימה נמחקה. אם היה לה שיבוץ ביומן, גם האירוע נמחק."
  });
}
