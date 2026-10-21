import type {
  ApiErrorBody,
  ConversationApi,
  ConversationMessage,
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
};

async function request(path: string, init?: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json; charset=utf-8" } : {}),
      },
    });
  } catch (error) {
    if (error instanceof TypeError) throw new DisconnectError();
    throw error;
  }

  const text = await response.text();
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
