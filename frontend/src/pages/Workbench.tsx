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
  resume as httpResume,
  loadLlmSources,
  type LlmSources,
  type ProbeRequest,
} from "../api/http";
import { previewApi } from "../api/preview";
import { loadRememberedAccounts, rememberAccount, type RememberedAccount } from "../lib/accounts";
import { AppearanceProvider, useAppearance } from "../lib/appearance";
import {
  ATTACHMENT_ACCEPT,
  createDraftAttachment,
  isAllowedAttachment,
  renameDraftAttachment,
  revokeDraftAttachment,
  type DraftAttachment,
} from "../lib/attachments";
import type { SessionSummary } from "../lib/sessions";
import { CONTENT_LIMIT, codePointLength, conversationTitle } from "../lib/text";
import type { ApprovalMode, AuthResult, AuthUser, ConversationApi, ConversationMessage, TaskSnapshot } from "../types/api";

const PREVIEW_USER: AuthUser = {
  user_id: "00000000000000000000000000000000",
  username: "preview",
  display_name: "界面预览",
};
import { AccountSwitcher } from "../components/AccountSwitcher";
import { ApprovalBar } from "../components/ApprovalBar";
import { AttachmentBar } from "../components/AttachmentBar";
import { AuthForm } from "../components/AuthForm";
import { Composer } from "../components/Composer";
import { PlusMenu } from "../components/PlusMenu";
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
  /** 测试注入：登录。返回用户，或附带记住此设备的令牌 */
  loginFn?: (username: string, password: string) => Promise<AuthUser | AuthResult>;
  /** 测试注入：注册 */
  registerFn?: (u: string, p: string, d?: string) => Promise<AuthUser | AuthResult>;
  /** 测试注入：用记住的令牌免密恢复 */
  resumeFn?: (rememberToken: string) => Promise<AuthUser | AuthResult>;
  /** 测试注入：退出 */
  logoutFn?: () => Promise<void>;
};

function readSession(value: AuthUser | AuthResult): AuthResult {
  if ("user" in value) return value;
  return { user: value, remember_token: null };
}

/** 判断错误是否为 unauthenticated（401 / code=unauthenticated） */
function isUnauthenticated(err: unknown): boolean {
  return (
    err instanceof ApiRequestError &&
    (err.status === 401 || err.code === "unauthenticated")
  );
}

export function Workbench(props: Props) {
  return (
    <AppearanceProvider>
      <WorkbenchScreen {...props} />
    </AppearanceProvider>
  );
}

function WorkbenchScreen({
  api,
  probe = probeLlm,
  loadSources = loadLlmSources,
  getCurrentUser: getCurrentUserImpl = httpGetCurrentUser,
  listConversationsAuth: listConversationsImpl = httpListConversations,
  loginFn = httpLogin,
  registerFn = httpRegister,
  resumeFn = httpResume,
  logoutFn = httpLogout,
}: Props) {
  const { t } = useAppearance();
  // ===== Auth 状态 =====
  // undefined = 正在确认（首次加载）
  // null = 未登录
  // AuthUser = 已登录
  const [user, setUser] = useState<AuthUser | null | undefined>(undefined);
  const [logoutBusy, setLogoutBusy] = useState(false);
  const authAliveRef = useRef(true);
  /** 未登录时的界面：auth = 常规登录/注册表单，switch = 账号切换面板 */
  const [authScreen, setAuthScreen] = useState<"auth" | "switch">("auth");
  /** 本机登录过的账号（localStorage：用户名、显示名、免密令牌，不存密码） */
  const [remembered, setRemembered] = useState<RememberedAccount[]>([]);

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
  /** 输入区草稿附件（本阶段不上传） */
  const [attachments, setAttachments] = useState<DraftAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const dragDepthRef = useRef(0);
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
      if (current) {
        rememberAccount({ username: current.username, display_name: current.display_name });
        setRemembered(loadRememberedAccounts());
        await refreshSessionList();
      }
    } catch (error) {
      if (!authAliveRef.current) return;
      if (error instanceof DisconnectError) {
        enterOfflinePreview();
        return;
      }
      if (error instanceof ApiRequestError && error.status >= 500) {
        setBanner(t("systemError"));
        setUser(null);
      } else {
        setUser(null);
      }
    }
  }

  function enterOfflinePreview() {
    setPreview(true);
    setUser(PREVIEW_USER);
    setBanner(null);
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

  function adoptSession(session: AuthResult) {
    setUser(session.user);
    rememberAccount({
      username: session.user.username,
      display_name: session.user.display_name,
      token: session.remember_token ?? "",
    });
    setRemembered(loadRememberedAccounts());
    setAuthScreen("auth");
  }

  async function doLogin(username: string, password: string) {
    const session = readSession(await loginFn(username, password));
    if (!authAliveRef.current) return;
    adoptSession(session);
    await refreshSessionList();
  }

  async function doRegister(username: string, password: string, displayName?: string) {
    const session = readSession(await registerFn(username, password, displayName));
    if (!authAliveRef.current) return;
    adoptSession(session);
    await refreshSessionList();
  }

  async function doResume(account: RememberedAccount) {
    try {
      const session = readSession(await resumeFn(account.token));
      if (!authAliveRef.current) return;
      adoptSession(session);
      await refreshSessionList();
    } catch (error) {
      if (isUnauthenticated(error)) {
        rememberAccount({
          username: account.username,
          display_name: account.display_name,
          token: "",
        });
        setRemembered(loadRememberedAccounts());
      }
      throw error;
    }
  }

  async function doLogout() {
    if (preview || logoutBusy) return;
    setLogoutBusy(true);
    try {
      await logoutFn();
    } finally {
      setLogoutBusy(false);
      handleUnauthenticated();
    }
  }

  /** 切换账号：结束当前会话，进入账号切换面板（列出本机登录过的账号和添加新账号） */
  async function doSwitchAccount() {
    if (preview) return;
    setAuthScreen("switch");
    await doLogout();
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
      setBanner(t("signInFirst"));
      return;
    }
    if (busyRef.current) return;
    const content = draft.trim();
    if (codePointLength(content) < 1 || codePointLength(content) > CONTENT_LIMIT) {
      setBanner(t("contentLimit"));
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
          setBanner(previewError instanceof Error ? previewError.message : t("systemError"));
          return;
        }
      }
      showMessages(viewId, base);
      setDraft(content);
      setBanner(error instanceof Error ? error.message : t("systemError"));
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

  function clearAttachments() {
    setAttachments((prev) => {
      for (const item of prev) revokeDraftAttachment(item);
      return [];
    });
  }

  function handleFilesSelected(list: FileList | File[] | null) {
    if (!list || list.length === 0) return;
    const accepted: DraftAttachment[] = [];
    let rejected = false;
    for (const file of Array.from(list)) {
      if (!isAllowedAttachment(file)) {
        rejected = true;
        continue;
      }
      accepted.push(createDraftAttachment(file));
    }
    if (accepted.length > 0) {
      setAttachments((prev) => [...prev, ...accepted]);
    }
    if (rejected) showToast(t("unsupportedFile"));
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function dropEnabled(): boolean {
    return authenticated && !submitting;
  }

  function hasDragFiles(types: readonly string[] | DOMStringList | undefined): boolean {
    if (!types) return false;
    return Array.from(types as ArrayLike<string>).includes("Files");
  }

  function endWorkbenchDrag() {
    dragDepthRef.current = 0;
    setDropActive(false);
  }

  function handleNew() {
    if (busyRef.current) return;
    setView("chat");
    setActiveId(null);
    setUnsent([]);
    setDraft("");
    clearAttachments();
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
        setBanner(error instanceof Error ? error.message : t("systemError"));
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
    <div
      className={`app${dropActive ? " is-drop-target" : ""}`}
      data-testid="workbench-drop"
      onDragEnter={(event) => {
        if (!dropEnabled() || !hasDragFiles(event.dataTransfer.types)) return;
        event.preventDefault();
        dragDepthRef.current += 1;
        setDropActive(true);
      }}
      onDragOver={(event) => {
        if (!dropEnabled() || !hasDragFiles(event.dataTransfer.types)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        if (!dropEnabled()) return;
        event.preventDefault();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (dragDepthRef.current === 0) setDropActive(false);
      }}
      onDrop={(event) => {
        if (!dropEnabled()) return;
        event.preventDefault();
        endWorkbenchDrag();
        if (event.dataTransfer.files?.length) handleFilesSelected(event.dataTransfer.files);
      }}
    >
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
        onSwitchAccount={() => {
          void doSwitchAccount();
        }}
        onLogout={() => {
          // 退出后仍列出本机记住的账号，方便快速重新登录；没有记住的账号时回常规登录表单
          setAuthScreen(remembered.length > 0 ? "switch" : "auth");
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
          authScreen === "switch" ? (
            <AccountSwitcher
              accounts={remembered}
              onLogin={doLogin}
              onResume={doResume}
              onAddAccount={() => setAuthScreen("auth")}
            />
          ) : (
            <AuthForm onLogin={doLogin} onRegister={doRegister} />
          )
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
            <input
              ref={fileInputRef}
              className="sr-only"
              type="file"
              accept={ATTACHMENT_ACCEPT}
              multiple
              aria-label={t("chooseFile")}
              onChange={(event) => handleFilesSelected(event.target.files)}
            />
            <Composer
              value={draft}
              busy={submitting}
              alert={banner}
              onChange={setDraft}
              onSubmit={() => {
                void handleSubmit();
              }}
              attachmentSlot={
                <AttachmentBar
                  items={attachments}
                  onRename={(id, displayName) => {
                    setAttachments((prev) =>
                      prev.map((item) => (item.id === id ? renameDraftAttachment(item, displayName) : item)),
                    );
                  }}
                  onRemove={(id) => {
                    setAttachments((prev) => {
                      const target = prev.find((item) => item.id === id);
                      if (target) revokeDraftAttachment(target);
                      return prev.filter((item) => item.id !== id);
                    });
                  }}
                />
              }
              leadingSlot={
                <PlusMenu
                  approvalMode={approvalMode}
                  onApprovalModeChange={setApprovalMode}
                  onPickFile={() => fileInputRef.current?.click()}
                  onOpenModel={() => {
                    setSettingsSection("connections");
                    setView("settings");
                  }}
                  onUnavailable={() => showToast(t("unavailable"))}
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
  const { t } = useAppearance();
  return (
    <div className="auth-wrap auth-loading" role="status" aria-live="polite">
      <p className="auth-pending">{t("confirmingLogin")}</p>
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
