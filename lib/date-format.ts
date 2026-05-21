import { getTimeZone } from "@/lib/env";

export function formatDateTime(value: string | Date | null | undefined, options?: Intl.DateTimeFormatOptions) {
  if (!value) return "לא נקבע";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "לא נקבע";

  return new Intl.DateTimeFormat("he-IL", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: getTimeZone(),
    ...options
  }).format(date);
}

export function formatTimeRange(start: string | Date, end: string | Date) {
  const startDate = typeof start === "string" ? new Date(start) : start;
  const endDate = typeof end === "string" ? new Date(end) : end;
  const formatter = new Intl.DateTimeFormat("he-IL", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: getTimeZone()
  });

  return `${formatter.format(startDate)}-${formatter.format(endDate)}`;
}

export function formatShortDay(value: string | Date) {
  const date = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("he-IL", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: getTimeZone()
  }).format(date);
}
