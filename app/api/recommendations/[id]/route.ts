import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createCalendarStudyEvent, getCalendarEvents } from "@/lib/google-calendar";
import { parseRequestJson } from "@/lib/api-json";
import { getRecentMessages } from "@/lib/data";
import { generateAlternateStudyRecommendation } from "@/lib/ai-scheduling";
import { formatDateTime, formatTimeRange } from "@/lib/date-format";
import type { CalendarEvent, DbTask, DbTaskSession } from "@/lib/types";

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

  if (action === "reject") {
    await supabase
      .from("task_sessions")
      .update({ status: "rejected", updated_at: new Date().toISOString() })
      .eq("session_id", id)
      .eq("user_id", user.id);

    return NextResponse.json({ ok: true, message: "ההמלצה נדחתה" });
  }

  if (action === "alternate") {
    await supabase
      .from("task_sessions")
      .update({ status: "rejected", updated_at: new Date().toISOString() })
      .eq("session_id", id)
      .eq("user_id", user.id);

    const { data: task } = await supabase
      .from("tasks")
      .select("*")
      .eq("tasks_id", session.task_id)
      .eq("user_id", user.id)
      .single();

    if (!task) {
      return NextResponse.json({ error: "לא מצאתי את המשימה להמלצה חלופית" }, { status: 404 });
    }

    const [allSessionsResult, recentMessages] = await Promise.all([
      supabase
        .from("task_sessions")
        .select("*, tasks:task_id(tasks_id, task_title, course_name, deadline, priority, estimated_minutes)")
        .eq("user_id", user.id),
      getRecentMessages(supabase, user.id, 15)
    ]);

    let events: CalendarEvent[] = [];
    try {
      events = await getCalendarEvents(supabase, user.id);
    } catch {
      events = [];
    }

    const { recommendation: alternate, source } = await generateAlternateStudyRecommendation({
      task: task as DbTask,
      events,
      sessions: (allSessionsResult.data ?? []) as DbTaskSession[],
      recentMessages
    });

    if (!alternate) {
      return NextResponse.json({
        ok: true,
        message: "דחיתי את ההצעה, אבל לא מצאתי חלון פנוי אחר. נסה לכתוב בצ'אט מתי נוח לך, או לשנות דדליין."
      });
    }

    const { error: insertError } = await supabase.from("task_sessions").insert({
      user_id: user.id,
      task_id: alternate.task.tasks_id,
      start_time: alternate.start.toISOString(),
      end_time: alternate.end.toISOString(),
      status: "pending",
      reason: alternate.reason,
      updated_at: new Date().toISOString()
    });

    if (insertError) {
      return NextResponse.json({ error: "לא הצלחתי לשמור המלצה חלופית" }, { status: 500 });
    }

    const aiNote = source === "ai" ? " (AI)" : "";
    return NextResponse.json({
      ok: true,
      message: `הצעתי זמן חדש${aiNote}: ${formatDateTime(alternate.start)} · ${formatTimeRange(alternate.start, alternate.end)}`
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
