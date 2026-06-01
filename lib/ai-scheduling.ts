import OpenAI from "openai";
import { SCHEDULING_SYSTEM_PROMPT } from "@/lib/ai-prompt";
import { getOpenAiApiKey, getOpenAiModel, getTimeZone } from "@/lib/env";
import { formatDateTime, formatTimeRange } from "@/lib/date-format";
import {
  buildAlternateRecommendation,
  buildStudyRecommendations,
  findFreeWindows,
  rankTasks
} from "@/lib/scheduling";
import type { CalendarEvent, DbMessage, DbTask, DbTaskSession } from "@/lib/types";

export type StudyRecommendation = {
  task: DbTask;
  start: Date;
  end: Date;
  reason: string;
};

type AiRecommendationRow = {
  task_id?: string;
  start_iso?: string;
  end_iso?: string;
  duration_minutes?: number;
  reason?: string;
};

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart < bEnd && aEnd > bStart;
}

function getBusySlots(events: CalendarEvent[], sessions: DbTaskSession[]) {
  const busy: Array<{ start: Date; end: Date }> = [];
  for (const event of events) {
    busy.push({ start: new Date(event.start), end: new Date(event.end) });
  }
  for (const session of sessions) {
    if (session.status === "scheduled" && session.start_time && session.end_time) {
      busy.push({ start: new Date(session.start_time), end: new Date(session.end_time) });
    }
  }
  return busy;
}

function getExcludedSlots(sessions: DbTaskSession[], taskId?: string) {
  return sessions
    .filter((session) => {
      if (session.status !== "rejected" || !session.start_time || !session.end_time) return false;
      if (taskId && session.task_id !== taskId) return false;
      return true;
    })
    .map((session) => ({
      start: new Date(session.start_time!),
      end: new Date(session.end_time!)
    }));
}

function formatFreeWindows(windows: ReturnType<typeof findFreeWindows>) {
  return windows
    .slice(0, 40)
    .map(
      (window, index) =>
        `${index + 1}. ${window.start.toISOString()} → ${window.end.toISOString()} (${formatTimeRange(window.start, window.end)})`
    )
    .join("\n");
}

function buildSchedulingUserPrompt(input: {
  tasks: DbTask[];
  events: CalendarEvent[];
  sessions: DbTaskSession[];
  recentMessages: DbMessage[];
  freeWindows: ReturnType<typeof findFreeWindows>;
  mode: "generate" | "alternate";
  alternateTaskId?: string;
  now: Date;
}) {
  const openTasks = rankTasks(input.tasks);
  const tasksForPrompt =
    input.mode === "alternate" && input.alternateTaskId
      ? openTasks.filter((task) => task.tasks_id === input.alternateTaskId)
      : openTasks.filter(
          (task) =>
            !input.sessions.some(
              (session) => session.task_id === task.tasks_id && session.status === "pending"
            )
        );

  const taskBlock = tasksForPrompt
    .map(
      (task) =>
        `- id: ${task.tasks_id}
  כותרת: ${task.task_title || "ללא"}
  תיאור: ${task.description || "אין"}
  קורס: ${task.course_name || "לא צוין"}
  דדליין: ${task.deadline || "לא נקבע"}
  זמן משוער בטופס: ${task.estimated_minutes ?? 60} דקות
  עדיפות: ${task.priority ?? 3}
  סטטוס: ${task.status}`
    )
    .join("\n");

  const eventBlock = input.events
    .slice(0, 30)
    .map((event) => `- ${event.summary}: ${event.start} → ${event.end}`)
    .join("\n");

  const rejectedBlock = input.sessions
    .filter((session) => session.status === "rejected" && session.start_time)
    .map(
      (session) =>
        `- משימה ${session.task_id}: ${session.start_time} → ${session.end_time} (נדחה — אל תציע שוב)`
    )
    .join("\n");

  const userMessages = input.recentMessages
    .filter((message) => message.role === "user" && message.chatInput?.trim())
    .slice(-12)
    .map((message) => `- ${message.chatInput}`)
    .join("\n");

  const modeInstruction =
    input.mode === "alternate"
      ? `הצע זמן חלופי אחד בלבד למשימה ${input.alternateTaskId}. חייב להיות שונה מכל זמן שנדחה.`
      : "הצע עד 5 המלצות, משימה אחת לכל המלצה, זמנים שונים.";

  return `עכשיו: ${input.now.toISOString()}
אזור זמן: ${getTimeZone()}

${modeInstruction}

משימות פתוחות:
${taskBlock || "אין"}

אירועי יומן (תפוס):
${eventBlock || "אין"}

זמנים שנדחו:
${rejectedBlock || "אין"}

חלונות פנויים (בחר רק מתוכם):
${formatFreeWindows(input.freeWindows) || "אין חלונות — השתמש בשעות 08:00-22:00 ב-7 הימים הקרובים"}

מה שהסטודנט כתב בצ'אט (התאם משך וזמן לפי זה):
${userMessages || "אין הודעות"}

החזר JSON בלבד.`;
}

function parseAiJson(text: string): AiRecommendationRow[] {
  const parsed = JSON.parse(text) as { recommendations?: AiRecommendationRow[] };
  return Array.isArray(parsed.recommendations) ? parsed.recommendations : [];
}

function validateRecommendation(
  row: AiRecommendationRow,
  tasks: DbTask[],
  busy: Array<{ start: Date; end: Date }>,
  excluded: Array<{ start: Date; end: Date }>,
  now: Date
): StudyRecommendation | null {
  const task = tasks.find((item) => item.tasks_id === row.task_id);
  if (!task || !row.start_iso || !row.end_iso) return null;

  const start = new Date(row.start_iso);
  const end = new Date(row.end_iso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  if (start >= end) return null;
  if (start < now) return null;

  const duration = Math.round((end.getTime() - start.getTime()) / 60000);
  if (duration < 30 || duration > 240) return null;

  const deadline = task.deadline ? new Date(task.deadline) : null;
  if (deadline && deadline.getTime() > now.getTime() && start >= deadline) return null;

  for (const slot of busy) {
    if (overlaps(start, end, slot.start, slot.end)) return null;
  }
  for (const slot of excluded) {
    if (overlaps(start, end, slot.start, slot.end)) return null;
  }

  const reason =
    typeof row.reason === "string" && row.reason.trim()
      ? row.reason.trim()
      : `הצעתי לעבוד על "${task.task_title || "המשימה"}" ב-${formatDateTime(start)} (${formatTimeRange(start, end)}).`;

  return { task, start, end, reason };
}

async function requestAiRecommendations(input: {
  tasks: DbTask[];
  events: CalendarEvent[];
  sessions: DbTaskSession[];
  recentMessages: DbMessage[];
  mode: "generate" | "alternate";
  alternateTaskId?: string;
  now?: Date;
}): Promise<StudyRecommendation[] | null> {
  const apiKey = getOpenAiApiKey();
  if (!apiKey) return null;

  const now = input.now ?? new Date();
  const freeWindows = findFreeWindows(input.events, input.sessions, 7, now);
  const client = new OpenAI({ apiKey });
  const model = getOpenAiModel();

  try {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: SCHEDULING_SYSTEM_PROMPT },
        {
          role: "user",
          content: buildSchedulingUserPrompt({
            ...input,
            freeWindows,
            now
          })
        }
      ],
      temperature: 0.4,
      max_tokens: 1200,
      response_format: { type: "json_object" }
    });

    const text = response.choices[0]?.message?.content?.trim();
    if (!text) return null;

    const rows = parseAiJson(text);
    const busy = getBusySlots(input.events, input.sessions);
    const excluded = getExcludedSlots(
      input.sessions,
      input.mode === "alternate" ? input.alternateTaskId : undefined
    );

    const validated: StudyRecommendation[] = [];
    const usedTasks = new Set<string>();

    for (const row of rows) {
      const recommendation = validateRecommendation(row, input.tasks, busy, excluded, now);
      if (!recommendation) continue;
      if (usedTasks.has(recommendation.task.tasks_id)) continue;
      validated.push(recommendation);
      usedTasks.add(recommendation.task.tasks_id);
      if (input.mode === "alternate") break;
      if (validated.length >= 5) break;
    }

    return validated.length ? validated : null;
  } catch {
    return null;
  }
}

export async function generateStudyRecommendations(input: {
  tasks: DbTask[];
  events: CalendarEvent[];
  sessions: DbTaskSession[];
  recentMessages: DbMessage[];
  max?: number;
}): Promise<{ recommendations: StudyRecommendation[]; source: "ai" | "algorithm" }> {
  const aiResults = await requestAiRecommendations({
    ...input,
    mode: "generate"
  });

  if (aiResults?.length) {
    return {
      recommendations: aiResults.slice(0, input.max ?? 5),
      source: "ai"
    };
  }

  return {
    recommendations: buildStudyRecommendations({
      tasks: input.tasks,
      events: input.events,
      sessions: input.sessions,
      max: input.max
    }),
    source: "algorithm"
  };
}

export async function generateAlternateStudyRecommendation(input: {
  task: DbTask;
  events: CalendarEvent[];
  sessions: DbTaskSession[];
  recentMessages: DbMessage[];
}): Promise<{ recommendation: StudyRecommendation | null; source: "ai" | "algorithm" }> {
  const aiResults = await requestAiRecommendations({
    tasks: [input.task],
    events: input.events,
    sessions: input.sessions,
    recentMessages: input.recentMessages,
    mode: "alternate",
    alternateTaskId: input.task.tasks_id
  });

  if (aiResults?.[0]) {
    return { recommendation: aiResults[0], source: "ai" };
  }

  const fallback = buildAlternateRecommendation({
    task: input.task,
    events: input.events,
    sessions: input.sessions
  });

  return {
    recommendation: fallback
      ? {
          task: fallback.task,
          start: fallback.start,
          end: fallback.end,
          reason: fallback.reason
        }
      : null,
    source: "algorithm"
  };
}
