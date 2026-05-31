"use client";

import type { ElementType, FormEvent } from "react";
import { useMemo, useState } from "react";
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
  const pendingSessions = useMemo(
    () => state.sessions.filter((session) => session.status === "pending"),
    [state.sessions]
  );
  const scheduledSessions = useMemo(
    () => state.sessions.filter((session) => session.status === "scheduled"),
    [state.sessions]
  );

  async function refreshState() {
    const response = await fetch("/api/state");
    const payload = await response.json();
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
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "לא הצלחתי להוסיף משימה");
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
      setNotice("המשימה נשמרה");
    });
  }

  async function updateTaskStatus(task: DbTask, status: string) {
    await runAction(async () => {
      const response = await fetch(`/api/tasks/${task.tasks_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "לא הצלחתי לעדכן סטטוס");
      setNotice("הסטטוס עודכן");
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
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "לא הצלחתי לשלוח הודעה");
    });
  }

  async function generateRecommendations() {
    await runAction(async () => {
      const response = await fetch("/api/recommendations/generate", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "לא הצלחתי ליצור המלצות");
      setNotice(payload.message || "נוצרו המלצות חדשות");
    });
  }

  async function recommendationAction(session: DbTaskSession, action: "approve" | "reject" | "alternate" | "complete") {
    await runAction(async () => {
      const response = await fetch(`/api/recommendations/${session.session_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "לא הצלחתי לעדכן המלצה");
      setNotice(payload.message || "ההמלצה עודכנה");
      if (action === "alternate") {
        await fetch("/api/recommendations/generate", { method: "POST" });
      }
    });
  }

  async function deleteCalendarEvent(event: CalendarEvent) {
    const confirmed = window.confirm(`למחוק את האירוע "${event.summary}" מהיומן?`);
    if (!confirmed) return;

    await runAction(async () => {
      const response = await fetch(`/api/calendar/events/${encodeURIComponent(event.id)}`, {
        method: "DELETE"
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "לא הצלחתי למחוק את האירוע");
      setNotice(payload.message || "האירוע נמחק מהיומן");
    });
  }

  function renderTask(task: DbTask) {
    return (
      <article className="row" key={task.tasks_id}>
        <div className="row-title">
          <strong>{task.task_title || "משימה ללא כותרת"}</strong>
          <StatusBadge status={task.status} />
        </div>
        {task.description ? <div className="muted">{task.description}</div> : null}
        <div className="meta">
          <span>דדליין: {formatDateTime(task.deadline)}</span>
          <span>זמן משוער: {task.estimated_minutes || 60} דקות</span>
          <span>עדיפות: {task.priority || 3}</span>
          {task.course_name ? <span>קורס: {task.course_name}</span> : null}
        </div>
        <div className="recommendation-actions">
          <button
            className="button secondary"
            type="button"
            onClick={() => updateTaskStatus(task, "in_progress")}
            disabled={loading}
          >
            בתהליך
          </button>
          <button
            className="button success"
            type="button"
            onClick={() => updateTaskStatus(task, "completed")}
            disabled={loading}
          >
            <CheckCircle2 size={16} />
            הושלם
          </button>
        </div>
      </article>
    );
  }

  function renderRecommendation(session: DbTaskSession) {
    return (
      <article className="row" key={session.session_id}>
        <div className="row-title">
          <strong>{session.tasks?.task_title || "סשן למידה"}</strong>
          <StatusBadge status={session.status} />
        </div>
        <div className="meta">
          <span>
            {session.start_time && session.end_time
              ? `${formatDateTime(session.start_time)} | ${formatTimeRange(session.start_time, session.end_time)}`
              : "לא נקבע זמן"}
          </span>
          {session.tasks?.course_name ? <span>קורס: {session.tasks.course_name}</span> : null}
        </div>
        {session.reason ? <div className="notice">{session.reason}</div> : null}
        <div className="recommendation-actions">
          {session.status === "pending" ? (
            <>
              <button
                className="button success"
                type="button"
                onClick={() => recommendationAction(session, "approve")}
                disabled={loading}
              >
                <CheckCircle2 size={16} />
                אשר שיבוץ
              </button>
              <button
                className="button danger"
                type="button"
                onClick={() => recommendationAction(session, "reject")}
                disabled={loading}
              >
                <XCircle size={16} />
                דחה
              </button>
              <button
                className="button secondary"
                type="button"
                onClick={() => recommendationAction(session, "alternate")}
                disabled={loading}
              >
                <RefreshCcw size={16} />
                הצע זמן אחר
              </button>
            </>
          ) : null}
          {session.status === "scheduled" ? (
            <button
              className="button secondary"
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
            <div className="muted">משימות פתוחות עם דדליין קרוב.</div>
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
              {upcomingTasks.length ? upcomingTasks.map(renderTask) : <EmptyState>אין עדיין משימות</EmptyState>}
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
        <div className="messages">
          {state.messages.length ? (
            state.messages.map((message) => (
              <div className={`message ${message.role === "assistant" ? "assistant" : "user"}`} key={message.id}>
                {message.chatInput}
              </div>
            ))
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
            {state.tasks.length ? state.tasks.map(renderTask) : <EmptyState>אין עדיין משימות</EmptyState>}
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
                <article className="row" key={event.id}>
                  <div className="row-title">
                    <strong>{event.summary}</strong>
                    <button
                      aria-label={`מחק את ${event.summary}`}
                      className="button danger calendar-delete-button"
                      disabled={loading}
                      onClick={() => deleteCalendarEvent(event)}
                      title="מחק אירוע"
                      type="button"
                    >
                      <Trash2 size={16} />
                      מחק
                    </button>
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
            <p>הסוכן מציע זמנים לפי דחיפות, עדיפות וזמינות. אירוע נוצר רק אחרי אישור.</p>
          </div>
          <button className="button primary" type="button" onClick={generateRecommendations} disabled={loading}>
            <Sparkles size={18} />
            צור המלצות
          </button>
        </div>
        <div className="list">
          {state.sessions.length ? (
            state.sessions.map(renderRecommendation)
          ) : (
            <EmptyState>אין המלצות כרגע</EmptyState>
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
                <strong>זיכרון שיחה</strong>
              </div>
              <div className="muted">הצ׳אט משתמש בעשר ההודעות האחרונות שנשמרו ב-Supabase.</div>
            </div>
            <div className="row">
              <div className="row-title">
                <strong>יצירת אירועים ביומן</strong>
              </div>
              <div className="muted">המערכת מבקשת אישור מפורש לפני כל יצירת אירוע ב-Google Calendar.</div>
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
        <div className="sidebar-footer">המלצות נשמרות ב-Supabase, ואירועים נוצרים רק אחרי אישור.</div>
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
            <h1>שלום, טוב שחזרת</h1>
            <p>כאן מנהלים משימות, צ׳אט, המלצות ויומן במקום אחד.</p>
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
