import type {
  ApiErrorBody,
  AuthResult,
  AuthUser,
  ConversationApi,
  ConversationMessage,
  ConversationSummary,
  TaskSnapshot,
  TaskStatus,
} from "../types/api";

const ID = /^[0-9a-f]{32}$/;
const STATUSES = new Set<TaskStatus>(["pending", "running", "succeeded", "failed"]);

export class ApiRequestError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  readonly status: number;

  constructor(code: string, message: string, retryable: boolean, status: number) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
    this.retryable = retryable;
    this.status = status;
  }
}

export class DisconnectError extends Error {
  constructor() {
    super("暂时连不上本机服务，可以稍后再试。");
    this.name = "DisconnectError";
  }
}

export const httpApi: ConversationApi = {
  createConversation: async () => {
    const body = await request("/api/conversations", { method: "POST" });
    return { conversation_id: readId(body, "conversation_id") };
  },
  sendMessage: async (conversationId, content) => {
    const body = await request(`/api/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content }),
    });
    return {
      conversation_id: readId(body, "conversation_id"),
      task_id: readId(body, "task_id"),
      status: "pending",
    };
  },
  getConversation: async (conversationId) => {
    const body = await request(`/api/conversations/${conversationId}`);
    return {
      conversation_id: readId(body, "conversation_id"),
      messages: readMessages(body),
    };
  },
  getTask: async (taskId) => readTask(await request(`/api/tasks/${taskId}`)),
  // 生产后端暂未实现审批端点，stub：直接返回，不抛错，让 UI 能在预览模式下正常工作
  approveCall: async () => {},
  rejectCall: async () => {},
};

export type LlmPublic = {
  base_url: string;
  model: string;
  has_api_key: boolean;
};

export type LlmSources = {
  environment: LlmPublic;
  dotenv: LlmPublic;
};

export type ProbeRequest =
  | { source: "local" }
  | { source: "dotenv"; base_url?: string; model?: string; api_key?: string };

const EMPTY_LLM: LlmPublic = { base_url: "", model: "", has_api_key: false };

export async function loadLlmSources(signal?: AbortSignal): Promise<LlmSources> {
  const payload = await request("/api/llm/config", { signal });
  if (!payload || typeof payload !== "object") return { environment: EMPTY_LLM, dotenv: EMPTY_LLM };
  const record = payload as { environment?: unknown; dotenv?: unknown };
  return {
    environment: readPublicLlm(record.environment),
    dotenv: readPublicLlm(record.dotenv),
  };
}

export async function probeLlm(body: ProbeRequest, signal?: AbortSignal): Promise<{ reachable: boolean }> {
  const payload = await request("/api/llm/probe", {
    method: "POST",
    body: JSON.stringify(body),
    signal,
  });
  if (!payload || typeof payload !== "object" || typeof (payload as { reachable?: unknown }).reachable !== "boolean") {
    throw new ApiRequestError("internal", "系统出错了，可以再发一次。", true, 200);
  }
  return { reachable: (payload as { reachable: boolean }).reachable };
}

function readPublicLlm(value: unknown): LlmPublic {
  if (!value || typeof value !== "object") return EMPTY_LLM;
  const record = value as { base_url?: unknown; model?: unknown; has_api_key?: unknown };
  return {
    base_url: typeof record.base_url === "string" ? record.base_url : "",
    model: typeof record.model === "string" ? record.model : "",
    has_api_key: record.has_api_key === true,
  };
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json; charset=utf-8" } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch (error) {
    if (error instanceof TypeError) throw new DisconnectError();
    throw error;
  }

  const text = await response.text();
  // 5xx 或 Vite proxy 在后端没启动时返回的 500 → 一律视为连接中断，切 preview
  if (response.status >= 500) throw new DisconnectError();
  const body = parseBody(text, response.status);
  if (response.ok) return body;

  const error = readError(body);
  throw new ApiRequestError(
    error?.code ?? "internal",
    error?.message ?? "系统出错了，可以再发一次。",
    error?.retryable ?? true,
    response.status,
  );
}

// ===== auth =====

export async function getCurrentUser(): Promise<AuthUser | null> {
  try {
    const body = await request("/api/auth/me");
    return readAuthUser(body);
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 401) return null;
    throw error;
  }
}

export async function login(username: string, password: string): Promise<AuthResult> {
  const body = await request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  return readAuthResult(body);
}

export async function register(
  username: string,
  password: string,
  displayName?: string,
): Promise<AuthResult> {
  const payload: Record<string, string> = { username, password };
  if (displayName && displayName.trim()) payload.display_name = displayName.trim();
  const body = await request("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return readAuthResult(body);
}

/** 用记住此设备的令牌换新会话。成功后旧令牌作废，响应里是新令牌。 */
export async function resume(rememberToken: string): Promise<AuthResult> {
  const body = await request("/api/auth/resume", {
    method: "POST",
    body: JSON.stringify({ remember_token: rememberToken }),
  });
  return readAuthResult(body);
}

export async function logout(): Promise<void> {
  try {
    await request("/api/auth/logout", { method: "POST" });
  } catch (error) {
    // 已登录用户的正常退出：后端会先删掉会话行、清 Cookie，再返回 204。
    // 401 也是合法返回（未登录调用 logout），此时 Cookie 已清掉，前端照样回到登录画面。
    if (!(error instanceof ApiRequestError) || error.status !== 401) throw error;
  }
}

export async function listConversations(): Promise<ConversationSummary[]> {
  const body = await request("/api/conversations");
  const record = recordOf(body) as { conversations?: unknown };
  if (!Array.isArray(record.conversations)) return [];
  return record.conversations
    .map((c) => {
      const r = recordOf(c) as Record<string, unknown>;
      return {
        conversation_id: typeof r.conversation_id === "string" && ID.test(r.conversation_id) ? r.conversation_id : "",
        title: typeof r.title === "string" ? r.title : "新对话",
        created_at: typeof r.created_at === "string" ? r.created_at : "",
      };
    })
    .filter((c) => c.conversation_id.length > 0);
}

function readAuthResult(body: unknown): AuthResult {
  const user = readAuthUser(body);
  const token = recordOf(body).remember_token;
  return {
    user,
    remember_token: typeof token === "string" && token.length > 0 ? token : null,
  };
}

function readAuthUser(body: unknown): AuthUser {
  const r = recordOf(body);
  if (
    typeof r.username !== "string" ||
    typeof r.display_name !== "string" ||
    typeof r.user_id !== "string" ||
    !ID.test(r.user_id)
  ) {
    throw new ApiRequestError("internal", "系统出错了，可以再发一次。", true, 200);
  }
  return {
    user_id: r.user_id,
    username: r.username,
    display_name: r.display_name,
  };
}

function parseBody(text: string, status: number): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    if (status >= 500) throw new DisconnectError();
    throw error;
  }
}

function readError(body: unknown): ApiErrorBody | null {
  if (!body || typeof body !== "object" || !("error" in body)) return null;
  const error = (body as { error: unknown }).error;
  if (!error || typeof error !== "object") return null;
  const record = error as Record<string, unknown>;
  if (typeof record.message !== "string" || record.message.trim().length === 0) return null;
  return {
    code: typeof record.code === "string" ? record.code : "internal",
    message: record.message,
    retryable: record.retryable === true,
  };
}

function readId(body: unknown, field: string): string {
  const value = recordOf(body)[field];
  if (typeof value !== "string" || !ID.test(value)) {
    throw new ApiRequestError("internal", "系统出错了，可以再发一次。", true, 200);
  }
  return value;
}

function readMessages(body: unknown): ConversationMessage[] {
  const messages = recordOf(body).messages;
  if (!Array.isArray(messages)) {
    throw new ApiRequestError("internal", "系统出错了，可以再发一次。", true, 200);
  }
  return messages.map(readMessage);
}

function readMessage(value: unknown): ConversationMessage {
  const record = recordOf(value);
  const role = record.role;
  const status = record.status;
  if ((role !== "user" && role !== "assistant") || typeof record.content !== "string" || !isStatus(status)) {
    throw new ApiRequestError("internal", "系统出错了，可以再发一次。", true, 200);
  }
  const error = record.error === undefined ? undefined : readError({ error: record.error }) ?? undefined;
  return {
    task_id: readId(record, "task_id"),
    role,
    content: record.content,
    status,
    created_at: typeof record.created_at === "string" ? record.created_at : "",
    ...(error ? { error } : {}),
  };
}

function readTask(body: unknown): TaskSnapshot {
  const record = recordOf(body);
  const status = record.status;
  if (!isStatus(status)) {
    throw new ApiRequestError("internal", "系统出错了，可以再发一次。", true, 200);
  }
  return {
    task_id: readId(record, "task_id"),
    conversation_id: readId(record, "conversation_id"),
    status,
    step_count: typeof record.step_count === "number" ? record.step_count : 0,
    last_event_type: typeof record.last_event_type === "string" ? record.last_event_type : null,
    reply: typeof record.reply === "string" ? record.reply : null,
    error: record.error ? readError({ error: record.error }) : null,
  };
}

function recordOf(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    throw new ApiRequestError("internal", "系统出错了，可以再发一次。", true, 200);
  }
  return value as Record<string, unknown>;
}

function isStatus(value: unknown): value is TaskStatus {
  return typeof value === "string" && STATUSES.has(value as TaskStatus);
}
