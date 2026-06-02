import { createClient } from "@/lib/supabase/server";
import { ensureUserProfile, getAppState } from "@/lib/data";
import { HomeLanding } from "@/components/home-landing";
import { StudentAgentApp } from "@/components/student-agent-app";

export const dynamic = "force-dynamic";

export default async function AppPage() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return <HomeLanding />;
  }

  await ensureUserProfile(supabase, user);
  const state = await getAppState(supabase, user.id);

  return <StudentAgentApp initialState={state} userEmail={user.email ?? "סטודנט"} />;
}
