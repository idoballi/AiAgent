import OpenAI from "openai";
import type { CalendarEvent, DbMessage, DbTask, DbTaskSession } from "@/lib/types";
import { CHAT_SYSTEM_PROMPT } from "@/lib/ai-prompt";
import { getOpenAiApiKey, getOpenAiModel } from "@/lib/env";

function isSmallTalk(message: string) {
  const normalized = message.trim().toLowerCase();
  const patterns = [
    /^מה שלומך/,
    /^היי/,
    /^שלום/,
    /^תודה/,
    /^בוקר טוב/,
    /^ערב טוב/,
    /^how are you/
  ];
  return patterns.some((pattern) => pattern.test(normalized));
}

function smallTalkReply(message: string) {
  if (/מה שלומך|how are you/i.test(message)) {
    return "בסדר גמור, תודה ששאלת! איך אפשר לעזור לך היום — משימות, דדליינים או שיבוץ זמן ללמידה?";
  }
  if (/תודה/.test(message)) {
    return "בכיף! אם תרצה, אפשר להמשיך עם משימה חדשה או המלצות לשיבוץ.";
  }
  return "שלום! אני כאן לעזור עם משימות, דדליינים ותכנון למידה. מה תרצה לעשות?";
}

function buildContextBlock(input: {
  tasks: DbTask[];
  sessions: DbTaskSession[];
  events: CalendarEvent[];
}) {
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

  return `נתוני מערכת (להקשר בלבד):
משימות:
${taskSummary || "אין משימות"}

המלצות/סשנים:
${sessionSummary || "אין סשנים"}

אירועי יומן:
${eventSummary || "אין אירועים או שהיומן לא מחובר"}`;
}

export async function generateAssistantReply(input: {
  userMessage: string;
  recentMessages: DbMessage[];
  tasks: DbTask[];
  sessions: DbTaskSession[];
  events: CalendarEvent[];
}): Promise<{ reply: string; usedOpenAi: boolean }> {
  if (isSmallTalk(input.userMessage)) {
    return { reply: smallTalkReply(input.userMessage), usedOpenAi: false };
  }

  const apiKey = getOpenAiApiKey();
  if (!apiKey) {
    return {
      reply:
        "השרת לא רואה מפתח OpenAI. ב-Vercel: Settings → Environment Variables → OPENAI_API_KEY (בלי NEXT_PUBLIC), סמן Production, ואז Deploy מחדש. בינתיים אפשר לעבוד עם משימות והמלצות בלשוניות המתאימות.",
      usedOpenAi: false
    };
  }

  const client = new OpenAI({ apiKey });
  const model = getOpenAiModel();

  const history = input.recentMessages
    .filter((message) => message.chatInput?.trim())
    .map((message) => ({
      role: (message.role === "assistant" ? "assistant" : "user") as "assistant" | "user",
      content: message.chatInput!.trim()
    }));

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: CHAT_SYSTEM_PROMPT },
    { role: "system", content: buildContextBlock(input) },
    ...history.slice(-8),
    { role: "user", content: input.userMessage }
  ];

  try {
    const response = await client.chat.completions.create({
      model,
      messages,
      temperature: 0.7,
      max_tokens: 500
    });

    const text = response.choices[0]?.message?.content?.trim();
    if (text) {
      return { reply: text, usedOpenAi: true };
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : "";
    const hint = detail.includes("model")
      ? "ייתכן ש-OPENAI_MODEL לא נתמך — נסה gpt-4o-mini ב-Vercel."
      : "בדוק שהמפתח תקין ושבוצע Deploy אחרי הוספת המשתנה.";

    return {
      reply: `לא הצלחתי להתחבר ל-OpenAI. ${hint}`,
      usedOpenAi: false
    };
  }

  return {
    reply: "לא התקבלה תשובה מ-OpenAI. נסה שוב בעוד רגע.",
    usedOpenAi: false
  };
}
