import { NextResponse } from "next/server";
import { deleteCalendarEvent } from "@/lib/google-calendar";
import { createClient } from "@/lib/supabase/server";
import { parseRequestJson } from "@/lib/api-json";

type Params = {
  params: Promise<{ id: string }>;
};

type TaskUpdateBody = {
  status?: string;
  task_title?: string;
  description?: string;
  course_name?: string;
  task_type?: string;
  deadline?: string | null;
  estimated_minutes?: number;
  priority?: number;
};

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "צריך להתחבר מחדש" }, { status: 401 });

  const body = await parseRequestJson<TaskUpdateBody>(request);
  if (!body) {
    return NextResponse.json({ error: "גוף הבקשה לא תקין" }, { status: 400 });
  }

  const isFullUpdate =
    body.task_title !== undefined ||
    body.description !== undefined ||
    body.course_name !== undefined ||
    body.task_type !== undefined ||
    body.deadline !== undefined ||
    body.estimated_minutes !== undefined ||
    body.priority !== undefined;

  if (isFullUpdate) {
    if (!body.task_title?.trim()) {
      return NextResponse.json({ error: "צריך להזין כותרת למשימה" }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("tasks")
      .update({
        task_title: body.task_title.trim(),
        description: body.description?.trim() || null,
        course_name: body.course_name?.trim() || null,
        task_type: body.task_type || "assignment",
        deadline: body.deadline ?? null,
        estimated_minutes: body.estimated_minutes ?? 60,
        priority: body.priority ?? 3,
        status: body.status || "open",
        updated_at: new Date().toISOString()
      })
      .eq("tasks_id", id)
      .eq("user_id", user.id)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: "לא הצלחתי לעדכן את המשימה" }, { status: 500 });
    }

    return NextResponse.json(data);
  }

  const status = body.status;
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
