import { useEffect, useRef, useState } from "react";
import { useAppearance } from "../lib/appearance";
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
  /** 备课与学情视图是否打开 */
  teachingOpen: boolean;
  onOpenTeaching: () => void;
  onNew: () => void;
  onSelect: (id: string) => void;
  onPin: (id: string, pinned: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
  /** 头像菜单里的切换账号 */
  onSwitchAccount: () => void;
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
  teachingOpen,
  onOpenTeaching,
  onNew,
  onSelect,
  onPin,
  onDelete,
  onOpenSettings,
  onCloseSettings,
  onSwitchAccount,
  onLogout,
  user,
}: SidebarProps) {
  const { t } = useAppearance();
  const loggedIn = user !== null && user !== undefined;
  const accountLabel =
    user === undefined ? t("confirmingLogin") : user ? user.display_name : t("signedOut");
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
          teachingOpen={teachingOpen}
          onOpenTeaching={onOpenTeaching}
        onNew={onNew}
        onSelect={onSelect}
        onPin={onPin}
        onDelete={onDelete}
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
          <div className="account-menu" role="menu" aria-label={t("accountMenu")}>
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
              {t("settings")}
            </button>
            <button
              type="button"
              role="menuitem"
              className="account-menu-item"
              onClick={() => {
                setMenuOpen(false);
                onSwitchAccount();
              }}
            >
              <SwitchIcon />
              {t("switchAccount")}
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
              {t("logOut")}
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
  teachingOpen,
  onOpenTeaching,
  onNew,
  onSelect,
  onPin,
  onDelete,
}: {
  sessions: SessionSummary[];
  activeId: string | null;
  busy: boolean;
  preview: boolean;
  loggedIn: boolean;
  teachingOpen: boolean;
  onOpenTeaching: () => void;
  onNew: () => void;
  onSelect: (id: string) => void;
  onPin: (id: string, pinned: boolean) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const { t } = useAppearance();
  const [openId, setOpenId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const menuRef = useRef<HTMLLIElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!openId) return;
    const handleDoc = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpenId(null);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenId(null);
    };
    document.addEventListener("mousedown", handleDoc);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleDoc);
      document.removeEventListener("keydown", handleKey);
    };
  }, [openId]);

  useEffect(() => {
    if (!confirmId) return;
    cancelRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !deleting) {
        setConfirmId(null);
        setDeleteError(null);
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [confirmId, deleting]);

  async function confirmDelete() {
    if (!confirmId || deleting) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await onDelete(confirmId);
      setConfirmId(null);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : t("systemError"));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="brand-row">
        <span className="mark" aria-hidden="true">
          智
        </span>
        <p className="brand">智教harness</p>
      </div>
      <button className="new-chat" type="button" onClick={onNew} disabled={busy || !loggedIn}>
        {t("newChat")}
      </button>
      <button
        className="new-chat side-teaching"
        type="button"
        aria-current={teachingOpen ? "page" : undefined}
        onClick={onOpenTeaching}
        disabled={busy || !loggedIn}
      >
        备课与学情
      </button>
      {!loggedIn && !preview ? (
        <p className="preview-note">{t("signInFirst")}</p>
      ) : preview ? (
        <p className="preview-note">{t("previewOffline")}</p>
      ) : null}
      <div className="session-scroll">
        {sessions.length === 0 ? (
          <p className="empty-list">{t("noSessions")}</p>
        ) : (
          <ul className="session-list">
            {sessions.map((session) => {
              const menuOpen = openId === session.id;
              const deleteLocked = busy && session.id === activeId;
              return (
                <li key={session.id} ref={menuOpen ? menuRef : undefined}>
                  <button
                    className="session"
                    type="button"
                    aria-current={session.id === activeId ? "page" : undefined}
                    title={session.title}
                    disabled={busy}
                    onClick={() => onSelect(session.id)}
                  >
                    {session.pinned ? <PinMark /> : null}
                    <span className="session-title">{session.title}</span>
                  </button>
                  {loggedIn && !preview ? (
                    <button
                      className="session-more"
                      type="button"
                      aria-label={t("sessionActions")}
                      aria-haspopup="menu"
                      aria-expanded={menuOpen}
                      onClick={(event) => {
                        if (menuOpen) {
                          setOpenId(null);
                          return;
                        }
                        const rect = event.currentTarget.getBoundingClientRect();
                        const menuHeight = 88;
                        const top =
                          rect.bottom + menuHeight > window.innerHeight ? rect.top - menuHeight - 4 : rect.bottom + 4;
                        setMenuPos({ top, left: Math.max(8, rect.right - 148) });
                        setOpenId(session.id);
                      }}
                    >
                      <MoreIcon />
                    </button>
                  ) : null}
                  {menuOpen ? (
                    <div
                      className="session-menu"
                      role="menu"
                      aria-label={t("sessionActions")}
                      style={menuPos ? { position: "fixed", top: menuPos.top, left: menuPos.left } : undefined}
                    >
                      <button
                        type="button"
                        role="menuitem"
                        className="session-menu-item"
                        onClick={() => {
                          setOpenId(null);
                          void onPin(session.id, !session.pinned);
                        }}
                      >
                        <PinMark />
                        {session.pinned ? t("unpin") : t("pin")}
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="session-menu-item is-danger"
                        disabled={deleteLocked}
                        title={deleteLocked ? t("deleteBusy") : undefined}
                        onClick={() => {
                          setOpenId(null);
                          setDeleteError(null);
                          setConfirmId(session.id);
                        }}
                      >
                        {t("deleteSession")}
                      </button>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {confirmId ? (
        <div
          className="confirm-layer"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !deleting) {
              setConfirmId(null);
              setDeleteError(null);
            }
          }}
        >
          <div
            className="confirm-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-session-title"
          >
            <h2 id="delete-session-title">{t("deleteSessionTitle")}</h2>
            <p>{t("deleteSessionBody")}</p>
            {deleteError ? <p className="confirm-error">{deleteError}</p> : null}
            <div className="confirm-actions">
              <button
                ref={cancelRef}
                className="confirm-cancel"
                type="button"
                disabled={deleting}
                onClick={() => {
                  setConfirmId(null);
                  setDeleteError(null);
                }}
              >
                {t("cancel")}
              </button>
              <button
                className="confirm-delete"
                type="button"
                disabled={deleting}
                onClick={() => {
                  void confirmDelete();
                }}
              >
                {deleting ? t("deletingSession") : t("deleteSession")}
              </button>
            </div>
          </div>
        </div>
      ) : null}
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
  const { t } = useAppearance();
  return (
    <>
      <div className="settings-top">
        <button className="back-arrow" type="button" aria-label={t("back")} onClick={onBack}>
          <BackArrow />
        </button>
      </div>
      <nav className="session-scroll" aria-label={t("settings")}>
        <ul className="session-list">
          <li>
            <button
              className="settings-item"
              type="button"
              aria-current={section === "user" ? "page" : undefined}
              onClick={() => onSection("user")}
            >
              <UserSettingsIcon />
              {t("userSettings")}
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
              {t("appearance")}
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
              {t("connections")}
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

function PinMark() {
  return (
    <svg className="session-pin" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
      <path
        d="M9 4.5h6l-1 5.2 3 2.8v2H7v-2l3-2.8-1-5.2Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M12 14.5v5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
      <circle cx="6" cy="12" r="1.4" fill="currentColor" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" />
      <circle cx="18" cy="12" r="1.4" fill="currentColor" />
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

function SwitchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false">
      <path
        d="M4.5 8.5h13m0 0-3.2-3.2m3.2 3.2-3.2 3.2M19.5 15.5h-13m0 0 3.2-3.2m-3.2 3.2 3.2 3.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
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
