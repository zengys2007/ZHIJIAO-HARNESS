import { useEffect, useState, type ReactNode } from "react";
import { DisconnectError, loadLlmSources, probeLlm, type LlmSources, type ProbeRequest } from "../api/http";
import { FONT_MAX, FONT_MIN, useAppearance, type ThemeChoice } from "../lib/appearance";
import type { AuthUser } from "../types/api";

export type SettingsSection = "user" | "appearance" | "connections";

type UserProps =
  | { authenticated: false; user?: undefined }
  | {
      authenticated: true;
      user: AuthUser;
    };

export function Settings({
  section,
  probe = probeLlm,
  loadSources = loadLlmSources,
  ...userProps
}: {
  section: SettingsSection;
  probe?: (body: ProbeRequest, signal?: AbortSignal) => Promise<{ reachable: boolean }>;
  loadSources?: (signal?: AbortSignal) => Promise<LlmSources>;
} & UserProps) {
  if (section === "connections") return <ApiConfig probe={probe} loadSources={loadSources} />;
  if (section === "appearance") return <AppearanceSettings />;
  return <UserSettings {...userProps} />;
}

function AppearanceSettings() {
  const { theme, locale, fontScale, setTheme, setLocale, setFontScale, t } = useAppearance();
  const choices: { id: ThemeChoice; label: string; icon: ReactNode }[] = [
    { id: "light", label: t("themeLight"), icon: <SunIcon /> },
    { id: "dark", label: t("themeDark"), icon: <MoonIcon /> },
    { id: "system", label: t("themeSystem"), icon: <ComputerIcon /> },
  ];

  return (
    <section className="settings" aria-label={t("appearance")}>
      <div className="settings-column">
        <h1>{t("appearance")}</h1>
        <div className="appearance-block">
          <p className="appearance-label" id="theme-label">
            {t("theme")}
          </p>
          <div className="theme-choices" role="radiogroup" aria-labelledby="theme-label">
            {choices.map((choice) => (
              <button
                key={choice.id}
                type="button"
                role="radio"
                className="theme-choice"
                aria-checked={theme === choice.id}
                onClick={() => setTheme(choice.id)}
              >
                {choice.icon}
                <span>{choice.label}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="appearance-block">
          <p className="appearance-label">{t("language")}</p>
          <div className="segment" role="radiogroup" aria-label={t("language")}>
            <label className={locale === "zh" ? "is-selected" : undefined}>
              <input
                type="radio"
                name="appearance-locale"
                value="zh"
                checked={locale === "zh"}
                onChange={() => setLocale("zh")}
              />
              中文
            </label>
            <label className={locale === "en" ? "is-selected" : undefined}>
              <input
                type="radio"
                name="appearance-locale"
                value="en"
                checked={locale === "en"}
                onChange={() => setLocale("en")}
              />
              English
            </label>
          </div>
        </div>
        <div className="appearance-block">
          <p className="appearance-label" id="font-size-label">
            {t("fontSize")}
          </p>
          <div className="font-size-row">
            <span>{t("fontSmall")}</span>
            <input
              type="range"
              min={FONT_MIN}
              max={FONT_MAX}
              step={0.125}
              value={fontScale}
              aria-labelledby="font-size-label"
              onChange={(event) => setFontScale(Number(event.target.value))}
            />
            <span>{t("fontLarge")}</span>
            <span className="font-size-value">{Math.round(fontScale * 16)}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
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

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <path
        d="M15.5 3.8a7.8 7.8 0 1 0 4.7 12.6A8.2 8.2 0 0 1 15.5 3.8z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ComputerIcon() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true" focusable="false">
      <rect x="3.5" y="4.5" width="17" height="11.5" rx="1.6" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 19.5h8M12 16v3.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function UserSettings(props: UserProps) {
  const { t } = useAppearance();
  if (!props.authenticated) {
    return (
      <section className="settings" aria-label={t("userSettings")}>
        <div className="settings-column">
          <h1>{t("userSettings")}</h1>
          <p>{t("signInFirst")}</p>
        </div>
      </section>
    );
  }
  const { user } = props;
  return (
    <section className="settings" aria-label={t("userSettings")}>
      <div className="settings-column">
        <h1>{t("userSettings")}</h1>
        <dl className="user-profile">
          <div>
            <dt>{t("displayName")}</dt>
            <dd>{user.display_name}</dd>
          </div>
          <div>
            <dt>{t("username")}</dt>
            <dd>{user.username}</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

function ApiConfig({
  probe,
  loadSources,
}: {
  probe: (body: ProbeRequest, signal?: AbortSignal) => Promise<{ reachable: boolean }>;
  loadSources: (signal?: AbortSignal) => Promise<LlmSources>;
}) {
  const { t } = useAppearance();
  const [source, setSource] = useState<"local" | "dotenv">("local");
  const [sources, setSources] = useState<LlmSources | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [probeState, setProbeState] = useState<ProbeState>("checking");
  const dotenv = source === "dotenv";

  useEffect(() => {
    const controller = new AbortController();
    loadSources(controller.signal)
      .then((loaded) => {
        if (controller.signal.aborted) return;
        setSources(loaded);
        setBaseUrl(loaded.dotenv.base_url);
        setModel(loaded.dotenv.model);
        setLoaded(true);
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoaded(true);
      });
    return () => controller.abort();
  }, [loadSources]);

  useEffect(() => {
    const controller = new AbortController();
    const localMissing = !dotenv && loaded && !environmentReady(sources?.environment);
    if ((dotenv && !loaded) || localMissing) {
      if (localMissing) setProbeState("unset");
      return () => controller.abort();
    }
    const timer = window.setTimeout(() => {
      setProbeState("checking");
      const body: ProbeRequest = dotenv
        ? {
            source: "dotenv",
            base_url: baseUrl.trim(),
            model: model.trim(),
            ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
          }
        : { source: "local" };
      probe(body, controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) setProbeState(result.reachable ? "up" : "down");
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setProbeState(error instanceof DisconnectError ? "offline" : "down");
        });
    }, dotenv ? 400 : 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [dotenv, loaded, sources, baseUrl, model, apiKey, probe]);

  const environment = sources?.environment;
  const shownUrl = dotenv ? baseUrl : environment?.base_url ?? "";
  const shownModel = dotenv ? model : environment?.model ?? "";
  const keyPlaceholder = dotenv
    ? sources?.dotenv.has_api_key
      ? t("keyKeep")
      : t("keyEnter")
    : environment?.has_api_key
      ? t("keyFromEnv")
      : t("keyMissing");

  return (
    <section className="settings" aria-label={t("connections")}>
      <div className="settings-column">
        <h1>{t("connections")}</h1>
        <p className="settings-lead">{t("apiLead")}</p>
        <form className="api-form" onSubmit={(event) => event.preventDefault()}>
          <div className="segment" role="radiogroup" aria-label={t("source")}>
            <label className={source === "local" ? "is-selected" : undefined}>
              <input
                type="radio"
                name="api-source"
                value="local"
                checked={source === "local"}
                onChange={() => setSource("local")}
              />
              {t("localEnv")}
            </label>
            <label className={source === "dotenv" ? "is-selected" : undefined}>
              <input
                type="radio"
                name="api-source"
                value="dotenv"
                checked={source === "dotenv"}
                onChange={() => setSource("dotenv")}
              />
              {t("customEnv")}
            </label>
          </div>
          <div className="api-card">
            <label className="api-row">
              <span>{t("serviceUrl")}</span>
              <input
                name="base-url"
                type="url"
                value={shownUrl}
                placeholder={dotenv ? "http://127.0.0.1:9" : t("urlMissing")}
                disabled={!dotenv}
                autoComplete="off"
                onChange={(event) => setBaseUrl(event.target.value)}
              />
            </label>
            <label className="api-row">
              <span>{t("modelName")}</span>
              <input
                name="model"
                value={shownModel}
                placeholder={dotenv ? t("modelMissing") : t("urlMissing")}
                disabled={!dotenv}
                autoComplete="off"
                onChange={(event) => setModel(event.target.value)}
              />
            </label>
            <label className="api-row">
              <span>{t("secret")}</span>
              <input
                name="api-key"
                type="password"
                value={dotenv ? apiKey : ""}
                placeholder={keyPlaceholder}
                disabled={!dotenv}
                autoComplete="off"
                onChange={(event) => setApiKey(event.target.value)}
              />
            </label>
            <div className="api-row probe-row">
              <span>{t("connected")}</span>
              <div className="probe-status">
                <span className="lamp" data-state={probeState} aria-hidden="true" />
                <p className="probe-label" role="status">
                  {probeCopy(probeState, t)}
                </p>
              </div>
            </div>
          </div>
        </form>
        <p className="hint api-note">{t("mcpNote")}</p>
      </div>
    </section>
  );
}

type ProbeState = "idle" | "checking" | "up" | "down" | "offline" | "unset";

function environmentReady(value: { base_url: string; model: string; has_api_key: boolean } | undefined): boolean {
  return Boolean(value && value.base_url && value.model && value.has_api_key);
}

function probeCopy(state: ProbeState, t: (key: "checking" | "reachable" | "unreachable" | "offlineService" | "unsetEnv" | "notChecked") => string): string {
  if (state === "checking") return t("checking");
  if (state === "up") return t("reachable");
  if (state === "down") return t("unreachable");
  if (state === "offline") return t("offlineService");
  if (state === "unset") return t("unsetEnv");
  return t("notChecked");
}
