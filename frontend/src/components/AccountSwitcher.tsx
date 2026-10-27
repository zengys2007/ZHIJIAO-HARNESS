import { useState } from "react";
import { ApiRequestError } from "../api/http";
import type { RememberedAccount } from "../lib/accounts";
import { useAppearance } from "../lib/appearance";
import { codePointLength } from "../lib/text";

type Props = {
  /** 本机登录过的账号列表 */
  accounts: RememberedAccount[];
  /** 没有免密令牌，或令牌失效后，用密码登录 */
  onLogin: (username: string, password: string) => Promise<void>;
  /** 有记住此设备的令牌时，点账号直接恢复会话 */
  onResume: (account: RememberedAccount) => Promise<void>;
  /** 添加新账号：回到完整的登录/注册表单 */
  onAddAccount: () => void;
};

export function AccountSwitcher({ accounts, onLogin, onResume, onAddAccount }: Props) {
  const { t } = useAppearance();
  const [selected, setSelected] = useState<RememberedAccount | null>(null);
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [listBanner, setListBanner] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  function backToList() {
    setSelected(null);
    setPassword("");
    setBanner(null);
    setPasswordError(null);
  }

  function openPassword(account: RememberedAccount, message: string | null) {
    setSelected(account);
    setPassword("");
    setPasswordError(null);
    setBanner(message);
  }

  async function choose(account: RememberedAccount) {
    if (submitting || resuming) return;
    if (!account.token) {
      openPassword(account, null);
      return;
    }
    setResuming(true);
    setListBanner(null);
    try {
      await onResume(account);
    } catch (error) {
      if (error instanceof ApiRequestError && (error.status === 401 || error.code === "unauthenticated")) {
        openPassword(account, t("resumeExpired"));
        return;
      }
      const msg = error instanceof Error ? error.message : t("systemError");
      setListBanner(msg);
    } finally {
      setResuming(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting || !selected) return;
    setBanner(null);
    const n = codePointLength(password);
    if (n < 8 || n > 128) {
      setPasswordError(t("passwordError"));
      return;
    }
    setPasswordError(null);
    setSubmitting(true);
    try {
      await onLogin(selected.username, password);
    } catch (error) {
      const msg = error instanceof Error ? error.message : t("systemError");
      setBanner(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1 className="auth-title">{t("switchAccount")}</h1>
        {selected === null ? (
          <div className="switch-list">
            {accounts.length === 0 ? <p className="switch-empty">{t("noRemembered")}</p> : null}
            {accounts.map((account) => (
              <button
                key={account.username}
                type="button"
                className="switch-account"
                disabled={resuming}
                aria-busy={resuming || undefined}
                onClick={() => {
                  void choose(account);
                }}
              >
                <span className="avatar" aria-hidden="true">
                  <UserMark />
                </span>
                <span className="switch-account-text">
                  <span className="switch-account-name">{account.display_name || account.username}</span>
                  <span className="switch-account-id">{account.username}</span>
                </span>
                <span className="account-caret" aria-hidden="true">
                  ▸
                </span>
              </button>
            ))}
            <button type="button" className="switch-add" disabled={resuming} onClick={onAddAccount}>
              <PlusIcon />
              {t("addAccount")}
            </button>
            {listBanner ? (
              <p className="auth-banner" role="alert">
                {listBanner}
              </p>
            ) : null}
          </div>
        ) : (
          <form className="auth-form" onSubmit={handleSubmit} noValidate>
            <div className="switch-current">
              <span className="avatar" aria-hidden="true">
                <UserMark />
              </span>
              <span className="switch-account-text">
                <span className="switch-account-name">{selected.display_name || selected.username}</span>
                <span className="switch-account-id">{selected.username}</span>
              </span>
            </div>
            <label className="auth-field">
              <span>{t("password")}</span>
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                autoFocus
                value={password}
                disabled={submitting}
                aria-invalid={passwordError ? true : undefined}
                onChange={(e) => setPassword(e.target.value)}
              />
              {passwordError ? <small className="auth-error">{passwordError}</small> : null}
            </label>
            {banner ? (
              <p className="auth-banner" role="alert">
                {banner}
              </p>
            ) : null}
            <button type="submit" className="auth-submit" disabled={submitting}>
              {submitting ? t("signingIn") : t("signIn")}
            </button>
            <button type="button" className="auth-link" disabled={submitting} onClick={backToList}>
              {t("otherAccount")}
            </button>
          </form>
        )}
      </div>
    </div>
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

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path
        d="M12 5.5v13M5.5 12h13"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
