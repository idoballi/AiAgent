"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { EmailOtpType } from "@supabase/supabase-js";

export default function AuthCallbackPage() {
  const router = useRouter();
  const [status, setStatus] = useState("מתחבר...");

  useEffect(() => {
    const supabase = createClient();

    async function finishLogin() {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const tokenHash = params.get("token_hash");
      const type = params.get("type") as EmailOtpType | null;
      const next = params.get("next") || "/app";

      try {
        if (code) {
          setStatus("מאמת התחברות עם Google...");
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else if (tokenHash && type) {
          setStatus("מאמת קישור מהמייל...");
          const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
          if (error) throw error;
        } else {
          router.replace("/login?error=missing_code");
          return;
        }

        setStatus("שומר פרופיל...");
        const syncResponse = await fetch("/api/auth/complete", { method: "POST" });
        if (!syncResponse.ok) {
          console.warn("Profile sync failed, continuing to app");
        }

        router.replace(next.startsWith("/") ? next : "/app");
      } catch {
        router.replace("/login?error=auth_failed");
      }
    }

    finishLogin();
  }, [router]);

  return (
    <main className="auth-page page" style={{ placeItems: "center", minHeight: "60vh" }}>
      <p className="notice" style={{ maxWidth: 420, textAlign: "center" }}>
        {status}
      </p>
    </main>
  );
}
