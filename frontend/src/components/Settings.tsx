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

type ProviderId = "local" | "dotenv";

function ApiConfig({
  probe,
  loadSources,
}: {
  probe: (body: ProbeRequest, signal?: AbortSignal) => Promise<{ reachable: boolean }>;
  loadSources: (signal?: AbortSignal) => Promise<LlmSources>;
}) {
  const { t } = useAppearance();
  const [expanded, setExpanded] = useState<ProviderId | null>(null);
  const [sources, setSources] = useState<LlmSources | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [draftSnapshot, setDraftSnapshot] = useState<{ baseUrl: string; model: string; apiKey: string } | null>(
    null,
  );
  const [customOpen, setCustomOpen] = useState(true);
  const [probeBySource, setProbeBySource] = useState<Record<ProviderId, ProbeState>>({
    local: "checking",
    dotenv: "checking",
  });
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    loadSources(controller.signal)
      .then((loadedSources) => {
        if (controller.signal.aborted) return;
        setSources(loadedSources);
        setBaseUrl(loadedSources.dotenv.base_url);
        setModel(loadedSources.dotenv.model);
        setLoaded(true);
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoaded(true);
      });
    return () => controller.abort();
  }, [loadSources]);

  useEffect(() => {
    if (!loaded) return;
    const controller = new AbortController();
    if (!environmentReady(sources?.environment)) {
      setProbeBySource((current) => ({ ...current, local: "unset" }));
      return () => controller.abort();
    }
    setProbeBySource((current) => ({ ...current, local: "checking" }));
    probe({ source: "local" }, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setProbeBySource((current) => ({ ...current, local: result.reachable ? "up" : "down" }));
        }
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setProbeBySource((current) => ({
          ...current,
          local: error instanceof DisconnectError ? "offline" : "down",
        }));
      });
    return () => controller.abort();
  }, [loaded, sources, probe]);

  useEffect(() => {
    if (!loaded) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setProbeBySource((current) => ({ ...current, dotenv: "checking" }));
      probe(
        {
          source: "dotenv",
          base_url: baseUrl.trim(),
          model: model.trim(),
          ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
        },
        controller.signal,
      )
        .then((result) => {
          if (!controller.signal.aborted) {
            setProbeBySource((current) => ({ ...current, dotenv: result.reachable ? "up" : "down" }));
          }
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setProbeBySource((current) => ({
            ...current,
            dotenv: error instanceof DisconnectError ? "offline" : "down",
          }));
        });
    }, 400);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loaded, baseUrl, model, apiKey, probe]);

  useEffect(() => {
    if (toast === null) return;
    const timer = window.setTimeout(() => setToast(null), 2500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const environment = sources?.environment;
  const providers: { id: ProviderId; name: string }[] = [
    { id: "local", name: t("localEnv") },
    { id: "dotenv", name: t("customEnv") },
  ];

  function toggle(id: ProviderId) {
    if (expanded === id) {
      setExpanded(null);
      return;
    }
    if (id === "dotenv") {
      setDraftSnapshot({ baseUrl, model, apiKey });
    }
    setCustomOpen(true);
    setExpanded(id);
  }

  function cancelEdit() {
    if (expanded === "dotenv" && draftSnapshot) {
      setBaseUrl(draftSnapshot.baseUrl);
      setModel(draftSnapshot.model);
      setApiKey(draftSnapshot.apiKey);
    }
    setExpanded(null);
  }

  function saveEdit() {
    setToast(t("unavailable"));
    setExpanded(null);
  }

  function renderEditor(id: ProviderId) {
    const dotenv = id === "dotenv";
    const shownUrl = dotenv ? baseUrl : environment?.base_url ?? "";
    const shownModel = dotenv ? model : environment?.model ?? "";
    const hasStoredKey = dotenv ? Boolean(sources?.dotenv.has_api_key) : Boolean(environment?.has_api_key);
    const keyPlaceholder = dotenv
      ? hasStoredKey
        ? t("keyKeep")
        : t("keyEnter")
      : hasStoredKey
        ? t("keyFromEnv")
        : t("keyMissing");
    const showKeyWarn = dotenv ? !hasStoredKey && !apiKey.trim() : !hasStoredKey;
    const sourceTag = dotenv ? "dotenv" : "local";
    const title = dotenv ? t("customEnv") : t("localEnv");
    return (
      <form className="provider-editor" onSubmit={(event) => event.preventDefault()}>
        <div className="provider-editor-panel">
          <p className="provider-editor-title">
            <span className="provider-editor-title-name">{title}</span>
            <span className="provider-editor-title-id">{sourceTag}</span>
          </p>

          <label className="provider-field">
            <span className="provider-field-label">{t("apiKeyLabel")}</span>
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
          {showKeyWarn ? <p className="provider-key-warn">{t("keyWarnMissing")}</p> : null}

          <div className="provider-accordion">
            <button
              type="button"
              className="provider-accordion-trigger"
              aria-expanded={customOpen}
              onClick={() => setCustomOpen((open) => !open)}
            >
              <span aria-hidden="true">{customOpen ? "▾" : "▸"}</span>
              {t("customSettings")}
            </button>
            {customOpen ? (
              <div className="provider-accordion-body">
                <label className="provider-field">
                  <span className="provider-field-label">{t("apiAddress")}</span>
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
                <p className="provider-field-hint">{t("apiAddressHint")}</p>
              </div>
            ) : null}
          </div>

          <div className="provider-catalog">
            <div className="provider-catalog-head">
              <span className="provider-field-label">{t("modelCatalog")}</span>
              <span className="provider-field-hint">{t("modelCatalogHint")}</span>
            </div>
            <div className="provider-model-row">
              <label className="provider-model-input">
                <span className="sr-only">{t("modelName")}</span>
                <input
                  name="model"
                  value={shownModel}
                  placeholder={dotenv ? t("modelMissing") : t("urlMissing")}
                  disabled={!dotenv}
                  autoComplete="off"
                  onChange={(event) => setModel(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="provider-model-remove"
                aria-label={t("removeModel")}
                onClick={() => setToast(t("unavailable"))}
              >
                ⌫
              </button>
            </div>
            <button type="button" className="provider-add-model" onClick={() => setToast(t("unavailable"))}>
              <span aria-hidden="true">+</span>
              {t("addModel")}
            </button>
          </div>

          <div className="provider-editor-actions">
            <button type="button" className="provider-btn ghost" onClick={cancelEdit}>
              {t("cancel")}
            </button>
            <button type="button" className="provider-btn primary" onClick={saveEdit}>
              {t("save")}
            </button>
          </div>
        </div>
      </form>
    );
  }

  return (
    <section className="settings" aria-label={t("connections")}>
      <div className="settings-column">
        <h1>{t("connections")}</h1>
        <p className="settings-lead">{t("apiLead")}</p>
        <div className="provider-list">
          {providers.map((provider) => {
            const open = expanded === provider.id;
            const state = probeBySource[provider.id];
            return (
              <div key={provider.id} className={`provider-item ${open ? "is-open" : ""}`}>
                <div className="provider-summary">
                  <div className="provider-summary-main">
                    <span className="provider-name">{provider.name}</span>
                    <span className="provider-status" data-state={state}>
                      <span className="provider-dot" aria-hidden="true" />
                      <span>{listStatusCopy(state, t)}</span>
                    </span>
                  </div>
                  <button
                    type="button"
                    className="provider-edit"
                    aria-expanded={open}
                    aria-label={`${open ? t("collapse") : t("edit")}${provider.name}`}
                    onClick={() => toggle(provider.id)}
                  >
                    {open ? t("collapse") : t("edit")}
                  </button>
                </div>
                {open ? renderEditor(provider.id) : null}
              </div>
            );
          })}
          <button
            type="button"
            className="provider-add"
            onClick={() => setToast(t("unavailable"))}
          >
            <span aria-hidden="true">+</span>
            {t("addProvider")}
          </button>
        </div>
        <p className="hint api-note">{t("mcpNote")}</p>
        {toast !== null ? (
          <div className="toast-wrap settings-toast" role="status">
            <p className="toast">{toast}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

type ProbeState = "idle" | "checking" | "up" | "down" | "offline" | "unset";

function environmentReady(value: { base_url: string; model: string; has_api_key: boolean } | undefined): boolean {
  return Boolean(value && value.base_url && value.model && value.has_api_key);
}

function listStatusCopy(
  state: ProbeState,
  t: (key: "checking" | "reachable" | "unreachable" | "offlineService" | "unsetShort" | "notChecked") => string,
): string {
  if (state === "checking") return t("checking");
  if (state === "up") return t("reachable");
  if (state === "down") return t("unreachable");
  if (state === "offline") return t("offlineService");
  if (state === "unset") return t("unsetShort");
  return t("notChecked");
}
