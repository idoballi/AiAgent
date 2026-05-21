import { formatDateTime, formatShortDay, formatTimeRange } from "@/lib/date-format";
import type { CalendarEvent, DbTask, DbTaskSession, FreeWindow } from "@/lib/types";

const WORK_START_HOUR = 8;
const WORK_END_HOUR = 22;
const MIN_WINDOW_MINUTES = 30;

function durationMinutes(start: Date, end: Date) {
  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
}

function clampDate(date: Date, min: Date, max: Date) {
  if (date < min) return min;
  if (date > max) return max;
  return date;
}

function eventToBusy(event: CalendarEvent) {
  return {
    start: new Date(event.start),
    end: new Date(event.end)
  };
}

function sessionToBusy(session: DbTaskSession) {
  if (!session.start_time || !session.end_time || session.status === "rejected") return null;
  return {
    start: new Date(session.start_time),
    end: new Date(session.end_time)
  };
}

export function findFreeWindows(
  events: CalendarEvent[],
  sessions: DbTaskSession[],
  days = 7,
  now = new Date()
): FreeWindow[] {
  const horizon = new Date(now);
  horizon.setDate(horizon.getDate() + days);

  const busy = [
    ...events.map(eventToBusy),
    ...sessions.map(sessionToBusy).filter((value): value is { start: Date; end: Date } => Boolean(value))
  ]
    .filter((slot) => slot.end > now && slot.start < horizon)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const windows: FreeWindow[] = [];

  for (let dayOffset = 0; dayOffset < days; dayOffset += 1) {
    const day = new Date(now);
    day.setDate(now.getDate() + dayOffset);
    day.setHours(0, 0, 0, 0);

    const workStart = new Date(day);
    workStart.setHours(WORK_START_HOUR, 0, 0, 0);
    const workEnd = new Date(day);
    workEnd.setHours(WORK_END_HOUR, 0, 0, 0);

    let cursor = clampDate(new Date(workStart), now, workEnd);
    const dayBusy = busy
      .map((slot) => ({
        start: clampDate(slot.start, workStart, workEnd),
        end: clampDate(slot.end, workStart, workEnd)
      }))
      .filter((slot) => slot.end > workStart && slot.start < workEnd && slot.end > slot.start)
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    for (const slot of dayBusy) {
      if (durationMinutes(cursor, slot.start) >= MIN_WINDOW_MINUTES) {
        windows.push({ start: new Date(cursor), end: new Date(slot.start) });
      }
      if (slot.end > cursor) cursor = new Date(slot.end);
    }

    if (durationMinutes(cursor, workEnd) >= MIN_WINDOW_MINUTES) {
      windows.push({ start: new Date(cursor), end: new Date(workEnd) });
    }
  }

  return windows;
}

function taskScore(task: DbTask, now = new Date()) {
  const priority = Number(task.priority ?? 3);
  const deadline = task.deadline ? new Date(task.deadline) : null;
  const hoursUntilDeadline = deadline
    ? Math.max(1, (deadline.getTime() - now.getTime()) / 36e5)
    : 24 * 14;
  const urgencyScore = Math.max(0, 1000 / hoursUntilDeadline);

  return urgencyScore + priority * 12;
}

export function rankTasks(tasks: DbTask[]) {
  return tasks
    .filter((task) => !["completed", "done", "הושלם"].includes(task.status))
    .sort((a, b) => taskScore(b) - taskScore(a));
}

export function buildStudyRecommendations(input: {
  tasks: DbTask[];
  events: CalendarEvent[];
  sessions: DbTaskSession[];
  max?: number;
}) {
  const freeWindows = findFreeWindows(input.events, input.sessions);
  const rankedTasks = rankTasks(input.tasks);
  const recommendations: Array<{
    task: DbTask;
    start: Date;
    end: Date;
    reason: string;
  }> = [];

  const usedWindows: FreeWindow[] = [];

  for (const task of rankedTasks) {
    if (recommendations.length >= (input.max ?? 5)) break;

    const minutes = Math.max(30, Math.min(Number(task.estimated_minutes ?? 60), 180));
    const deadline = task.deadline ? new Date(task.deadline) : null;

    const match = freeWindows.find((window) => {
      const available = durationMinutes(window.start, window.end);
      const notUsed = !usedWindows.some(
        (used) => used.start.getTime() === window.start.getTime() && used.end.getTime() === window.end.getTime()
      );
      const beforeDeadline = !deadline || window.start < deadline;
      return available >= minutes && notUsed && beforeDeadline;
    });

    if (!match) continue;

    const end = new Date(match.start);
    end.setMinutes(end.getMinutes() + minutes);
    const priorityLabel = Number(task.priority ?? 3) >= 4 ? "גבוהה" : "רגילה";
    const title = task.task_title || "המשימה";

    recommendations.push({
      task,
      start: match.start,
      end,
      reason: `יש לך חלון פנוי ביום ${formatShortDay(match.start)} בין ${formatTimeRange(
        match.start,
        match.end
      )}. בגלל ש${title} מתקרבת לדדליין ${formatDateTime(
        task.deadline,
        { dateStyle: "medium", timeStyle: undefined }
      )} ובעדיפות ${priorityLabel}, אני ממליץ לשבץ שם סשן עבודה.`
    });

    usedWindows.push(match);
  }

  return recommendations;
}
