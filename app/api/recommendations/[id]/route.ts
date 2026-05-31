import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createCalendarStudyEvent } from "@/lib/google-calendar";
import { parseRequestJson } from "@/lib/api-json";
import type { DbTaskSession } from "@/lib/types";

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

  const body = await parseRequestJson<{ action?: "approve" | "reject" | "alternate" | "complete" }>(request);
  const action = body?.action;
  if (!action) {
    return NextResponse.json({ error: "לא נבחרה פעולה" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("task_sessions")
    .select("*, tasks:task_id(tasks_id, task_title, course_name, deadline, priority, estimated_minutes)")
    .eq("session_id", id)
    .eq("user_id", user.id)
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "לא מצאתי את ההמלצה" }, { status: 404 });
  }

  const session = data as DbTaskSession;

  if (action === "reject" || action === "alternate") {
    await supabase
      .from("task_sessions")
      .update({ status: "rejected", updated_at: new Date().toISOString() })
      .eq("session_id", id)
      .eq("user_id", user.id);

    return NextResponse.json({
      ok: true,
      message: action === "alternate" ? "דחיתי את ההצעה. אפשר ליצור המלצות חדשות." : "ההמלצה נדחתה"
    });
  }

  if (action === "complete") {
    await supabase
      .from("task_sessions")
      .update({ status: "completed", updated_at: new Date().toISOString() })
      .eq("session_id", id)
      .eq("user_id", user.id);
    return NextResponse.json({ ok: true, message: "סומן כהושלם" });
  }

  if (action !== "approve") {
    return NextResponse.json({ error: "פעולה לא נכונה" }, { status: 400 });
  }

  if (!session.start_time || !session.end_time) {
    return NextResponse.json({ error: "להמלצה חסר זמן התחלה או סיום" }, { status: 400 });
  }

  const taskTitle = session.tasks?.task_title || "סשן למידה";

  try {
    const event = await createCalendarStudyEvent(supabase, user.id, {
      title: `למידה: ${taskTitle}`,
      description: session.reason || "סשן למידה שנוצר דרך סוכן הלימודים החכם.",
      start: session.start_time,
      end: session.end_time
    });

    await supabase
      .from("task_sessions")
      .update({
        status: "scheduled",
        google_calendar_event_id: event.id,
        updated_at: new Date().toISOString()
      })
      .eq("session_id", id)
      .eq("user_id", user.id);

    return NextResponse.json({ ok: true, message: "השיבוץ אושר ונוצר אירוע ביומן" });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "לא הצלחתי ליצור אירוע ביומן"
      },
      { status: 500 }
    );
  }
}
