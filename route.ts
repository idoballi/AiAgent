import { NextResponse } from "next/server";
import { deleteCalendarEvent } from "@/lib/google-calendar";
import { createClient } from "@/lib/supabase/server";

type Params = {
  params: Promise<{ id: string }>;
};

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "צריך להתחבר מחדש" }, { status: 401 });
  }

  try {
    await deleteCalendarEvent(supabase, user.id, id);

    await supabase
      .from("task_sessions")
      .update({
        status: "rejected",
        google_calendar_event_id: null,
        updated_at: new Date().toISOString()
      })
      .eq("user_id", user.id)
      .eq("google_calendar_event_id", id);

    return NextResponse.json({ ok: true, message: "האירוע נמחק מהיומן" });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "לא הצלחתי למחוק את האירוע"
      },
      { status: 500 }
    );
  }
}
