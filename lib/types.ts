export type MessageRole = "user" | "assistant";

export type DbMessage = {
  id: string;
  user_id: string | null;
  role: MessageRole | null;
  chatInput: string | null;
  source: string | null;
  created_at: string;
};

export type DbTask = {
  tasks_id: string;
  user_id: string;
  task_title: string | null;
  description: string | null;
  course_name: string | null;
  task_type: string | null;
  deadline: string | null;
  estimated_minutes: number | null;
  priority: number | null;
  status: string;
  created_at: string;
  updated_at: string | null;
};

export type DbTaskSession = {
  session_id: string;
  task_id: string;
  user_id: string | null;
  start_time: string | null;
  end_time: string | null;
  status: string | null;
  notes: string | null;
  reason: string | null;
  google_calendar_event_id: string | null;
  created_at: string;
  updated_at: string | null;
  tasks?: Pick<DbTask, "tasks_id" | "task_title" | "course_name" | "deadline" | "priority" | "estimated_minutes"> | null;
};

export type CalendarEvent = {
  id: string;
  summary: string;
  start: string;
  end: string;
};

export type CalendarStatus = {
  connected: boolean;
  message: string;
};

export type AppState = {
  tasks: DbTask[];
  messages: DbMessage[];
  sessions: DbTaskSession[];
  calendarEvents: CalendarEvent[];
  calendarStatus: CalendarStatus;
};

export type FreeWindow = {
  start: Date;
  end: Date;
};
