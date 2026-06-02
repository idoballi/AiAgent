"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CalendarCheck, Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getAuthCallbackUrl } from "@/lib/public-url";

const authErrors: Record<string, string> = {
  missing_code: "חסר קוד התחברות. ודא שב-Supabase מוגדר Redirect: https://automationsstudypilot.tech/auth/callback",
  auth_failed: "ההתחברות נכשלה. נסה שוב או בדוק הגדרות Google ב-Supabase."
};

export function AuthPanel() {
  const supabase = createClient();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const oauthCode = searchParams.get("code");
    if (oauthCode) {
      router.replace(`/auth/callback?${searchParams.toString()}`);
      return;
    }

    const code = searchParams.get("error");
    if (code && authErrors[code]) {
      setError(authErrors[code]);
    }
  }, [searchParams, router]);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        router.replace("/app");
      }
    });
  }, [router, supabase]);

  async function loginWithEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    const redirectTo = getAuthCallbackUrl("/app");
    const { error: authError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: redirectTo
      }
    });

    setLoading(false);
    if (authError) {
      setError("לא הצלחתי לשלוח קישור התחברות. בדוק את כתובת המייל ונסה שוב.");
      return;
    }

    setMessage("שלחנו לך קישור התחברות למייל.");
  }

  async function loginWithGoogle() {
    setLoading(true);
    setError(null);
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: getAuthCallbackUrl("/app"),
        scopes:
          "email profile https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events",
        queryParams: {
          access_type: "offline",
          prompt: "consent"
        }
      }
    });

    if (authError) {
      setLoading(false);
      setError("לא הצלחתי להתחבר עם Google. ודא שהספק מוגדר ב-Supabase.");
    }
  }

  return (
    <section className="auth-card">
      <div>
        <h2>כניסה לחשבון</h2>
        <p>התחבר עם Google כדי לחבר גם את היומן, או קבל קישור התחברות למייל.</p>
      </div>

      <button className="button primary full" type="button" onClick={loginWithGoogle} disabled={loading}>
        <CalendarCheck size={18} />
        המשך עם Google
      </button>

      <form className="form-grid" onSubmit={loginWithEmail}>
        <div className="field">
          <label htmlFor="email">אימייל</label>
          <input
            className="input"
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@example.com"
            required
          />
        </div>
        <button className="button secondary full" type="submit" disabled={loading}>
          <Mail size={18} />
          שלח קישור התחברות
        </button>
      </form>

      {message ? <div className="notice">{message}</div> : null}
      {error ? <div className="error">{error}</div> : null}
    </section>
  );
}
