import { useState } from "react";
import { useAppearance } from "../lib/appearance";
import { codePointLength } from "../lib/text";

type Props = {
  onLogin: (username: string, password: string) => Promise<void>;
  onRegister: (username: string, password: string, displayName?: string) => Promise<void>;
};

type Mode = "login" | "register";

// ===== 前端校验（按登录设计文档第 3 节） =====
// 登录请求体去掉首尾空白。密码不去空白。
function trimUsername(value: string) {
  return value.trim();
}

function isValidUsername(value: string): boolean {
  // 1–32 码位、不含任何空白码位
  if (codePointLength(value) < 1 || codePointLength(value) > 32) return false;
  return !/\s/u.test(value);
}

function isValidPassword(value: string): boolean {
  // 8–128 码位
  const n = codePointLength(value);
  return n >= 8 && n <= 128;
}

function isValidDisplayName(value: string): boolean {
  // 填写了就必须 1–32 码位。中间可以有空格
  if (!value) return true; // 注册里显示名可空
  const trimmed = value.trim();
  if (!trimmed) return false; // 全空字符串视为无效
  const n = codePointLength(trimmed);
  return n >= 1 && n <= 32;
}

// 演示账号：本地开发库里的冒烟账号，仅用于一键填充演示
const DEMO_USERNAME = "smoketest";
const DEMO_PASSWORD = "smoke-test-123";

export function AuthForm({ onLogin, onRegister }: Props) {
  const { t } = useAppearance();
  const [mode, setMode] = useState<Mode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [clientErrors, setClientErrors] = useState<{ username?: string; password?: string; display_name?: string }>({});

  const isLogin = mode === "login";

  function validate(): boolean {
    const u = trimUsername(username);
    const errs: typeof clientErrors = {};
    if (!isValidUsername(u)) errs.username = t("usernameError");
    if (!isValidPassword(password)) errs.password = t("passwordError");
    if (!isLogin && !isValidDisplayName(displayName.trim())) errs.display_name = t("displayNameError");
    setClientErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setBanner(null);
    if (!validate()) return;

    setSubmitting(true);
    try {
      if (isLogin) {
        await onLogin(trimUsername(username), password);
      } else {
        const dn = displayName.trim();
        await onRegister(trimUsername(username), password, dn || undefined);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "系统出错了，可以再发一次。";
      setBanner(msg);
    } finally {
      setSubmitting(false);
    }
  }

  function switchMode(next: Mode) {
    setMode(next);
    setClientErrors({});
    setBanner(null);
  }

  /** 一键填充演示账号：只填入表单，不提交登录 */
  function fillDemo() {
    setUsername(DEMO_USERNAME);
    setPassword(DEMO_PASSWORD);
    setClientErrors({});
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <h1 className="auth-title">{isLogin ? t("signIn") : t("register")}</h1>
        <form className="auth-form" onSubmit={handleSubmit} noValidate>
          <label className="auth-field">
            <span>{t("username")}</span>
            <input
              name="username"
              autoComplete="username"
              value={username}
              disabled={submitting}
              aria-invalid={Boolean(clientErrors.username)}
              onChange={(e) => setUsername(e.target.value)}
              onBlur={() => {
                const u = trimUsername(username);
                if (u && !isValidUsername(u)) setClientErrors((p) => ({ ...p, username: t("usernameError") }));
              }}
            />
            {clientErrors.username ? <small className="auth-error">{clientErrors.username}</small> : null}
          </label>

          <label className="auth-field">
            <span>{t("password")}</span>
            <input
              name="password"
              type="password"
              autoComplete={isLogin ? "current-password" : "new-password"}
              value={password}
              disabled={submitting}
              aria-invalid={Boolean(clientErrors.password)}
              onChange={(e) => setPassword(e.target.value)}
              onBlur={() => {
                if (password && !isValidPassword(password)) setClientErrors((p) => ({ ...p, password: t("passwordError") }));
              }}
            />
            {clientErrors.password ? <small className="auth-error">{clientErrors.password}</small> : null}
          </label>

          {!isLogin ? (
            <label className="auth-field">
              <span>
                {t("displayName")} <em className="auth-optional">{t("displayNameOptional")}</em>
              </span>
              <input
                name="display-name"
                autoComplete="nickname"
                value={displayName}
                disabled={submitting}
                aria-invalid={Boolean(clientErrors.display_name)}
                onChange={(e) => setDisplayName(e.target.value)}
                onBlur={() => {
                  const trimmed = displayName.trim();
                  if (trimmed && !isValidDisplayName(trimmed))
                    setClientErrors((p) => ({ ...p, display_name: t("displayNameError") }));
                }}
              />
              {clientErrors.display_name ? <small className="auth-error">{clientErrors.display_name}</small> : null}
            </label>
          ) : null}

          {banner ? (
            <p className="auth-banner" role="alert">
              {banner}
            </p>
          ) : null}

          <button type="submit" className="auth-submit" disabled={submitting}>
            {submitting ? (isLogin ? t("signingIn") : t("signingUp")) : isLogin ? t("signIn") : t("register")}
          </button>

          <p className="auth-switch">
            {isLogin ? (
              <>
                {t("noAccount")}
                <button type="button" className="auth-link" disabled={submitting} onClick={() => switchMode("register")}>
                  {t("goRegister")}
                </button>
              </>
            ) : (
              <>
                {t("hasAccount")}
                <button type="button" className="auth-link" disabled={submitting} onClick={() => switchMode("login")}>
                  {t("goLogin")}
                </button>
              </>
            )}
          </p>
          {isLogin ? (
            <button type="button" className="auth-demo-fill" disabled={submitting} onClick={fillDemo}>
              {t("fillDemo")}
            </button>
          ) : null}
        </form>
      </div>
    </div>
  );
}
