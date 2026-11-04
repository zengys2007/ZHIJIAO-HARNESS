import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { DisconnectError, loadLlmSources, probeLlm, type LlmSources, type ProbeRequest } from "../api/http";
import { FONT_MAX, FONT_MIN, useAppearance, type ThemeChoice } from "../lib/appearance";
import {
  customProviderReady,
  loadCustomProviders,
  newProviderId,
  primaryModelName,
  saveCustomProviders,
  type CustomProvider,
  type ProviderModel,
} from "../lib/providers";
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

type ExpandedId = "local" | string;

type EditorDraft = {
  name: string;
  baseUrl: string;
  apiKey: string;
  models: ProviderModel[];
};

function ApiConfig({
  probe,
  loadSources,
}: {
  probe: (body: ProbeRequest, signal?: AbortSignal) => Promise<{ reachable: boolean }>;
  loadSources: (signal?: AbortSignal) => Promise<LlmSources>;
}) {
  const { t } = useAppearance();
  const [expanded, setExpanded] = useState<ExpandedId | null>(null);
  const [sources, setSources] = useState<LlmSources | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [customs, setCustoms] = useState<CustomProvider[]>(() => loadCustomProviders());
  const [draft, setDraft] = useState<EditorDraft | null>(null);
  const [draftSnapshot, setDraftSnapshot] = useState<EditorDraft | null>(null);
  const [customOpen, setCustomOpen] = useState(false);
  const [localProbe, setLocalProbe] = useState<ProbeState>("checking");
  const [adding, setAdding] = useState(false);
  const [addName, setAddName] = useState("");
  const [addUrl, setAddUrl] = useState("");
  const [addModel, setAddModel] = useState("");
  const [addKey, setAddKey] = useState("");
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    loadSources(controller.signal)
      .then((loadedSources) => {
        if (controller.signal.aborted) return;
        setSources(loadedSources);
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
      setLocalProbe("unset");
      return () => controller.abort();
    }
    setLocalProbe("checking");
    probe({ source: "local" }, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setLocalProbe(result.reachable ? "up" : "down");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setLocalProbe(error instanceof DisconnectError ? "offline" : "down");
      });
    return () => controller.abort();
  }, [loaded, sources, probe]);

  useEffect(() => {
    if (toast === null) return;
    const timer = window.setTimeout(() => setToast(null), 2500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const environment = sources?.environment;

  function persistCustoms(next: CustomProvider[]) {
    setCustoms(next);
    saveCustomProviders(next);
  }

  function openLocal() {
    if (expanded === "local") {
      setExpanded(null);
      setDraft(null);
      return;
    }
    setDraft(null);
    setDraftSnapshot(null);
    setCustomOpen(false);
    setExpanded("local");
  }

  function openCustom(provider: CustomProvider) {
    if (expanded === provider.id) {
      setExpanded(null);
      setDraft(null);
      return;
    }
    const models =
      provider.models.length > 0
        ? provider.models.map((item) => ({ ...item }))
        : provider.model
          ? [{ alias: provider.model, label: provider.model }]
          : [];
    const next: EditorDraft = {
      name: provider.name,
      baseUrl: provider.base_url,
      apiKey: provider.api_key,
      models,
    };
    setDraft(next);
    setDraftSnapshot({
      ...next,
      models: models.map((item) => ({ ...item })),
    });
    setCustomOpen(false);
    setExpanded(provider.id);
  }

  function cancelEdit() {
    if (expanded && expanded !== "local" && draftSnapshot) {
      setDraft(draftSnapshot);
    }
    setExpanded(null);
    setDraft(null);
  }

  function saveEdit() {
    if (expanded === "local" || expanded === null) {
      setToast(t("unavailable"));
      setExpanded(null);
      setDraft(null);
      return;
    }
    if (!draft || !draft.name.trim()) {
      setToast(t("providerNameMissing"));
      return;
    }
    const models = draft.models
      .map((item) => ({ alias: item.alias.trim(), label: item.label.trim() }))
      .filter((item) => item.alias || item.label);
    const next = customs.map((item) =>
      item.id === expanded
        ? {
            ...item,
            name: draft.name.trim(),
            base_url: draft.baseUrl.trim(),
            model: primaryModelName(models),
            api_key: draft.apiKey,
            models,
          }
        : item,
    );
    persistCustoms(next);
    setExpanded(null);
    setDraft(null);
  }

  function removeCustom(id: string) {
    persistCustoms(customs.filter((item) => item.id !== id));
    if (expanded === id) {
      setExpanded(null);
      setDraft(null);
    }
  }

  function submitAdd(event: FormEvent) {
    event.preventDefault();
    const name = addName.trim();
    if (!name) return;
    const modelName = addModel.trim();
    const models = modelName ? [{ alias: modelName, label: modelName }] : [];
    const created: CustomProvider = {
      id: newProviderId(),
      name,
      base_url: addUrl.trim(),
      model: modelName,
      api_key: addKey,
      models,
    };
    persistCustoms([...customs, created]);
    setAdding(false);
    setAddName("");
    setAddUrl("");
    setAddModel("");
    setAddKey("");
  }

  function customStatus(provider: CustomProvider): ProbeState {
    return customProviderReady(provider) ? "idle" : "unset";
  }

  function updateModelRow(index: number, patch: Partial<ProviderModel>) {
    setDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        models: current.models.map((item, i) => (i === index ? { ...item, ...patch } : item)),
      };
    });
  }

  function renderEditor(kind: "local" | "custom") {
    const editable = kind === "custom";
    const title = kind === "local" ? t("localEnv") : draft?.name || t("customEnv");
    const sourceTag = kind === "local" ? "local" : "custom";
    const shownUrl = kind === "local" ? environment?.base_url ?? "" : draft?.baseUrl ?? "";
    const shownKey = kind === "local" ? "" : draft?.apiKey ?? "";
    const hasStoredKey = kind === "local" ? Boolean(environment?.has_api_key) : Boolean(draft?.apiKey.trim());
    const keyPlaceholder =
      kind === "local"
        ? hasStoredKey
          ? t("keyFromEnv")
          : t("keyLeaveBlank")
        : t("keyLeaveBlank");
    const showKeyWarn = kind === "local" ? !hasStoredKey : !hasStoredKey;
    const modelRows: ProviderModel[] =
      kind === "local"
        ? environment?.model
          ? [{ alias: environment.model, label: environment.model }]
          : []
        : draft?.models ?? [];
    return (
      <form className="provider-editor" onSubmit={(event) => event.preventDefault()}>
        <div className="provider-editor-panel">
          <p className="provider-editor-title">
            {editable ? (
              <label className="provider-editor-title-edit">
                <span className="sr-only">{t("providerName")}</span>
                <input
                  value={draft?.name ?? ""}
                  onChange={(event) =>
                    setDraft((current) => (current ? { ...current, name: event.target.value } : current))
                  }
                  autoComplete="off"
                />
              </label>
            ) : (
              <span className="provider-editor-title-name">{title}</span>
            )}
            <span className="provider-editor-title-id">{sourceTag}</span>
          </p>

          <label className="provider-field">
            <span className="provider-field-label">{t("apiKeyLabel")}</span>
            <input
              name="api-key"
              type="password"
              value={shownKey}
              placeholder={keyPlaceholder}
              disabled={!editable}
              autoComplete="off"
              onChange={(event) =>
                setDraft((current) => (current ? { ...current, apiKey: event.target.value } : current))
              }
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
                    placeholder={editable ? "https://api.example.com/v1" : t("urlMissing")}
                    disabled={!editable}
                    autoComplete="off"
                    onChange={(event) =>
                      setDraft((current) => (current ? { ...current, baseUrl: event.target.value } : current))
                    }
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
            {modelRows.map((row, index) => (
              <div key={`model-${index}`} className="provider-model-row">
                <label className="provider-model-input">
                  <span className="sr-only">{t("modelAlias")}</span>
                  <input
                    value={row.alias}
                    placeholder={t("modelAlias")}
                    disabled={!editable}
                    autoComplete="off"
                    onChange={(event) => updateModelRow(index, { alias: event.target.value })}
                  />
                </label>
                <span className="provider-model-arrow" aria-hidden>
                  →
                </span>
                <label className="provider-model-input">
                  <span className="sr-only">{t("modelLabel")}</span>
                  <input
                    value={row.label}
                    placeholder={t("modelLabel")}
                    disabled={!editable}
                    autoComplete="off"
                    onChange={(event) => updateModelRow(index, { label: event.target.value })}
                  />
                </label>
                <button
                  type="button"
                  className="provider-model-remove"
                  aria-label={t("removeModel")}
                  disabled={!editable}
                  onClick={() => {
                    if (!editable) return;
                    setDraft((current) =>
                      current
                        ? { ...current, models: current.models.filter((_, i) => i !== index) }
                        : current,
                    );
                  }}
                >
                  ⌫
                </button>
              </div>
            ))}
            {kind === "local" ? (
              <p className="provider-field-hint">嵌入模型 {environment?.embedding_model ?? ""}</p>
            ) : null}
            <button
              type="button"
              className="provider-add-model"
              disabled={!editable}
              onClick={() => {
                if (!editable) return;
                setDraft((current) =>
                  current ? { ...current, models: [...current.models, { alias: "", label: "" }] } : current,
                );
              }}
            >
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
          <div className={`provider-item ${expanded === "local" ? "is-open" : ""}`}>
            <div className="provider-summary">
              <div className="provider-summary-main">
                <span className="provider-name">{t("localEnv")}</span>
                <span className="provider-status" data-state={localProbe}>
                  <span className="provider-dot" aria-hidden="true" />
                  <span>{listStatusCopy(localProbe, t)}</span>
                </span>
              </div>
              <button
                type="button"
                className="provider-edit"
                aria-expanded={expanded === "local"}
                aria-label={`${expanded === "local" ? t("collapse") : t("edit")}${t("localEnv")}`}
                onClick={openLocal}
              >
                {expanded === "local" ? t("collapse") : t("edit")}
              </button>
            </div>
            {expanded === "local" ? renderEditor("local") : null}
          </div>

          {customs.map((provider) => {
            const open = expanded === provider.id;
            const state = customStatus(provider);
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
                  <div className="provider-summary-actions">
                    <button
                      type="button"
                      className="provider-edit"
                      aria-expanded={open}
                      aria-label={`${open ? t("collapse") : t("edit")}${provider.name}`}
                      onClick={() => openCustom(provider)}
                    >
                      {open ? t("collapse") : t("edit")}
                    </button>
                    <button
                      type="button"
                      className="provider-delete"
                      aria-label={`${t("deleteProvider")}${provider.name}`}
                      onClick={() => removeCustom(provider.id)}
                    >
                      {t("deleteProvider")}
                    </button>
                  </div>
                </div>
                {open ? renderEditor("custom") : null}
              </div>
            );
          })}

          {adding ? (
            <form className="provider-add-form" onSubmit={submitAdd}>
              <h2 className="provider-add-heading">{t("addProviderTitle")}</h2>
              <label className="provider-field">
                <span className="provider-field-label">{t("providerName")}</span>
                <input
                  value={addName}
                  placeholder={t("providerNameMissing")}
                  autoComplete="off"
                  required
                  onChange={(event) => setAddName(event.target.value)}
                />
              </label>
              <label className="provider-field">
                <span className="provider-field-label">{t("apiAddress")}</span>
                <input
                  value={addUrl}
                  placeholder="https://api.example.com/v1"
                  autoComplete="off"
                  onChange={(event) => setAddUrl(event.target.value)}
                />
              </label>
              <label className="provider-field">
                <span className="provider-field-label">{t("modelName")}</span>
                <input
                  value={addModel}
                  placeholder={t("modelMissing")}
                  autoComplete="off"
                  onChange={(event) => setAddModel(event.target.value)}
                />
              </label>
              <label className="provider-field">
                <span className="provider-field-label">{t("apiKeyLabel")}</span>
                <input
                  type="password"
                  value={addKey}
                  placeholder={t("keyEnter")}
                  autoComplete="off"
                  onChange={(event) => setAddKey(event.target.value)}
                />
              </label>
              <div className="provider-editor-actions">
                <button
                  type="button"
                  className="provider-btn ghost"
                  onClick={() => {
                    setAdding(false);
                    setAddName("");
                    setAddUrl("");
                    setAddModel("");
                    setAddKey("");
                  }}
                >
                  {t("cancel")}
                </button>
                <button type="submit" className="provider-btn primary" disabled={!addName.trim()}>
                  {t("confirmAdd")}
                </button>
              </div>
            </form>
          ) : (
            <button type="button" className="provider-add" onClick={() => setAdding(true)}>
              <span aria-hidden="true">+</span>
              {t("addProvider")}
            </button>
          )}
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
