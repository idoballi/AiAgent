import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildStudyRecommendations } from "@/lib/scheduling";
import { getCalendarEvents, getCalendarStatus } from "@/lib/google-calendar";
import type { DbTask, DbTaskSession } from "@/lib/types";

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "צריך להתחבר מחדש" }, { status: 401 });

  const calendarStatus = await getCalendarStatus(supabase, user.id);
  if (!calendarStatus.connected) {
    return NextResponse.json({ error: "חבר את Google Calendar כדי לקבל המלצות מדויקות" }, { status: 400 });
  }

  const [tasksResult, sessionsResult] = await Promise.all([
    supabase.from("tasks").select("*").eq("user_id", user.id),
    supabase
      .from("task_sessions")
      .select("*, tasks:task_id(tasks_id, task_title, course_name, deadline, priority, estimated_minutes)")
      .eq("user_id", user.id)
  ]);

  if (tasksResult.error) return NextResponse.json({ error: "לא הצלחתי לטעון משימות" }, { status: 500 });
  if (sessionsResult.error) return NextResponse.json({ error: "לא הצלחתי לטעון המלצות" }, { status: 500 });

  const events = await getCalendarEvents(supabase, user.id);
  const recommendations = buildStudyRecommendations({
    tasks: (tasksResult.data ?? []) as DbTask[],
    sessions: (sessionsResult.data ?? []) as DbTaskSession[],
    events
  });

  if (recommendations.length === 0) {
    return NextResponse.json({ created: 0, message: "אין כרגע חלון פנוי מתאים למשימות הקרובות" });
  }

  const rows = recommendations.map((recommendation) => ({
    user_id: user.id,
    task_id: recommendation.task.tasks_id,
    start_time: recommendation.start.toISOString(),
    end_time: recommendation.end.toISOString(),
    status: "pending",
    reason: recommendation.reason,
    notes: "נוצר אוטומטית לפי דדליין, עדיפות וזמינות ביומן",
    updated_at: new Date().toISOString()
  }));

  const { error } = await supabase.from("task_sessions").insert(rows);

  if (error) {
    return NextResponse.json({ error: "לא הצלחתי לשמור המלצות חדשות" }, { status: 500 });
  }

  return NextResponse.json({ created: rows.length, message: "נוצרו המלצות חדשות לשיבוץ" });
}
