import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensureUserProfile } from "@/lib/data";
import { parseRequestJson } from "@/lib/api-json";

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) return NextResponse.json({ error: "צריך להתחבר מחדש" }, { status: 401 });
  await ensureUserProfile(supabase, user);

  const body = await parseRequestJson<{
    task_title?: string;
    description?: string;
    course_name?: string;
    task_type?: string;
    deadline?: string;
    estimated_minutes?: number;
    priority?: number;
    status?: string;
  }>(request);

  if (!body) {
    return NextResponse.json({ error: "גוף הבקשה לא תקין" }, { status: 400 });
  }

  if (!body.task_title?.trim()) {
    return NextResponse.json({ error: "צריך להזין כותרת למשימה" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("tasks")
    .insert({
      user_id: user.id,
      task_title: body.task_title.trim(),
      description: body.description?.trim() || null,
      course_name: body.course_name?.trim() || null,
      task_type: body.task_type || "assignment",
      deadline: body.deadline || null,
      estimated_minutes: body.estimated_minutes || 60,
      priority: body.priority || 3,
      status: body.status || "open",
      updated_at: new Date().toISOString()
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: "לא הצלחתי לשמור את המשימה" }, { status: 500 });
  }

  return NextResponse.json(data);
}
