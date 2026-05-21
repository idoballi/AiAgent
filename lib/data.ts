import type { SupabaseClient, User } from "@supabase/supabase-js";
import { getCalendarEvents, getCalendarStatus } from "@/lib/google-calendar";
import type { AppState, CalendarEvent, DbMessage, DbTask, DbTaskSession } from "@/lib/types";

export async function ensureUserProfile(supabase: SupabaseClient, user: User) {
  const { error } = await supabase.from("users").upsert(
    {
      id: user.id,
      email: user.email ?? null
    },
    { onConflict: "id" }
  );

  if (error) {
    throw new Error(`Failed to ensure user profile: ${error.message}`);
  }
}

export async function getAppState(supabase: SupabaseClient, userId: string): Promise<AppState> {
  const [tasksResult, messagesResult, sessionsResult, status] = await Promise.all([
    supabase
      .from("tasks")
      .select("*")
      .eq("user_id", userId)
      .order("deadline", { ascending: true, nullsFirst: false }),
    supabase
      .from("messages")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("task_sessions")
      .select(
        "*, tasks:task_id(tasks_id, task_title, course_name, deadline, priority, estimated_minutes)"
      )
      .eq("user_id", userId)
      .order("start_time", { ascending: true, nullsFirst: false }),
    getCalendarStatus(supabase, userId)
  ]);

  if (tasksResult.error) throw new Error(tasksResult.error.message);
  if (messagesResult.error) throw new Error(messagesResult.error.message);
  if (sessionsResult.error) throw new Error(sessionsResult.error.message);

  let calendarEvents: CalendarEvent[] = [];
  if (status.connected) {
    try {
      calendarEvents = await getCalendarEvents(supabase, userId);
    } catch {
      calendarEvents = [];
    }
  }

  return {
    tasks: (tasksResult.data ?? []) as DbTask[],
    messages: ((messagesResult.data ?? []) as DbMessage[]).reverse(),
    sessions: (sessionsResult.data ?? []) as DbTaskSession[],
    calendarEvents,
    calendarStatus: status
  };
}

export async function getRecentMessages(supabase: SupabaseClient, userId: string, limit = 10) {
  const { data, error } = await supabase
    .from("messages")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  return ((data ?? []) as DbMessage[]).reverse();
}
