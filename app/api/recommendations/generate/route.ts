import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildStudyRecommendations, rankTasks } from "@/lib/scheduling";
import { getCalendarEvents, getCalendarStatus } from "@/lib/google-calendar";
import type { CalendarEvent, DbTask, DbTaskSession } from "@/lib/types";

export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user }
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "צריך להתחבר מחדש" }, { status: 401 });
    }

    const [tasksResult, sessionsResult, calendarStatus] = await Promise.all([
      supabase.from("tasks").select("*").eq("user_id", user.id),
      supabase
        .from("task_sessions")
        .select("*, tasks:task_id(tasks_id, task_title, course_name, deadline, priority, estimated_minutes)")
        .eq("user_id", user.id),
      getCalendarStatus(supabase, user.id)
    ]);

    if (tasksResult.error) {
      return NextResponse.json({ error: "לא הצלחתי לטעון משימות" }, { status: 500 });
    }
    if (sessionsResult.error) {
      return NextResponse.json({ error: "לא הצלחתי לטעון המלצות קיימות" }, { status: 500 });
    }

    const tasks = (tasksResult.data ?? []) as DbTask[];
    const sessions = (sessionsResult.data ?? []) as DbTaskSession[];
    const openTasks = rankTasks(tasks);

    if (openTasks.length === 0) {
      return NextResponse.json({
        created: 0,
        message: "אין משימות פתוחות לשיבוץ. הוסף משימה חדשה או ודא שהסטטוס שלה לא \"הושלם\"."
      });
    }

    let events: CalendarEvent[] = [];
    let calendarWarning: string | null = null;

    if (calendarStatus.connected) {
      try {
        events = await getCalendarEvents(supabase, user.id);
      } catch {
        calendarWarning = "לא הצלחתי לקרוא את Google Calendar, אז ההמלצות מבוססות על שעות למידה כלליות.";
        events = [];
      }
    } else {
      calendarWarning =
        "Google Calendar לא מחובר, אז ההמלצות מבוססות על שעות למידה כלליות. חבר את היומן להמלצות מדויקות יותר.";
    }

    const recommendations = buildStudyRecommendations({
      tasks,
      sessions,
      events
    });

    if (recommendations.length === 0) {
      const pendingCount = sessions.filter((session) => session.status === "pending").length;
      const message = pendingCount
        ? "כבר יש המלצות ממתינות לכל המשימות הפתוחות. אשר, דחה, או בקש זמן אחר."
        : "לא מצאתי חלון פנוי מתאים לפי הדדליין והזמן המשוער. נסה להאריך דדליין, לקצר זמן משוער, או לחבר את Google Calendar.";

      return NextResponse.json({ created: 0, message, calendarWarning });
    }

    const rows = recommendations.map((recommendation) => ({
      user_id: user.id,
      task_id: recommendation.task.tasks_id,
      start_time: recommendation.start.toISOString(),
      end_time: recommendation.end.toISOString(),
      status: "pending",
      reason: recommendation.reason,
      updated_at: new Date().toISOString()
    }));

    const { error } = await supabase.from("task_sessions").insert(rows);

    if (error) {
      return NextResponse.json(
        {
          error: "לא הצלחתי לשמור המלצות חדשות. נסה שוב בעוד רגע."
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      created: rows.length,
      message: `נוצרו ${rows.length} המלצות חדשות לשיבוץ.`,
      calendarWarning
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "לא הצלחתי ליצור המלצות"
      },
      { status: 500 }
    );
  }
}
