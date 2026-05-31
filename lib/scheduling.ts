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
  if (session.status !== "scheduled" || !session.start_time || !session.end_time) return null;
  return {
    start: new Date(session.start_time),
    end: new Date(session.end_time)
  };
}

function isOpenTask(task: DbTask) {
  const closed = new Set(["completed", "done", "הושלם", "rejected", "scheduled"]);
  return !closed.has(task.status);
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
  return tasks.filter(isOpenTask).sort((a, b) => taskScore(b) - taskScore(a));
}

function slotOverlapsExcluded(start: Date, end: Date, excluded: Array<{ start: Date; end: Date }>) {
  return excluded.some((slot) => start < slot.end && end > slot.start);
}

function collectExcludedSlots(sessions: DbTaskSession[], taskId?: string) {
  return sessions
    .filter((session) => {
      if (!session.start_time || !session.end_time) return false;
      if (session.status !== "rejected") return false;
      if (taskId && session.task_id !== taskId) return false;
      return true;
    })
    .map((session) => ({
      start: new Date(session.start_time!),
      end: new Date(session.end_time!)
    }));
}

function pickNextSlot(input: {
  task: DbTask;
  freeWindows: FreeWindow[];
  excluded: Array<{ start: Date; end: Date }>;
  usedStarts: Set<number>;
  now: Date;
}) {
  const minutes = Math.max(30, Math.min(Number(input.task.estimated_minutes ?? 60), 180));
  const deadline = input.task.deadline ? new Date(input.task.deadline) : null;
  const deadlineApplies = Boolean(deadline && deadline.getTime() > input.now.getTime());
  const stepMs = 30 * 60_000;

  for (const window of input.freeWindows) {
    let candidateStart = new Date(Math.max(window.start.getTime(), input.now.getTime() + 5 * 60_000));

    while (durationMinutes(candidateStart, window.end) >= minutes) {
      const candidateEnd = new Date(candidateStart);
      candidateEnd.setMinutes(candidateEnd.getMinutes() + minutes);
      const slotKey = candidateStart.getTime();
      const beforeDeadline = !deadlineApplies || candidateStart < deadline!;
      const available = !input.usedStarts.has(slotKey) && !slotOverlapsExcluded(candidateStart, candidateEnd, input.excluded);

      if (beforeDeadline && available) {
        return { start: candidateStart, end: candidateEnd, minutes };
      }

      candidateStart = new Date(candidateStart.getTime() + stepMs);
    }
  }

  return null;
}

function buildReason(task: DbTask, start: Date, end: Date, deadlineApplies: boolean) {
  const priorityLabel = Number(task.priority ?? 3) >= 4 ? "גבוהה" : "רגילה";
  const title = task.task_title || "המשימה";
  const deadlineText = deadlineApplies
    ? formatDateTime(task.deadline, { dateStyle: "medium", timeStyle: undefined })
    : "לא נקבע";

  return `יש לך חלון פנוי ביום ${formatShortDay(start)} בין ${formatTimeRange(
    start,
    end
  )}. בגלל ש"${title}" ${deadlineApplies ? `מתקרבת לדדליין ${deadlineText}` : "פתוחה לעבודה"} ובעדיפות ${priorityLabel}, אני ממליץ לשבץ שם סשן עבודה.`;
}

export function buildAlternateRecommendation(input: {
  task: DbTask;
  events: CalendarEvent[];
  sessions: DbTaskSession[];
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const freeWindows = findFreeWindows(input.events, input.sessions, 7, now);
  const excluded = collectExcludedSlots(input.sessions, input.task.tasks_id);
  const usedStarts = new Set<number>();

  const slot = pickNextSlot({
    task: input.task,
    freeWindows,
    excluded,
    usedStarts,
    now
  });

  if (!slot) return null;

  const deadline = input.task.deadline ? new Date(input.task.deadline) : null;
  const deadlineApplies = Boolean(deadline && deadline.getTime() > now.getTime());

  return {
    task: input.task,
    start: slot.start,
    end: slot.end,
    reason: buildReason(input.task, slot.start, slot.end, deadlineApplies)
  };
}

export function buildStudyRecommendations(input: {
  tasks: DbTask[];
  events: CalendarEvent[];
  sessions: DbTaskSession[];
  max?: number;
  now?: Date;
}) {
  const now = input.now ?? new Date();
  const freeWindows = findFreeWindows(input.events, input.sessions, 7, now);
  const rankedTasks = rankTasks(input.tasks);
  const tasksWithPending = new Set(
    input.sessions.filter((session) => session.status === "pending").map((session) => session.task_id)
  );
  const excluded = collectExcludedSlots(input.sessions);
  const recommendations: Array<{
    task: DbTask;
    start: Date;
    end: Date;
    reason: string;
  }> = [];

  const usedStarts = new Set<number>();

  for (const task of rankedTasks) {
    if (recommendations.length >= (input.max ?? 5)) break;
    if (tasksWithPending.has(task.tasks_id)) continue;

    const slot = pickNextSlot({
      task,
      freeWindows,
      excluded,
      usedStarts,
      now
    });

    if (!slot) continue;

    const deadline = task.deadline ? new Date(task.deadline) : null;
    const deadlineApplies = Boolean(deadline && deadline.getTime() > now.getTime());

    recommendations.push({
      task,
      start: slot.start,
      end: slot.end,
      reason: buildReason(task, slot.start, slot.end, deadlineApplies)
    });

    usedStarts.add(slot.start.getTime());
  }

  return recommendations;
}
