import type { SettingsSection } from "./Settings";
import type { SessionSummary } from "../lib/sessions";

type SidebarProps = {
  sessions: SessionSummary[];
  activeId: string | null;
  busy: boolean;
  preview: boolean;
  settingsOpen: boolean;
  settingsSection: SettingsSection;
  onSettingsSection: (section: SettingsSection) => void;
  onNew: () => void;
  onSelect: (id: string) => void;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
};

export function Sidebar({
  sessions,
  activeId,
  busy,
  preview,
  settingsOpen,
  settingsSection,
  onSettingsSection,
  onNew,
  onSelect,
  onOpenSettings,
  onCloseSettings,
}: SidebarProps) {
  return (
    <aside className="sidebar">
      {settingsOpen ? (
        <SettingsNav section={settingsSection} onSection={onSettingsSection} onBack={onCloseSettings} />
      ) : (
        <ChatNav
          sessions={sessions}
          activeId={activeId}
          busy={busy}
          preview={preview}
          onNew={onNew}
          onSelect={onSelect}
        />
      )}
      <button className="account" type="button" aria-current={settingsOpen ? "page" : undefined} onClick={onOpenSettings}>
        <span className="avatar" aria-hidden="true">
          <GuestMark />
        </span>
        <span className="account-name">未登录</span>
      </button>
    </aside>
  );
}

function ChatNav({
  sessions,
  activeId,
  busy,
  preview,
  onNew,
  onSelect,
}: {
  sessions: SessionSummary[];
  activeId: string | null;
  busy: boolean;
  preview: boolean;
  onNew: () => void;
  onSelect: (id: string) => void;
}) {
  return (
    <>
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
      <div className="session-scroll">
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
      </div>
    </>
  );
}

function SettingsNav({
  section,
  onSection,
  onBack,
}: {
  section: SettingsSection;
  onSection: (section: SettingsSection) => void;
  onBack: () => void;
}) {
  return (
    <>
      <div className="settings-top">
        <button className="back-arrow" type="button" aria-label="返回" onClick={onBack}>
          <BackArrow />
        </button>
      </div>
      <nav className="session-scroll" aria-label="设置">
        <ul className="session-list">
          <li>
            <button
              className="settings-item"
              type="button"
              aria-current={section === "user" ? "page" : undefined}
              onClick={() => onSection("user")}
            >
              <UserSettingsIcon />
              用户设置
            </button>
          </li>
          <li>
            <button
              className="settings-item"
              type="button"
              aria-current={section === "appearance" ? "page" : undefined}
              onClick={() => onSection("appearance")}
            >
              <AppearanceIcon />
              外观
            </button>
          </li>
          <li>
            <button
              className="settings-item"
              type="button"
              aria-current={section === "connections" ? "page" : undefined}
              onClick={() => onSection("connections")}
            >
              <ConnectionsIcon />
              API/MCPs配置
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}

function UserSettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <circle cx="12" cy="8" r="3.1" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M5.8 19.2c1.2-2.8 3.4-4.2 6.2-4.2s5 1.4 6.2 4.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
function AppearanceIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M18 6l-1.6 1.6M7.6 16.4 6 18"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ConnectionsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <circle cx="7" cy="12" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="17" cy="7" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="17" cy="17" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M9.1 11.2 14.8 8.1M9.1 12.8l5.7 3.1" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function BackArrow() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path
        d="M14.5 5.5 8 12l6.5 6.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GuestMark() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" focusable="false">
      <circle cx="12" cy="8" r="3.2" fill="currentColor" />
      <path fill="currentColor" d="M12 13.4c-3.7 0-6.6 1.9-6.9 5h13.8c-.3-3.1-3.2-5-6.9-5z" />
    </svg>
  );
}
