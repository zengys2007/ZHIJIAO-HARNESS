import { useEffect, useRef, useState } from "react";
import type { SettingsSection } from "./Settings";
import type { SessionSummary } from "../lib/sessions";
import type { AuthUser } from "../types/api";

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
  /** 头像菜单里的退出登录 */
  onLogout: () => void;
  /** 已登录用户，或 null（未登录），或 undefined（正在确认） */
  user: AuthUser | null | undefined;
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
  onLogout,
  user,
}: SidebarProps) {
  const loggedIn = user !== null && user !== undefined;
  const accountLabel =
    user === undefined ? "正在确认登录…" : user ? user.display_name : "未登录";
  const [menuOpen, setMenuOpen] = useState(false);
  const accountRef = useRef<HTMLDivElement | null>(null);

  // 菜单打开时：点击外部 / Esc 关闭
  useEffect(() => {
    if (!menuOpen) return;
    const handleDoc = (e: MouseEvent) => {
      if (accountRef.current && !accountRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", handleDoc);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleDoc);
      document.removeEventListener("keydown", handleKey);
    };
  }, [menuOpen]);

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
          loggedIn={loggedIn}
          onNew={onNew}
          onSelect={onSelect}
        />
      )}
      <div className="account-inline" ref={accountRef}>
        <button
          className="account"
          type="button"
          aria-current={settingsOpen ? "page" : undefined}
          aria-haspopup={loggedIn ? "menu" : undefined}
          aria-expanded={loggedIn ? menuOpen : undefined}
          onClick={() => {
            if (loggedIn) {
              setMenuOpen((o) => !o);
            } else {
              onOpenSettings();
            }
          }}
        >
          <span className="avatar" aria-hidden="true">
            {loggedIn ? <UserMark /> : <GuestMark />}
          </span>
          <span className="account-name">{accountLabel}</span>
          {loggedIn ? (
            <span className="account-caret" aria-hidden="true">
              {menuOpen ? "▴" : "▾"}
            </span>
          ) : null}
        </button>
        {loggedIn && menuOpen ? (
          <div className="account-menu" role="menu" aria-label="账号操作">
            <button
              type="button"
              role="menuitem"
              className="account-menu-item"
              onClick={() => {
                setMenuOpen(false);
                onOpenSettings();
              }}
            >
              <GearIcon />
              设置
            </button>
            <button
              type="button"
              role="menuitem"
              className="account-menu-item is-danger"
              onClick={() => {
                setMenuOpen(false);
                onLogout();
              }}
            >
              <LogoutIcon />
              退出登录
            </button>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

function ChatNav({
  sessions,
  activeId,
  busy,
  preview,
  loggedIn,
  onNew,
  onSelect,
}: {
  sessions: SessionSummary[];
  activeId: string | null;
  busy: boolean;
  preview: boolean;
  loggedIn: boolean;
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
      <button className="new-chat" type="button" onClick={onNew} disabled={busy || !loggedIn}>
        新对话
      </button>
      {!loggedIn && !preview ? (
        <p className="preview-note">请先登录。</p>
      ) : preview ? (
        <p className="preview-note">本机服务未连接，当前只预览界面。</p>
      ) : null}
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

function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 3.8v2.4M12 17.8v2.4M4.6 12H7M17 12h2.4M6.6 6.6l1.7 1.7M15.7 15.7l1.7 1.7M17.4 6.6l-1.7 1.7M8.3 15.7l-1.7 1.7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
      <path
        d="M13 4.5H7a1.5 1.5 0 0 0-1.5 1.5v12A1.5 1.5 0 0 0 7 19.5h6M10.5 12h9m0 0-3-3m3 3-3 3"
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

function UserMark() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" focusable="false">
      <circle cx="12" cy="8" r="3.2" fill="currentColor" />
      <path fill="currentColor" d="M12 13.4c-3.7 0-6.6 1.9-6.9 5h13.8c-.3-3.1-3.2-5-6.9-5z" />
    </svg>
  );
}
