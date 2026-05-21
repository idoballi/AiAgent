import type { SupabaseClient } from "@supabase/supabase-js";
import { getTimeZone } from "@/lib/env";
import type { CalendarEvent, CalendarStatus } from "@/lib/types";

type GoogleTokenRow = {
  google_access_token: string | null;
  google_refresh_token: string | null;
};

async function getStoredTokens(supabase: SupabaseClient, userId: string): Promise<GoogleTokenRow> {
  const { data, error } = await supabase
    .from("users")
    .select("google_access_token, google_refresh_token")
    .eq("id", userId)
    .single();

  if (error) {
    return { google_access_token: null, google_refresh_token: null };
  }

  return data as GoogleTokenRow;
}

export async function getCalendarStatus(
  supabase: SupabaseClient,
  userId: string
): Promise<CalendarStatus> {
  const tokens = await getStoredTokens(supabase, userId);
  if (!tokens.google_access_token && !tokens.google_refresh_token) {
    return {
      connected: false,
      message: "חבר את Google Calendar כדי לקבל המלצות מדויקות"
    };
  }

  return {
    connected: true,
    message: "Google Calendar מחובר"
  };
}

async function refreshAccessToken(supabase: SupabaseClient, userId: string, refreshToken: string) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("חסרים GOOGLE_CLIENT_ID או GOOGLE_CLIENT_SECRET לרענון החיבור ליומן");
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token"
    })
  });

  if (!response.ok) {
    throw new Error("לא הצלחתי לרענן את החיבור ל-Google Calendar");
  }

  const payload = (await response.json()) as { access_token?: string };
  if (!payload.access_token) {
    throw new Error("Google לא החזיר אסימון גישה חדש");
  }

  await supabase
    .from("users")
    .update({ google_access_token: payload.access_token })
    .eq("id", userId);

  return payload.access_token;
}

async function withGoogleToken<T>(
  supabase: SupabaseClient,
  userId: string,
  run: (accessToken: string) => Promise<T>
) {
  const tokens = await getStoredTokens(supabase, userId);
  if (!tokens.google_access_token && !tokens.google_refresh_token) {
    throw new Error("Google Calendar עדיין לא מחובר");
  }

  const initialToken = tokens.google_access_token;
  if (initialToken) {
    try {
      return await run(initialToken);
    } catch (error) {
      if (!tokens.google_refresh_token) throw error;
    }
  }

  const refreshedToken = await refreshAccessToken(supabase, userId, tokens.google_refresh_token!);
  return run(refreshedToken);
}

function toCalendarEvent(item: {
  id?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}): CalendarEvent | null {
  const start = item.start?.dateTime ?? item.start?.date;
  const end = item.end?.dateTime ?? item.end?.date;
  if (!item.id || !start || !end) return null;

  return {
    id: item.id,
    summary: item.summary || "אירוע ללא כותרת",
    start,
    end
  };
}

export async function getCalendarEvents(supabase: SupabaseClient, userId: string, days = 14) {
  return withGoogleToken(supabase, userId, async (accessToken) => {
    const now = new Date();
    const max = new Date(now);
    max.setDate(max.getDate() + days);

    const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    url.searchParams.set("timeMin", now.toISOString());
    url.searchParams.set("timeMax", max.toISOString());
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", "50");

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });

    if (response.status === 401) {
      throw new Error("TOKEN_EXPIRED");
    }

    if (!response.ok) {
      throw new Error("לא הצלחתי לקרוא אירועים מ-Google Calendar");
    }

    const payload = (await response.json()) as { items?: unknown[] };
    return (payload.items ?? [])
      .map((item) => toCalendarEvent(item as Parameters<typeof toCalendarEvent>[0]))
      .filter((event): event is CalendarEvent => Boolean(event));
  });
}

export async function createCalendarStudyEvent(
  supabase: SupabaseClient,
  userId: string,
  input: {
    title: string;
    description: string;
    start: string;
    end: string;
  }
) {
  return withGoogleToken(supabase, userId, async (accessToken) => {
    const response = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        summary: input.title,
        description: input.description,
        start: {
          dateTime: input.start,
          timeZone: getTimeZone()
        },
        end: {
          dateTime: input.end,
          timeZone: getTimeZone()
        }
      })
    });

    if (response.status === 401) {
      throw new Error("TOKEN_EXPIRED");
    }

    if (!response.ok) {
      throw new Error("לא הצלחתי ליצור אירוע ב-Google Calendar");
    }

    return (await response.json()) as { id: string };
  });
}
