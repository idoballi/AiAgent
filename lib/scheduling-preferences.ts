import { getTimeZone } from "@/lib/env";
import type { DbMessage } from "@/lib/types";

export type StudyTimePreferences = {
  /** רק כשהמשתמש אמר במפורש "לא ללמוד אחרי X" */
  noStudyAfterHour: number | null;
  /** רק כשהמשתמש אמר במפורש "לא ללמוד לפני X" */
  noStudyBeforeHour: number | null;
  /** הודעות מהצ'אט — מקור עיקרי להעדפות רכות */
  chatContext: string;
  summaryForAi: string;
  hasHardRules: boolean;
};

function getLocalHourMinute(date: Date) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: getTimeZone(),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = formatter.formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  return { hour, minute, totalMinutes: hour * 60 + minute };
}

/**
 * מחלץ העדפות רק ממה שהמשתמש כתב במפורש בצ'אט.
 * אין כלל גלובלי (לא "עד 20:00" כברירת מחדל).
 */
export function extractStudyPreferences(messages: DbMessage[]): StudyTimePreferences {
  const userLines = messages
    .filter((message) => message.role === "user" && message.chatInput?.trim())
    .map((message) => message.chatInput!.trim());

  const userText = userLines.join("\n");
  const chatContext = userLines.length
    ? userLines.map((line, index) => `${index + 1}. ${line}`).join("\n")
    : "אין הודעות מהמשתמש בצ'אט.";

  let noStudyAfterHour: number | null = null;
  let noStudyBeforeHour: number | null = null;

  const explicitNoAfter = [
    /(?:לא|בלי)\s+(?:רוצה|באמת\s+לא\s+רוצה)\s+(?:ל)?למוד\s+אחרי\s+(?:שעה\s+)?(\d{1,2})/i,
    /(?:לא|בלי)\s+ללמוד\s+אחרי\s+(?:שעה\s+)?(\d{1,2})/i,
    /(?:לא|בלי)\s+.*לימוד\s+אחרי\s+(?:שעה\s+)?(\d{1,2})/i
  ];

  for (const pattern of explicitNoAfter) {
    const match = userText.match(pattern);
    if (match) {
      noStudyAfterHour = Number(match[1]);
      break;
    }
  }

  const explicitNoBefore = /(?:לא|בלי)\s+(?:רוצה\s+)?(?:ל)?למוד\s+לפני\s+(?:שעה\s+)?(\d{1,2})/i;
  const noBeforeMatch = userText.match(explicitNoBefore);
  if (noBeforeMatch) {
    noStudyBeforeHour = Number(noBeforeMatch[1]);
  }

  const hasHardRules = noStudyAfterHour !== null || noStudyBeforeHour !== null;

  const hardParts: string[] = [];
  if (noStudyAfterHour !== null) {
    hardParts.push(`המשתמש אמר במפורש: לא ללמוד אחרי ${noStudyAfterHour}:00 — אסור להפר.`);
  }
  if (noStudyBeforeHour !== null) {
    hardParts.push(`המשתמש אמר במפורש: לא ללמוד לפני ${noStudyBeforeHour}:00 — אסור להפר.`);
  }

  const summaryForAi = hasHardRules
    ? `${hardParts.join(" ")}\nבנוסף, קרא את כל הודעות הצ'אט להעדפות רכות (מתי נוח, משך, בוקר/ערב).`
    : `אין מגבלות קשיחות מוגדרות מראש. אל תניח "לא אחרי 20:00" או כלל אחר אלא אם המשתמש כתב זאת במפורש.\nקרא את הודעות הצ'אט והתאם שיבוץ להעדפות, לוח זמנים ודדליין — בצורה גמישה.`;

  return {
    noStudyAfterHour,
    noStudyBeforeHour,
    chatContext,
    summaryForAi,
    hasHardRules
  };
}

/** אימות קשיח רק כשיש כלל מפורש מהצ'אט */
export function violatesStudyPreferences(
  start: Date,
  end: Date,
  preferences: StudyTimePreferences
): boolean {
  if (!preferences.hasHardRules) return false;
  if (end <= start) return true;

  const startLocal = getLocalHourMinute(start);
  const endLocal = getLocalHourMinute(end);

  if (preferences.noStudyBeforeHour !== null && startLocal.hour < preferences.noStudyBeforeHour) {
    return true;
  }

  if (preferences.noStudyAfterHour !== null) {
    const limit = preferences.noStudyAfterHour * 60;
    if (startLocal.totalMinutes >= limit) return true;
    if (endLocal.totalMinutes > limit) return true;
    if (endLocal.totalMinutes < startLocal.totalMinutes) return true;
  }

  return false;
}

/** מצמצם חלונות רק כשיש כלל קשיח מפורש — לא כברירת מחדל */
export function filterFreeWindowsByPreferences<T extends { start: Date; end: Date }>(
  windows: T[],
  preferences: StudyTimePreferences
): T[] {
  if (!preferences.hasHardRules) return windows;

  return windows.filter((window) => {
    const startLocal = getLocalHourMinute(window.start);
    const endLocal = getLocalHourMinute(window.end);
    const limit = preferences.noStudyAfterHour !== null ? preferences.noStudyAfterHour * 60 : null;

    if (preferences.noStudyBeforeHour !== null && startLocal.hour < preferences.noStudyBeforeHour) {
      return false;
    }

    if (limit !== null) {
      if (startLocal.totalMinutes >= limit) return false;
      const availableBeforeLimit = limit - startLocal.totalMinutes;
      if (availableBeforeLimit < 30) return false;
      if (endLocal.totalMinutes > limit && endLocal.totalMinutes >= startLocal.totalMinutes) {
        return availableBeforeLimit >= 30;
      }
    }

    return true;
  });
}
