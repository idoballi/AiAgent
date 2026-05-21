import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

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

  const body = (await request.json()) as { status?: string };
  if (!body.status) {
    return NextResponse.json({ error: "לא נבחר סטטוס" }, { status: 400 });
  }

  const { error } = await supabase
    .from("tasks")
    .update({ status: body.status, updated_at: new Date().toISOString() })
    .eq("tasks_id", id)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json({ error: "לא הצלחתי לעדכן את המשימה" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
