import { Bot, CalendarCheck, Clock, ListChecks } from "lucide-react";
import { AuthPanel } from "@/components/auth-panel";

export default function LoginPage() {
  return (
    <main className="auth-page page">
      <section className="auth-hero">
        <div className="brand-row">
          <div className="brand-mark">
            <Bot size={24} />
          </div>
          <strong>סוכן לימודים חכם</strong>
        </div>
        <div>
          <h1>נהל משימות, למידה ויומן במקום אחד</h1>
          <p>
            עוזר AI בעברית שמבין דדליינים, מוצא חלונות פנויים ב-Google Calendar, ומציע סשני
            למידה לפני שהוא יוצר אירוע ביומן.
          </p>
        </div>
        <div className="auth-points">
          <div className="point">
            <Clock size={20} />
            <strong>זמן פנוי</strong>
            <span>זיהוי חלונות למידה לפי היומן האישי שלך.</span>
          </div>
          <div className="point">
            <ListChecks size={20} />
            <strong>דדליינים</strong>
            <span>סידור משימות לפי דחיפות ועדיפות.</span>
          </div>
          <div className="point">
            <CalendarCheck size={20} />
            <strong>אישור לפני שיבוץ</strong>
            <span>אירוע נוצר ביומן רק אחרי אישור מפורש שלך.</span>
          </div>
        </div>
      </section>
      <AuthPanel />
    </main>
  );
}
