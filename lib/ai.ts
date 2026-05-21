import OpenAI from "openai";
import type { CalendarEvent, DbMessage, DbTask, DbTaskSession } from "@/lib/types";
import { findFreeWindows } from "@/lib/scheduling";
import { formatDateTime, formatShortDay, formatTimeRange } from "@/lib/date-format";

function fallbackReply(input: {
  message: string;
  tasks: DbTask[];
  sessions: DbTaskSession[];
  events: CalendarEvent[];
}) {
  const freeWindow = findFreeWindows(input.events, input.sessions, 7)[0];
  const urgentTask = input.tasks
    .filter((task) => task.status !== "completed")
    .sort((a, b) => {
      const aTime = a.deadline ? new Date(a.deadline).getTime() : Number.MAX_SAFE_INTEGER;
      const bTime = b.deadline ? new Date(b.deadline).getTime() : Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    })[0];

  if (freeWindow && urgentTask) {
    return `מצאתי כיוון טוב: יש לך חלון פנוי ביום ${formatShortDay(
      freeWindow.start
    )} בין ${formatTimeRange(freeWindow.start, freeWindow.end)}. בגלל ש${urgentTask.task_title ?? "המשימה"} לדדליין ${formatDateTime(
      urgentTask.deadline,
      { dateStyle: "medium", timeStyle: undefined }
    )}, כדאי ליצור המלצה לשיבוץ ואז לאשר אותה לפני יצירת אירוע ביומן.`;
  }

  if (!process.env.OPENAI_API_KEY) {
    return "קיבלתי. כדי שאוכל לענות כ-AI מלא צריך להגדיר OPENAI_API_KEY בשרת. בינתיים אפשר להוסיף משימה וליצור המלצות לפי היומן.";
  }

  return "קיבלתי. כדאי להוסיף את המשימה עם דדליין וזמן משוער, ואז אוכל להציע חלונות למידה מדויקים יותר.";
}

export async function generateAssistantReply(input: {
  userMessage: string;
  recentMessages: DbMessage[];
  tasks: DbTask[];
  sessions: DbTaskSession[];
  events: CalendarEvent[];
}) {
  if (!process.env.OPENAI_API_KEY) {
    return fallbackReply({
      message: input.userMessage,
      tasks: input.tasks,
      sessions: input.sessions,
      events: input.events
    });
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_MODEL || "gpt-5.2";

  const taskSummary = input.tasks
    .slice(0, 12)
    .map(
      (task) =>
        `- ${task.task_title || "ללא כותרת"} | קורס: ${task.course_name || "לא צוין"} | דדליין: ${
          task.deadline || "לא צוין"
        } | זמן משוער: ${task.estimated_minutes || 60} דקות | עדיפות: ${task.priority || 3} | סטטוס: ${
          task.status
        }`
    )
    .join("\n");

  const sessionSummary = input.sessions
    .slice(0, 8)
    .map(
      (session) =>
        `- ${session.tasks?.task_title || session.task_id} | ${session.start_time || "ללא התחלה"}-${
          session.end_time || "ללא סיום"
        } | ${session.status || "pending"}`
    )
    .join("\n");

  const eventSummary = input.events
    .slice(0, 12)
    .map((event) => `- ${event.summary}: ${event.start} עד ${event.end}`)
    .join("\n");

  const conversation = input.recentMessages
    .map((message) => `${message.role === "assistant" ? "סוכן" : "סטודנט"}: ${message.chatInput || ""}`)
    .join("\n");

  const response = await client.responses.create({
    model,
    instructions: [
      "אתה סוכן פרודוקטיביות לסטודנטים. כל התשובות שלך חייבות להיות בעברית.",
      "ענה בקצרה, באופן מעשי, וחברי. שאל שאלות המשך רק אם חסר מידע חשוב.",
      "לעולם אל תגיד שיצרת אירוע ביומן. מותר רק להציע שיבוץ ולבקש אישור מפורש.",
      "השתמש בדדליין, עומס יומן, עדיפות וזמן משוער כדי להסביר המלצות.",
      "אם המשתמש מבקש לשבץ, אמור שצריך לאשר המלצה לפני יצירת אירוע ביומן."
    ].join("\n"),
    input: `נתוני מערכת עדכניים:
משימות:
${taskSummary || "אין משימות"}

המלצות/סשנים:
${sessionSummary || "אין סשנים"}

אירועי יומן:
${eventSummary || "אין אירועים או שהיומן לא מחובר"}

עשר ההודעות האחרונות:
${conversation || "אין היסטוריה"}

הודעת המשתמש הנוכחית:
${input.userMessage}`
  });

  return (
    response.output_text?.trim() ||
    fallbackReply({
      message: input.userMessage,
      tasks: input.tasks,
      sessions: input.sessions,
      events: input.events
    })
  );
}
