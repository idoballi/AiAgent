"use client";

import type { ElementType, FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  CalendarCheck,
  CheckCircle2,
  Clock,
  LayoutDashboard,
  ListChecks,
  Loader2,
  LogOut,
  MessageCircle,
  Plus,
  RefreshCcw,
  Send,
  Settings,
  Sparkles,
  Trash2,
  XCircle
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatDateTime, formatTimeRange } from "@/lib/date-format";
import type { AppState, CalendarEvent, DbTask, DbTaskSession } from "@/lib/types";

type ViewKey = "dashboard" | "chat" | "tasks" | "calendar" | "recommendations" | "settings";

const views: Array<{ key: ViewKey; label: string; icon: ElementType }> = [
  { key: "dashboard", label: "לוח בקרה", icon: LayoutDashboard },
  { key: "chat", label: "צ׳אט", icon: MessageCircle },
  { key: "tasks", label: "משימות", icon: ListChecks },
  { key: "calendar", label: "יומן", icon: CalendarCheck },
  { key: "recommendations", label: "המלצות", icon: Sparkles },
  { key: "settings", label: "הגדרות", icon: Settings }
];

const statusLabels: Record<string, string> = {
  new: "פתוח",
  pending: "ממתין לאישור",
  approved: "אושר",
  scheduled: "שובץ ביומן",
  completed: "הושלם",
  rejected: "נדחה",
  open: "פתוח",
  in_progress: "בתהליך",
  done: "הושלם"
};

const statusClass: Record<string, string> = {
  new: "neutral",
  pending: "pending",
  approved: "pending",
  scheduled: "scheduled",
  completed: "completed",
  done: "completed",
  rejected: "rejected",
  open: "neutral",
  in_progress: "pending"
};

function labelForStatus(status: string | null | undefined) {
  return statusLabels[status || "pending"] || status || "ממתין";
}

function classForStatus(status: string | null | undefined) {
  return statusClass[status || "pending"] || "neutral";
}

function isUpcoming(task: DbTask) {
  if (task.status === "completed" || task.status === "done") return false;
  if (!task.deadline) return true;
  return new Date(task.deadline) >= new Date();
}

function toLocalInputValue(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60000);
  return local.toISOString().slice(0, 16);
}

function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}

function StatusBadge({ status }: { status: string | null | undefined }) {
  return <span className={`badge ${classForStatus(status)}`}>{labelForStatus(status)}</span>;
}

function DeleteButton({
  label,
  onClick,
  disabled
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button className="button delete compact" type="button" onClick={onClick} disabled={disabled}>
      <Trash2 size={15} />
      {label}
    </button>
  );
}

async function readJson<T>(response: Response, fallbackMessage: string): Promise<T> {
  const text = await response.text();
  let payload: unknown = {};

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(fallbackMessage);
    }
  }

  if (!response.ok) {
    const errorMessage = typeof payload === "object" && payload && "error" in payload ? payload.error : null;
    throw new Error(typeof errorMessage === "string" ? errorMessage : fallbackMessage);
  }

  return payload as T;
}

function NavButton({
  view,
  active,
  onClick
}: {
  view: (typeof views)[number];
  active: boolean;
  onClick: () => void;
}) {
  const Icon = view.icon;
  return (
    <button className={`nav-button ${active ? "active" : ""}`} type="button" onClick={onClick}>
      <Icon size={18} />
      {view.label}
    </button>
  );
}

export function StudentAgentApp({
  initialState,
  userEmail
}: {
  initialState: AppState;
  userEmail: string;
}) {
  const [activeView, setActiveView] = useState<ViewKey>("dashboard");
  const [state, setState] = useState<AppState>(initialState);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [taskForm, setTaskForm] = useState({
    task_title: "",
    description: "",
    course_name: "",
    task_type: "assignment",
    deadline: "",
    estimated_minutes: 90,
    priority: 3,
    status: "open"
  });

  const supabase = createClient();

  const upcomingTasks = useMemo(() => state.tasks.filter(isUpcoming).slice(0, 6), [state.tasks]);
  const dashboardTasks = useMemo(() => state.tasks.slice(0, 6), [state.tasks]);
  const pendingSessions = useMemo(
    () => state.sessions.filter((session) => session.status === "pending"),
    [state.sessions]
  );
  const scheduledSessions = useMemo(
    () => state.sessions.filter((session) => session.status === "scheduled"),
    [state.sessions]
  );
  const recommendationSessions = useMemo(
    () => state.sessions.filter((session) => session.status === "pending" || session.status === "scheduled"),
    [state.sessions]
  );
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [openAiStatus, setOpenAiStatus] = useState<{
    configured: boolean;
    model: string;
    hint: string;
  } | null>(null);

  useEffect(() => {
    if (activeView !== "chat") return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeView, state.messages.length, loading]);

  useEffect(() => {
    if (activeView !== "settings") return;
    fetch("/api/health/openai")
      .then((response) => response.json())
      .then((payload) => {
        if (typeof payload.configured === "boolean") {
          setOpenAiStatus({
            configured: payload.configured,
            model: typeof payload.model === "string" ? payload.model : "gpt-4o-mini",
            hint: typeof payload.hint === "string" ? payload.hint : ""
          });
        }
      })
      .catch(() => {
        setOpenAiStatus({
          configured: false,
          model: "—",
          hint: "לא הצלחתי לבדוק את סטטוס OpenAI"
        });
      });
  }, [activeView]);

  async function refreshState() {
    const response = await fetch("/api/state");
    const payload = await readJson<AppState & { error?: string }>(response, "לא הצלחתי לרענן נתונים");
    if (!response.ok) {
      throw new Error(payload.error || "לא הצלחתי לרענן נתונים");
    }
    setState(payload);
  }

  async function runAction<T>(action: () => Promise<T>) {
    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const result = await action();
      await refreshState();
      return result;
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "משהו השתבש");
      return null;
    } finally {
      setLoading(false);
    }
  }

  async function connectCalendar() {
    setError(null);
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=/app`,
        scopes:
          "email profile https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events",
        queryParams: {
          access_type: "offline",
          prompt: "consent"
        }
      }
    });

    if (authError) {
      setError("לא הצלחתי לפתוח חיבור ל-Google Calendar");
    }
  }

  async function submitTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runAction(async () => {
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...taskForm,
          deadline: taskForm.deadline ? new Date(taskForm.deadline).toISOString() : null,
          estimated_minutes: Number(taskForm.estimated_minutes),
          priority: Number(taskForm.priority)
        })
      });
      await readJson<DbTask>(response, "לא הצלחתי להוסיף משימה");
      setTaskForm({
        task_title: "",
        description: "",
        course_name: "",
        task_type: "assignment",
        deadline: "",
        estimated_minutes: 90,
        priority: 3,
        status: "open"
      });
      setNotice("המשימה נשמרה. כדי ליצור אירוע ביומן צריך ליצור המלצה ואז לאשר שיבוץ.");
    });
  }

  async function updateTaskStatus(task: DbTask, status: string) {
    await runAction(async () => {
      const response = await fetch(`/api/tasks/${task.tasks_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
      await readJson<{ ok: boolean }>(response, "לא הצלחתי לעדכן סטטוס");
      setNotice("הסטטוס עודכן");
    });
  }

  async function deleteTask(task: DbTask) {
    const taskTitle = task.task_title || "משימה ללא כותרת";
    const confirmed = window.confirm(
      `למחוק את המשימה "${taskTitle}"? אם יש לה שיבוץ ביומן, גם האירוע ביומן י.`
    );
    if (!confirmed) return;

    await runAction(async () => {
      const response = await fetch(`/api/tasks/${task.tasks_id}`, {
        method: "DELETE"
      });
      const payload = await readJson<{ message?: string }>(response, "לא הצלחתי למחוק את המשימה");
      setNotice(payload.message || "המשימה נמחקה");
    });
  }

  async function sendChatMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = chatInput.trim();
    if (!message) return;

    setChatInput("");
    setState((current) => ({
      ...current,
      messages: [
        ...current.messages,
        {
          id: `temp-${Date.now()}`,
          user_id: null,
          role: "user",
          chatInput: message,
          source: "web",
          created_at: new Date().toISOString()
        }
      ]
    }));

    await runAction(async () => {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message })
      });
      await readJson<{ ok?: boolean }>(response, "לא הצלחתי לשלוח הודעה");
    });
  }

  async function generateRecommendations() {
    await runAction(async () => {
      const response = await fetch("/api/recommendations/generate", { method: "POST" });
      const payload = await readJson<{
        message?: string;
        created?: number;
        calendarWarning?: string | null;
      }>(response, "לא הצלחתי ליצור המלצות");

      const parts = [payload.message || (payload.created ? "נוצרו המלצות חדשות" : "לא נוצרו המלצות")];
      if (payload.calendarWarning) parts.push(payload.calendarWarning);
      setNotice(parts.join(" "));
    });
  }

  async function recommendationAction(session: DbTaskSession, action: "approve" | "reject" | "alternate" | "complete") {
    await runAction(async () => {
      const response = await fetch(`/api/recommendations/${session.session_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });
      const payload = await readJson<{ message?: string }>(response, "לא הצלחתי לעדכן המלצה");
      setNotice(payload.message || "ההמלצה עודכנה");
    });
  }

  async function deleteCalendarEvent(event: CalendarEvent) {
    const confirmed = window.confirm(`למחוק את האירוע "${event.summary}" מהיומן?`);
    if (!confirmed) return;

    await runAction(async () => {
      const response = await fetch(`/api/calendar/events/${encodeURIComponent(event.id)}`, {
        method: "DELETE"
      });
      const payload = await readJson<{ message?: string }>(response, "לא הצלחתי למחוק את האירוע");
      setNotice(payload.message || "האירוע נמחק מהיומן");
    });
  }

  function renderTask(task: DbTask, compact = false) {
    if (compact) {
      return (
        <div className="preview-item" key={task.tasks_id}>
          <div className="preview-item-content">
            <strong>{task.task_title || "משימה ללא כותרת"}</strong>
            <div className="meta">
              <span>דדליין: {formatDateTime(task.deadline)}</span>
              {task.course_name ? <span>{task.course_name}</span> : null}
            </div>
          </div>
          <StatusBadge status={task.status} />
        </div>
      );
    }

    return (
      <article className="item-card" key={task.tasks_id}>
        <div className="item-head">
          <strong>{task.task_title || "משימה ללא כותרת"}</strong>
          <div className="row-actions">
            <StatusBadge status={task.status} />
            <DeleteButton label="מחק משימה" onClick={() => deleteTask(task)} disabled={loading} />
          </div>
        </div>
        {task.description ? <div className="muted">{task.description}</div> : null}
        <div className="meta">
          <span>דדליין: {formatDateTime(task.deadline)}</span>
          <span>{task.estimated_minutes || 60} דקות</span>
          <span>עדיפות: {task.priority || 3}</span>
          {task.course_name ? <span>{task.course_name}</span> : null}
        </div>
        <div className="action-row">
          <button
            className="button secondary compact"
            type="button"
            onClick={() => updateTaskStatus(task, "in_progress")}
            disabled={loading}
          >
            בתהליך
          </button>
          <button
            className="button success compact"
            type="button"
            onClick={() => updateTaskStatus(task, "completed")}
            disabled={loading}
          >
            <CheckCircle2 size={15} />
            הושלם
          </button>
        </div>
      </article>
    );
  }

  function renderRecommendation(session: DbTaskSession) {
    return (
      <article className="item-card" key={session.session_id}>
        <div className="item-head">
          <strong>{session.tasks?.task_title || "סשן למידה"}</strong>
          <StatusBadge status={session.status} />
        </div>
        <div className="meta">
          <span>
            {session.start_time && session.end_time
              ? `${formatDateTime(session.start_time)} · ${formatTimeRange(session.start_time, session.end_time)}`
              : "לא נקבע זמן"}
          </span>
          {session.tasks?.course_name ? <span>{session.tasks.course_name}</span> : null}
        </div>
        {session.reason ? <div className="reason-box">{session.reason}</div> : null}
        <div className="action-row">
          {session.status === "pending" ? (
            <>
              <button
                className="button success compact"
                type="button"
                onClick={() => recommendationAction(session, "approve")}
                disabled={loading}
              >
                <CheckCircle2 size={15} />
                אשר שיבוץ
              </button>
              <button
                className="button secondary compact"
                type="button"
                onClick={() => recommendationAction(session, "reject")}
                disabled={loading}
              >
                <XCircle size={15} />
                דחה
              </button>
              <button
                className="button secondary compact"
                type="button"
                onClick={() => recommendationAction(session, "alternate")}
                disabled={loading}
              >
                <RefreshCcw size={15} />
                הצע זמן אחר
              </button>
            </>
          ) : null}
          {session.status === "scheduled" ? (
            <button
              className="button secondary compact"
              type="button"
              onClick={() => recommendationAction(session, "complete")}
              disabled={loading}
            >
              סמן כהושלם
            </button>
          ) : null}
        </div>
      </article>
    );
  }

  function renderDashboard() {
    return (
      <>
        <section className="dashboard-grid">
          <div className="dashboard-card">
            <div className="card-head">
              <h3>משימות קרובות</h3>
              <ListChecks size={20} />
            </div>
            <div className="metric">{upcomingTasks.length}</div>
            <div className="muted">משימות פתוחות שדורשות תשומת לב.</div>
          </div>
          <div className="dashboard-card">
            <div className="card-head">
              <h3>המלצות לשיבוץ</h3>
              <Sparkles size={20} />
            </div>
            <div className="metric">{pendingSessions.length}</div>
            <div className="muted">המלצות שממתינות לאישור שלך.</div>
          </div>
          <div className="dashboard-card">
            <div className="card-head">
              <h3>אירועים קרובים ביומן</h3>
              <CalendarCheck size={20} />
            </div>
            <div className="metric">{state.calendarEvents.length}</div>
            <div className="muted">אירועים שנקראו מ-Google Calendar.</div>
          </div>
          <div className="dashboard-card">
            <div className="card-head">
              <h3>סטטוס חיבור ליומן</h3>
              <Clock size={20} />
            </div>
            <div className="metric">{state.calendarStatus.connected ? "מחובר" : "מנותק"}</div>
            <div className="muted">{state.calendarStatus.message}</div>
          </div>
        </section>

        <section className="content-grid">
          <div className="panel">
            <div className="section-title">
              <div>
                <h2>משימות קרובות</h2>
                <p>המשימות שהכי חשוב להתייחס אליהן עכשיו.</p>
              </div>
              <button className="button secondary" type="button" onClick={() => setActiveView("tasks")}>
                פתח משימות
              </button>
            </div>
            <div className="list">
              {dashboardTasks.length ? (
                dashboardTasks.map((task) => renderTask(task, true))
              ) : (
                <EmptyState>אין עדיין משימות — הוסף משימה ראשונה</EmptyState>
              )}
            </div>
          </div>

          <div className="panel">
            <div className="section-title">
              <div>
                <h2>המלצות לשיבוץ</h2>
                <p>אישור ייצור אירוע ביומן, דחייה תשאיר את היומן ללא שינוי.</p>
              </div>
            </div>
            <div className="list">
              {pendingSessions.length ? (
                pendingSessions.map(renderRecommendation)
              ) : (
                <EmptyState>אין המלצות כרגע</EmptyState>
              )}
            </div>
          </div>
        </section>
      </>
    );
  }

  function renderChat() {
    return (
      <section className="panel chat-shell">
        <div className="chat-header">
          <h2>צ׳אט עם הסוכן</h2>
          <p className="muted">
            כתוב מתי נוח לך ללמוד, כמה זמן, ומה לא מתאים — ההמלצות יתחשבו בזה (בלי כלל קבוע מראש).
          </p>
        </div>
        <div className="messages">
          {state.messages.length ? (
            <>
              {state.messages.map((message) => (
                <div className={`message ${message.role === "assistant" ? "assistant" : "user"}`} key={message.id}>
                  {message.chatInput}
                </div>
              ))}
              <div ref={messagesEndRef} />
            </>
          ) : (
            <EmptyState>כתוב לסוכן מה יש לך לעשות, והוא יעזור לפרק ולתעדף.</EmptyState>
          )}
        </div>
        <form className="chat-form" onSubmit={sendChatMessage}>
          <input
            className="input"
            value={chatInput}
            onChange={(event) => setChatInput(event.target.value)}
            placeholder="כתוב כאן מה יש לך לעשות..."
            disabled={loading}
          />
          <button className="button primary" type="submit" disabled={loading || !chatInput.trim()}>
            {loading ? <Loader2 size={18} /> : <Send size={18} />}
            שלח
          </button>
        </form>
      </section>
    );
  }

  function renderTasks() {
    return (
      <section className="content-grid">
        <div className="panel">
          <div className="section-title">
            <div>
              <h2>משימות</h2>
              <p>כל העבודות, התרגילים, הבחינות והדדליינים שלך.</p>
            </div>
          </div>
          <div className="list">
            {state.tasks.length ? state.tasks.map((task) => renderTask(task)) : <EmptyState>אין עדיין משימות</EmptyState>}
          </div>
        </div>

        <div className="panel">
          <h2>הוספת משימה</h2>
          <form className="task-form" onSubmit={submitTask}>
            <div className="field wide">
              <label htmlFor="task-title">כותרת</label>
              <input
                className="input"
                id="task-title"
                value={taskForm.task_title}
                onChange={(event) => setTaskForm({ ...taskForm, task_title: event.target.value })}
                placeholder="לדוגמה: עבודה להגשה בחדו״א"
                required
              />
            </div>
            <div className="field wide">
              <label htmlFor="task-description">תיאור</label>
              <textarea
                className="textarea"
                id="task-description"
                value={taskForm.description}
                onChange={(event) => setTaskForm({ ...taskForm, description: event.target.value })}
                placeholder="מה צריך לעשות?"
              />
            </div>
            <div className="field">
              <label htmlFor="course">קורס / נושא</label>
              <input
                className="input"
                id="course"
                value={taskForm.course_name}
                onChange={(event) => setTaskForm({ ...taskForm, course_name: event.target.value })}
                placeholder="שם הקורס"
              />
            </div>
            <div className="field">
              <label htmlFor="task-type">סוג</label>
              <select
                className="select"
                id="task-type"
                value={taskForm.task_type}
                onChange={(event) => setTaskForm({ ...taskForm, task_type: event.target.value })}
              >
                <option value="assignment">עבודה</option>
                <option value="homework">שיעורי בית</option>
                <option value="exam">מבחן</option>
                <option value="study">למידה</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="deadline">דדליין</label>
              <input
                className="input"
                id="deadline"
                type="datetime-local"
                value={toLocalInputValue(taskForm.deadline)}
                onChange={(event) => setTaskForm({ ...taskForm, deadline: event.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="duration">זמן משוער בדקות</label>
              <input
                className="input"
                id="duration"
                type="number"
                min="30"
                step="15"
                value={taskForm.estimated_minutes}
                onChange={(event) =>
                  setTaskForm({ ...taskForm, estimated_minutes: Number(event.target.value) })
                }
              />
            </div>
            <div className="field">
              <label htmlFor="priority">עדיפות</label>
              <select
                className="select"
                id="priority"
                value={taskForm.priority}
                onChange={(event) => setTaskForm({ ...taskForm, priority: Number(event.target.value) })}
              >
                <option value={1}>נמוכה</option>
                <option value={3}>רגילה</option>
                <option value={5}>גבוהה</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="status">סטטוס</label>
              <select
                className="select"
                id="status"
                value={taskForm.status}
                onChange={(event) => setTaskForm({ ...taskForm, status: event.target.value })}
              >
                <option value="open">פתוח</option>
                <option value="in_progress">בתהליך</option>
                <option value="completed">הושלם</option>
              </select>
            </div>
            <button className="button primary wide" type="submit" disabled={loading}>
              <Plus size={18} />
              הוסף משימה
            </button>
          </form>
        </div>
      </section>
    );
  }

  function renderCalendar() {
    return (
      <section className="content-grid">
        <div className="panel">
          <div className="section-title">
            <div>
              <h2>יומן</h2>
              <p>{state.calendarStatus.message}</p>
            </div>
            <button className="button secondary" type="button" onClick={() => runAction(refreshState)} disabled={loading}>
              <RefreshCcw size={16} />
              רענן
            </button>
          </div>
          {!state.calendarStatus.connected ? (
            <EmptyState>חבר את Google Calendar כדי לקבל המלצות מדויקות</EmptyState>
          ) : null}
          <div className="calendar-list">
            {state.calendarEvents.length ? (
              state.calendarEvents.map((event) => (
                <article className="item-card" key={event.id}>
                  <div className="item-head">
                    <strong>{event.summary}</strong>
                    <DeleteButton
                      label="מחק אירוע"
                      onClick={() => deleteCalendarEvent(event)}
                      disabled={loading}
                    />
                  </div>
                  <div className="meta">
                    <span>{formatDateTime(event.start)}</span>
                    <span>{formatTimeRange(event.start, event.end)}</span>
                  </div>
                </article>
              ))
            ) : state.calendarStatus.connected ? (
              <EmptyState>אין אירועים קרובים ביומן</EmptyState>
            ) : null}
          </div>
        </div>
        <div className="panel">
          <h2>חיבור Google Calendar</h2>
          <p className="muted">
            החיבור משמש לקריאת אירועים, זיהוי חלונות פנויים, ויצירת אירוע רק אחרי אישור שלך.
          </p>
          <button className="button primary" type="button" onClick={connectCalendar} disabled={loading}>
            <CalendarCheck size={18} />
            חבר את Google Calendar
          </button>
        </div>
      </section>
    );
  }

  function renderRecommendations() {
    return (
      <section className="panel">
        <div className="section-title">
          <div>
            <h2>המלצות</h2>
            <p>
              AI בוחר זמן לפי יומן, משימות ומה שכתבת בצ&apos;אט — בלי כלל קבוע; רק לפי מה שאתה כותב
              (למשל &quot;לא אחרי 20:00&quot;). אירוע נוצר רק אחרי &quot;אשר שיבוץ&quot;.
            </p>
          </div>
          <button className="button primary" type="button" onClick={generateRecommendations} disabled={loading}>
            <Sparkles size={18} />
            צור המלצות
          </button>
        </div>
        <div className="list">
          {recommendationSessions.length ? (
            recommendationSessions.map(renderRecommendation)
          ) : (
            <EmptyState>אין המלצות כרגע — לחץ &quot;צור המלצות&quot;</EmptyState>
          )}
        </div>
        {scheduledSessions.length ? (
          <div className="notice">יש {scheduledSessions.length} סשנים שכבר שובצו ביומן.</div>
        ) : null}
      </section>
    );
  }

  function renderSettings() {
    return (
      <section className="content-grid">
        <div className="panel">
          <h2>הגדרות</h2>
          <div className="list">
            <div className="row">
              <div className="row-title">
                <strong>חשבון</strong>
              </div>
              <div className="meta">
                <span>{userEmail}</span>
              </div>
            </div>
            <div className="row">
              <div className="row-title">
                <strong>חיבור OpenAI (צ׳אט)</strong>
                {openAiStatus ? (
                  <span className={`badge ${openAiStatus.configured ? "completed" : "rejected"}`}>
                    {openAiStatus.configured ? "מחובר" : "לא מחובר"}
                  </span>
                ) : null}
              </div>
              <div className="muted">
                {openAiStatus
                  ? openAiStatus.configured
                    ? `השרת רואה מפתח. מודל: ${openAiStatus.model}. זה נפרד מ-Cursor/Codex.`
                    : openAiStatus.hint ||
                      "הוסף OPENAI_API_KEY ב-Vercel (לא ב-OPENAI_MODEL), ואז Redeploy."
                  : "בודק חיבור..."}
              </div>
            </div>
            <div className="row">
              <div className="row-title">
                <strong>זיכרון שיחה</strong>
              </div>
              <div className="muted">הצ׳אט משתמש בעשר ההודעות האחרונות שנשמרו ב-Supabase.</div>
            </div>
            <div className="row">
              <div className="row-title">
                <strong>Google Calendar (שרת)</strong>
              </div>
              <div className="muted">
                התחברות עם Google שומרת חשבון. כדי לאשר שיבוץ ביומן צריך גם ב-Vercel: GOOGLE_CLIENT_ID
                ו-GOOGLE_CLIENT_SECRET (מ-Google Cloud, אותו OAuth Client כמו ב-Supabase).
              </div>
            </div>
            <div className="row">
              <div className="row-title">
                <strong>יצירת אירועים ביומן</strong>
              </div>
              <div className="muted">אירוע נוצר רק אחרי לחיצה על &quot;אשר שיבוץ&quot;.</div>
            </div>
          </div>
        </div>
        <div className="panel">
          <h2>פעולות חשבון</h2>
          <button className="button primary" type="button" onClick={connectCalendar} disabled={loading}>
            <CalendarCheck size={18} />
            חבר / רענן Google Calendar
          </button>
          <form action="/auth/signout" method="post">
            <button className="button secondary" type="submit">
              <LogOut size={18} />
              התנתק
            </button>
          </form>
        </div>
      </section>
    );
  }

  function renderActiveView() {
    if (activeView === "chat") return renderChat();
    if (activeView === "tasks") return renderTasks();
    if (activeView === "calendar") return renderCalendar();
    if (activeView === "recommendations") return renderRecommendations();
    if (activeView === "settings") return renderSettings();
    return renderDashboard();
  }

  return (
    <div className="app-layout page">
      <aside className="sidebar">
        <div className="brand-row">
          <div className="brand-mark">
            <Bot size={22} />
          </div>
          <strong>סוכן לימודים חכם</strong>
        </div>
        <nav className="nav" aria-label="ניווט ראשי">
          {views.map((view) => (
            <NavButton
              key={view.key}
              view={view}
              active={activeView === view.key}
              onClick={() => setActiveView(view.key)}
            />
          ))}
        </nav>
        <div className="sidebar-footer">אירועים ביומן נוצרים רק אחרי לחיצה על &quot;אשר שיבוץ&quot;.</div>
      </aside>

      <main className="main">
        <nav className="mobile-nav" aria-label="ניווט מובייל">
          {views.map((view) => (
            <NavButton
              key={view.key}
              view={view}
              active={activeView === view.key}
              onClick={() => setActiveView(view.key)}
            />
          ))}
        </nav>
        <header className="topbar">
          <div>
            <h1>שלום!</h1>
            <p>
              {userEmail} · ניהול משימות, יומן והמלצות במקום אחד
            </p>
          </div>
          <div className="user-actions">
            <button className="button secondary" type="button" onClick={() => runAction(refreshState)} disabled={loading}>
              {loading ? <Loader2 size={18} /> : <RefreshCcw size={18} />}
              רענן
            </button>
            <button className="button primary" type="button" onClick={() => setActiveView("chat")}>
              <MessageCircle size={18} />
              דבר עם הסוכן
            </button>
          </div>
        </header>

        {notice ? <div className="notice">{notice}</div> : null}
        {error ? <div className="error">{error}</div> : null}

        {renderActiveView()}
      </main>
    </div>
  );
}
