import type { SessionSummary } from "../lib/sessions";

type SidebarProps = {
  sessions: SessionSummary[];
  activeId: string | null;
  busy: boolean;
  preview: boolean;
  onNew: () => void;
  onSelect: (id: string) => void;
};

export function Sidebar({ sessions, activeId, busy, preview, onNew, onSelect }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand-row">
        <span className="mark" aria-hidden="true">
          智
        </span>
        <p className="brand">智教harness</p>
      </div>
      <button className="new-chat" type="button" onClick={onNew} disabled={busy}>
        新对话
      </button>
      {preview ? <p className="preview-note">本机服务未连接，当前只预览界面。</p> : null}
      {sessions.length === 0 ? (
        <p className="empty-list">还没有会话</p>
      ) : (
        <ul className="session-list">
          {sessions.map((session) => (
            <li key={session.id}>
              <button
                className="session"
                type="button"
                aria-current={session.id === activeId ? "page" : undefined}
                title={session.title}
                disabled={busy}
                onClick={() => onSelect(session.id)}
              >
                {session.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
