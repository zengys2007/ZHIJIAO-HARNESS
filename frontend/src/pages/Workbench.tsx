import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiRequestError,
  DisconnectError,
  httpApi,
  getCurrentUser as httpGetCurrentUser,
  listConversations as httpListConversations,
  login as httpLogin,
  logout as httpLogout,
  probeLlm,
  register as httpRegister,
  loadLlmSources,
  type LlmSources,
  type ProbeRequest,
} from "../api/http";
import { previewApi } from "../api/preview";
import type { SessionSummary } from "../lib/sessions";
import { CONTENT_LIMIT, INVALID_CONTENT_MESSAGE, codePointLength, conversationTitle } from "../lib/text";
import type { ApprovalMode, AuthUser, ConversationApi, ConversationMessage, TaskSnapshot } from "../types/api";
import { ApprovalBar } from "../components/ApprovalBar";
import { AuthForm } from "../components/AuthForm";
import { Composer } from "../components/Composer";
import { PlusMenu, UNAVAILABLE_TOAST } from "../components/PlusMenu";
import { Settings, type SettingsSection } from "../components/Settings";
import { Sidebar } from "../components/Sidebar";
import { Transcript } from "../components/Transcript";

const EMPTY_MESSAGES: ConversationMessage[] = [];

type Props = {
  api?: ConversationApi;
  probe?: (body: ProbeRequest, signal?: AbortSignal) => Promise<{ reachable: boolean }>;
  loadSources?: (signal?: AbortSignal) => Promise<LlmSources>;
  /** 测试注入：获取当前用户。默认走后端 */
  getCurrentUser?: () => Promise<AuthUser | null>;
  /** 测试注入：列出当前用户的会话。默认走后端 */
  listConversationsAuth?: () => Promise<import("../types/api").ConversationSummary[]>;
  /** 测试注入：登录 */
  loginFn?: (username: string, password: string) => Promise<AuthUser>;
  /** 测试注入：注册 */
  registerFn?: (u: string, p: string, d?: string) => Promise<AuthUser>;
  /** 测试注入：退出 */
  logoutFn?: () => Promise<void>;
};

/** 判断错误是否为 unauthenticated（401 / code=unauthenticated） */
function isUnauthenticated(err: unknown): boolean {
  return (
    err instanceof ApiRequestError &&
    (err.status === 401 || err.code === "unauthenticated")
  );
}

export function Workbench({
  api,
  probe = probeLlm,
  loadSources = loadLlmSources,
  getCurrentUser: getCurrentUserImpl = httpGetCurrentUser,
  listConversationsAuth: listConversationsImpl = httpListConversations,
  loginFn = httpLogin,
  registerFn = httpRegister,
  logoutFn = httpLogout,
}: Props) {
  // ===== Auth 状态 =====
  // undefined = 正在确认（首次加载）
  // null = 未登录
  // AuthUser = 已登录
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const authAliveRef = useRef(true);

  // ===== 原有对话状态 =====
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [cache, setCache] = useState<Record<string, ConversationMessage[]>>({});
  const [unsent, setUnsent] = useState<ConversationMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const [view, setView] = useState<"chat" | "settings">("chat");
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("user");
  /** 审批模式：手动 / 自动 */
  const [approvalMode, setApprovalMode] = useState<ApprovalMode>("manual");
  /** 加号菜单未实现项的轻提示 */
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  /** 正在执行审批动作的 taskId 集合，防止重复点击 */
  const [approving, setApproving] = useState<Set<string>>(new Set());
  const busyRef = useRef(false);
  const aliveRef = useRef(true);
  const messages = (activeId ? cache[activeId] : unsent) ?? EMPTY_MESSAGES;
  const authenticated = user !== null && user !== undefined;

  // ===== 初始化 =====
  useEffect(() => {
    authAliveRef.current = true;
    aliveRef.current = true;
    void bootAuth();
    return () => {
      authAliveRef.current = false;
      aliveRef.current = false;
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function bootAuth() {
    try {
      const current = await getCurrentUserImpl();
      if (!authAliveRef.current) return;
      setUser(current);
      if (current) await refreshSessionList();
    } catch (error) {
      if (!authAliveRef.current) return;
      // 网络/5xx：留在 undefined（确认中），不视为未登录
      if (error instanceof ApiRequestError && error.status >= 500) {
        setBanner("系统出错了，可以再发一次。");
        // 仍然将 user 置为 null 让界面有重试入口
        setUser(null);
      } else {
        setUser(null);
      }
    }
  }

  async function refreshSessionList() {
    let list: Awaited<ReturnType<typeof listConversationsImpl>>;
    try {
      list = await listConversationsImpl();
    } catch (err) {
      if (isUnauthenticated(err)) {
        // 后端 session 过期/无效 → 清登录态
        handleUnauthenticated();
        return;
      }
      // 网络/后端挂了：保留 preview fallback，不强制登出
      if (err instanceof DisconnectError) return;
      throw err;
    }
    const next: SessionSummary[] = list.map((c) => ({ id: c.conversation_id, title: c.title }));
    if (!aliveRef.current) return;
    setSessions(next);
  }

  const handleUnauthenticated = useCallback(() => {
    if (!aliveRef.current) return;
    setUser(null);
    setSessions([]);
    setActiveId(null);
    setCache({});
    setUnsent([]);
    setDraft("");
    setBanner(null);
    setPreview(false);
    setView("chat");
  }, []);

  async function doLogin(username: string, password: string) {
    const u = await loginFn(username, password);
    if (!authAliveRef.current) return;
    setUser(u);
    await refreshSessionList();
  }

  async function doRegister(username: string, password: string, displayName?: string) {
    const u = await registerFn(username, password, displayName);
    if (!authAliveRef.current) return;
    setUser(u);
    await refreshSessionList();
  }

  async function doLogout() {
    if (logoutBusy) return;
    setLogoutBusy(true);
    try {
      await logoutFn();
    } finally {
      setLogoutBusy(false);
      handleUnauthenticated();
    }
  }

  // ===== 原有对话逻辑 =====
  const clientRef = useRef<ConversationApi>(api ?? httpApi);
  const [, forceReload] = useState(0);
  // 让 preview fallback 生效
  useEffect(() => {
    clientRef.current = api ?? (preview ? previewApi : httpApi);
    forceReload((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, preview]);

  function showMessages(id: string | null, next: ConversationMessage[]) {
    if (!id) {
      setUnsent(next);
      return;
    }
    setCache((current) => ({ ...current, [id]: next }));
    setUnsent([]);
  }

  function adopt(id: string, content: string, shown: ConversationMessage[]) {
    const entry: SessionSummary = { id, title: conversationTitle(content) };
    setSessions((current) => [entry, ...current.filter((item) => item.id !== id)]);
    setActiveId(id);
    setCache((current) => ({ ...current, [id]: shown }));
    setUnsent([]);
  }

  async function ensureConversation(currentId: string | null, content: string, shown: ConversationMessage[]) {
    if (currentId) return currentId;
    try {
      const created = await clientRef.current.createConversation();
      adopt(created.conversation_id, content, shown);
      return created.conversation_id;
    } catch (error) {
      if (isUnauthenticated(error)) {
        handleUnauthenticated();
        throw error;
      }
      if (api || !(error instanceof DisconnectError)) throw error;
      return usePreview(content, shown);
    }
  }

  async function usePreview(content: string, shown: ConversationMessage[]) {
    clientRef.current = previewApi;
    setPreview(true);
    const created = await previewApi.createConversation();
    adopt(created.conversation_id, content, shown);
    return created.conversation_id;
  }

  /** 刷新当前会话消息，从 API 拉最新版本 */
  async function refreshConversation(conversationId: string) {
    try {
      const response = await clientRef.current.getConversation(conversationId);
      if (!aliveRef.current) return response.messages;
      setCache((current) => ({ ...current, [conversationId]: response.messages }));
      return response.messages;
    } catch (error) {
      if (isUnauthenticated(error)) {
        handleUnauthenticated();
        return null;
      }
      return null;
    }
  }

  async function handleSubmit() {
    if (!authenticated) {
      setBanner("请先登录。");
      return;
    }
    if (busyRef.current) return;
    const content = draft.trim();
    if (codePointLength(content) < 1 || codePointLength(content) > CONTENT_LIMIT) {
      setBanner(INVALID_CONTENT_MESSAGE);
      return;
    }

    busyRef.current = true;
    setSubmitting(true);
    setBanner(null);
    setDraft("");

    const base = messages;
    const shown = [...base, pendingMessage(content)];
    let viewId = activeId;
    showMessages(viewId, shown);

    try {
      viewId = await ensureConversation(viewId, content, shown);
      const client = clientRef.current;
      const accepted = await client.sendMessage(viewId, content);
      const task = await pollTaskUntilAssistant(client, accepted.task_id);
      const conversation = await client.getConversation(viewId);
      if (!aliveRef.current) return;
      showMessages(viewId, applyTask(conversation.messages, task, content));
      // 自动模式：对所有 pending 的 tool_call 批量批准
      if (approvalMode === "auto") {
        const autoCalls = conversation.messages.flatMap((m) =>
          (m.tool_calls ?? []).filter((c) => c.approval_status === "pending").map((c) => ({
            taskId: m.task_id,
            callId: c.call_id,
          })),
        );
        for (const { taskId, callId } of autoCalls) {
          await runApprove(viewId, taskId, callId);
        }
      }
    } catch (error) {
      if (!aliveRef.current) return;
      if (isUnauthenticated(error)) {
        handleUnauthenticated();
        setDraft(content);
        return;
      }
      if (!api && error instanceof DisconnectError) {
        try {
          viewId = await usePreview(content, shown);
          const accepted = await previewApi.sendMessage(viewId, content);
          const task = await pollTaskUntilAssistant(previewApi, accepted.task_id);
          const conversation = await previewApi.getConversation(viewId);
          if (!aliveRef.current) return;
          showMessages(viewId, applyTask(conversation.messages, task, content));
          if (approvalMode === "auto") {
            const autoCalls = conversation.messages.flatMap((m) =>
              (m.tool_calls ?? []).filter((c) => c.approval_status === "pending").map((c) => ({
                taskId: m.task_id,
                callId: c.call_id,
              })),
            );
            for (const { taskId, callId } of autoCalls) {
              await runApprove(viewId, taskId, callId);
            }
          }
          return;
        } catch (previewError) {
          showMessages(viewId, base);
          setDraft(content);
          setBanner(previewError instanceof Error ? previewError.message : "系统出错了，可以再发一次。");
          return;
        }
      }
      showMessages(viewId, base);
      setDraft(content);
      setBanner(error instanceof Error ? error.message : "系统出错了，可以再发一次。");
    } finally {
      busyRef.current = false;
      if (aliveRef.current) setSubmitting(false);
    }
  }

  async function runApprove(conversationId: string, taskId: string, callId: string) {
    if (approving.has(callId)) return;
    setApproving((prev) => new Set(prev).add(callId));
    try {
      await clientRef.current.approveCall(conversationId, taskId, callId);
      if (activeId) await refreshConversation(activeId);
    } catch (error) {
      if (isUnauthenticated(error)) handleUnauthenticated();
    } finally {
      setApproving((prev) => {
        const next = new Set(prev);
        next.delete(callId);
        return next;
      });
    }
  }

  async function runReject(conversationId: string, taskId: string, callId: string) {
    if (approving.has(callId)) return;
    setApproving((prev) => new Set(prev).add(callId));
    try {
      await clientRef.current.rejectCall(conversationId, taskId, callId);
      if (activeId) await refreshConversation(activeId);
    } catch (error) {
      if (isUnauthenticated(error)) handleUnauthenticated();
    } finally {
      setApproving((prev) => {
        const next = new Set(prev);
        next.delete(callId);
        return next;
      });
    }
  }

  /** 显示自动消散的轻提示（加号菜单未实现项） */
  function showToast(message: string) {
    setToast(message);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2500);
  }

  function handleNew() {
    if (busyRef.current) return;
    setView("chat");
    setActiveId(null);
    setUnsent([]);
    setDraft("");
    setBanner(null);
  }

  function handleSelect(id: string) {
    setView("chat");
    if (busyRef.current || id === activeId) return;
    setBanner(null);
    setActiveId(id);
    if (cache[id]) return;
    void clientRef.current
      .getConversation(id)
      .then((conversation) => {
        if (!aliveRef.current) return;
        setCache((current) => ({ ...current, [id]: conversation.messages }));
      })
      .catch((error: unknown) => {
        if (!aliveRef.current) return;
        if (isUnauthenticated(error)) {
          handleUnauthenticated();
          return;
        }
        setBanner(error instanceof Error ? error.message : "系统出错了，可以再发一次。");
        setCache((current) => ({ ...current, [id]: current[id] ?? [] }));
      });
  }

  const pendingCount = useMemo(
    () =>
      messages.reduce(
        (sum, m) =>
          sum + (m.tool_calls ?? []).filter((c) => c.approval_status === "pending").length,
        0,
      ),
    [messages],
  );

  // ===== 渲染 =====
  return (
    <div className="app">
      <Sidebar
        sessions={sessions}
        activeId={activeId}
        busy={submitting}
        preview={preview}
        settingsOpen={view === "settings"}
        settingsSection={settingsSection}
        onSettingsSection={setSettingsSection}
        onNew={handleNew}
        onSelect={handleSelect}
        onOpenSettings={() => setView("settings")}
        onCloseSettings={() => setView("chat")}
        onLogout={() => {
          void doLogout();
        }}
        user={user}
      />
      <main className="main">
        {view === "settings" ? (
          authenticated ? (
            <Settings
              section={settingsSection}
              probe={probe}
              loadSources={loadSources}
              authenticated
              user={user!}
            />
          ) : (
            <Settings section={settingsSection} probe={probe} loadSources={loadSources} authenticated={false} />
          )
        ) : user === undefined ? (
          <AuthLoading />
        ) : user === null ? (
          <AuthForm onLogin={doLogin} onRegister={doRegister} />
        ) : (
          <>
            <Transcript
              messages={messages}
              loading={activeId !== null && cache[activeId] === undefined}
              onApprove={(taskId, callId) => {
                if (!activeId) return;
                void runApprove(activeId, taskId, callId);
              }}
              onReject={(taskId, callId) => {
                if (!activeId) return;
                void runReject(activeId, taskId, callId);
              }}
            />
            <Composer
              value={draft}
              busy={submitting}
              alert={banner}
              onChange={setDraft}
              onSubmit={() => {
                void handleSubmit();
              }}
              leadingSlot={
                <PlusMenu
                  approvalMode={approvalMode}
                  onApprovalModeChange={setApprovalMode}
                  onUnavailable={() => showToast(UNAVAILABLE_TOAST)}
                />
              }
              approvalSegment={
                <ApprovalBar
                  mode={approvalMode}
                  onChange={setApprovalMode}
                  pendingCount={pendingCount}
                />
              }
            />
            {toast !== null ? (
              <div className="toast-wrap" role="status">
                <p className="toast">{toast}</p>
              </div>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}

function AuthLoading() {
  return (
    <div className="auth-wrap auth-loading" role="status" aria-live="polite">
      <p className="auth-pending">正在确认登录…</p>
    </div>
  );
}

/** 轮询直到拿到非 pending 的终态（succeeded/failed），或拿到带 tool_calls 的 running 状态 */
async function pollTaskUntilAssistant(
  api: Pick<ConversationApi, "getTask">,
  taskId: string,
): Promise<TaskSnapshot> {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const task = await api.getTask(taskId);
    if (task.status === "succeeded" || task.status === "failed") return task;
    // running 但 last_event_type 变成了 tool_call_proposed，说明 assistant 已回复
    if (task.status === "running" && task.last_event_type === "tool_call_proposed") return task;
    await wait(1000);
  }
  throw new Error("这次处理被中断了，可以再发一次。");
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function pendingMessage(content: string): ConversationMessage {
  return {
    task_id: `local-${crypto.randomUUID()}`,
    role: "user",
    content,
    status: "pending",
    created_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
}

function applyTask(messages: ConversationMessage[], task: TaskSnapshot, content: string): ConversationMessage[] {
  const hasUser = messages.some((message) => message.task_id === task.task_id && message.role === "user");
  const next = hasUser
    ? messages.map((message) => {
        if (message.task_id !== task.task_id || message.role !== "user") return message;
        return {
          ...message,
          status: task.status,
          ...(task.error ? { error: task.error } : {}),
        };
      })
    : [
        ...messages,
        {
          task_id: task.task_id,
          role: "user" as const,
          content,
          status: task.status,
          created_at: "",
          ...(task.error ? { error: task.error } : {}),
        },
      ];
  // 如果已经有 assistant 消息（可能带 tool_calls），不再追加新的空壳
  if (next.some((message) => message.task_id === task.task_id && message.role === "assistant")) {
    return next;
  }
  if (task.status === "succeeded" && task.reply) {
    return [
      ...next,
      {
        task_id: task.task_id,
        role: "assistant",
        content: task.reply,
        status: "succeeded",
        created_at: "",
      },
    ];
  }
  return next;
}
