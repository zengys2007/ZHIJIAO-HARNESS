import type {
  ApiErrorBody,
  AuthResult,
  AuthUser,
  ConversationApi,
  ConversationMessage,
  ConversationSummary,
  TaskSnapshot,
  TaskStatus,
  TeachingApi,
  TeachingInsights,
  TeachingOverview,
} from "../types/api";

export const ID = /^[0-9a-f]{32}$/;
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

export async function request(path: string, init?: RequestInit): Promise<unknown> {
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

// ===== 教学上下文 =====

export const teachingApi: TeachingApi = {
  loadOverview: async () => readOverview(await request("/api/teaching/overview")),
  loadInsights: async () => readInsights(await request("/api/teaching/insights")),
  createClass: async (name, students) => {
    const body = await request("/api/teaching/classes", {
      method: "POST",
      body: JSON.stringify({ name, students }),
    });
    return { class_id: readId(body, "class_id") };
  },
  createPoint: async (name, description, prerequisites) => {
    const body = await request("/api/teaching/points", {
      method: "POST",
      body: JSON.stringify({ name, description, prerequisites }),
    });
    return { point_id: readId(body, "point_id") };
  },
  createAssignment: async (classId, title, kind, records) => {
    const body = await request("/api/teaching/assignments", {
      method: "POST",
      body: JSON.stringify({ class_id: classId, title, kind, records }),
    });
    return { assignment_id: readId(body, "assignment_id") };
  },
  createDocument: async (docType, title, content) => {
    const body = await request("/api/teaching/documents", {
      method: "POST",
      body: JSON.stringify({ doc_type: docType, title, content }),
    });
    return { document_id: readId(body, "document_id") };
  },
};

function readOverview(body: unknown): TeachingOverview {
  const record = recordOf(body);
  return {
    classes: readList(record.classes, (r) => ({
      class_id: readId(r, "class_id"),
      name: readText(r.name),
      created_at: readText(r.created_at),
      students: Array.isArray(r.students) ? r.students.filter((s): s is string => typeof s === "string") : [],
    })),
    knowledge_points: readList(record.knowledge_points, (r) => ({
      point_id: readId(r, "point_id"),
      name: readText(r.name),
      description: readText(r.description),
      prerequisites: Array.isArray(r.prerequisites)
        ? r.prerequisites.filter((p): p is string => typeof p === "string")
        : [],
    })),
    assignments: readList(record.assignments, (r) => ({
      assignment_id: readId(r, "assignment_id"),
      class_id: readId(r, "class_id"),
      title: readText(r.title),
      kind: readText(r.kind),
      created_at: readText(r.created_at),
    })),
    documents: readList(record.documents, (r) => ({
      document_id: readId(r, "document_id"),
      doc_type: readText(r.doc_type),
      title: readText(r.title),
      created_at: readText(r.created_at),
    })),
  };
}

function readInsights(body: unknown): TeachingInsights {
  const record = recordOf(body);
  return {
    classes: readList(record.classes, (r) => {
      const latest = r.latest && typeof r.latest === "object" ? (r.latest as Record<string, unknown>) : null;
      return {
        class_id: readId(r, "class_id"),
        class_name: readText(r.class_name),
        student_count: typeof r.student_count === "number" ? r.student_count : 0,
        recent_assignments: readList(r.recent_assignments, (a) => ({
          id: readId(a, "id"),
          title: readText(a.title),
          kind: readText(a.kind),
          created_at: readText(a.created_at),
        })),
        latest: latest
          ? {
              id: readId(latest, "id"),
              title: readText(latest.title),
              kind: readText(latest.kind),
              created_at: readText(latest.created_at),
            }
          : null,
        knowledge_points: readList(r.knowledge_points, (p) => ({
          name: readText(p.name),
          latest_rate: readRate(p.latest_rate),
          previous_rate: readRate(p.previous_rate),
          recent_rate: readRate(p.recent_rate),
          covered: typeof p.covered === "number" ? p.covered : 0,
        })),
        weak_points: readList(r.weak_points, (w) => ({
          name: readText(w.name),
          rate: readRate(w.rate) ?? 0,
        })),
        students: readList(r.students, (s) => ({
          name: readText(s.name),
          overall_rate: readRate(s.overall_rate),
          by_point:
            s.by_point && typeof s.by_point === "object"
              ? Object.fromEntries(
                  Object.entries(s.by_point as Record<string, unknown>).map(([k, v]) => [k, readRate(v) ?? 0]),
                )
              : {},
          weak: Array.isArray(s.weak) ? s.weak.filter((w): w is string => typeof w === "string") : [],
        })),
      };
    }),
  };
}

function readList<T>(value: unknown, read: (item: Record<string, unknown>) => T): T[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => read(recordOf(item)));
}

function readText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readRate(value: unknown): number | null {
  return typeof value === "number" ? value : null;
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
