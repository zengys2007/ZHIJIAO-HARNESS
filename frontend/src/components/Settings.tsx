import { useEffect, useState } from "react";
import { DisconnectError, loadLlmSources, probeLlm, type LlmSources, type ProbeRequest } from "../api/http";

export type SettingsSection = "user" | "appearance" | "connections";

const pages: Record<Exclude<SettingsSection, "connections">, { title: string; body: string }> = {
  user: { title: "用户设置", body: "当前未登录。" },
  appearance: { title: "外观", body: "当前是浅色工作台。" },
};

export function Settings({
  section,
  probe = probeLlm,
  loadSources = loadLlmSources,
}: {
  section: SettingsSection;
  probe?: (body: ProbeRequest, signal?: AbortSignal) => Promise<{ reachable: boolean }>;
  loadSources?: (signal?: AbortSignal) => Promise<LlmSources>;
}) {
  if (section === "connections") return <ApiConfig probe={probe} loadSources={loadSources} />;
  const page = pages[section];
  return (
    <section className="settings" aria-label={page.title}>
      <div className="settings-column">
        <h1>{page.title}</h1>
        <p>{page.body}</p>
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
      ? "留空则使用 .env 里的密钥"
      : "填写密钥"
    : environment?.has_api_key
      ? "来自环境变量"
      : "未设置环境变量";

  return (
    <section className="settings" aria-label="API/MCPs配置">
      <div className="settings-column">
        <h1>API/MCPs配置</h1>
        <p className="settings-lead">本机环境读取环境变量。自行填写读取 .env，留空的密钥仍用文件里的那一份。</p>
        <form className="api-form" onSubmit={(event) => event.preventDefault()}>
          <div className="segment" role="radiogroup" aria-label="接口来源">
            <label className={source === "local" ? "is-selected" : undefined}>
              <input
                type="radio"
                name="api-source"
                value="local"
                checked={source === "local"}
                onChange={() => setSource("local")}
              />
              本机环境
            </label>
            <label className={source === "dotenv" ? "is-selected" : undefined}>
              <input
                type="radio"
                name="api-source"
                value="dotenv"
                checked={source === "dotenv"}
                onChange={() => setSource("dotenv")}
              />
              自行填写
            </label>
          </div>
          <div className="api-card">
            <label className="api-row">
              <span>服务地址</span>
              <input
                name="base-url"
                type="url"
                value={shownUrl}
                placeholder={dotenv ? "http://127.0.0.1:9" : "未设置环境变量"}
                disabled={!dotenv}
                autoComplete="off"
                onChange={(event) => setBaseUrl(event.target.value)}
              />
            </label>
            <label className="api-row">
              <span>模型</span>
              <input
                name="model"
                value={shownModel}
                placeholder={dotenv ? "模型名称" : "未设置环境变量"}
                disabled={!dotenv}
                autoComplete="off"
                onChange={(event) => setModel(event.target.value)}
              />
            </label>
            <label className="api-row">
              <span>密钥</span>
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
              <span>联通</span>
              <div className="probe-status">
                <span className="lamp" data-state={probeState} aria-hidden="true" />
                <p className="probe-label" role="status">
                  {probeCopy(probeState)}
                </p>
              </div>
            </div>
          </div>
        </form>
        <p className="hint api-note">MCP 还没有接入。页面不显示密钥。</p>
      </div>
    </section>
  );
}

type ProbeState = "idle" | "checking" | "up" | "down" | "offline" | "unset";

function environmentReady(value: { base_url: string; model: string; has_api_key: boolean } | undefined): boolean {
  return Boolean(value && value.base_url && value.model && value.has_api_key);
}

function probeCopy(state: ProbeState): string {
  if (state === "checking") return "正在检测";
  if (state === "up") return "已联通";
  if (state === "down") return "连不上这个模型服务。";
  if (state === "offline") return "暂时连不上本机服务。";
  if (state === "unset") return "未配置环境变量";
  return "未检测";
}
