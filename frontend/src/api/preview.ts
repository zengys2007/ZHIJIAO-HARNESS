import type { ConversationApi, ConversationMessage, TaskSnapshot } from "../types/api";

const PREVIEW_REPLY = "本机服务还没接上。这是界面预览，正式回复会出现在这里。";

type Thread = {
  messages: ConversationMessage[];
  polls: number;
};

export function createPreviewApi(now: () => string = timestamp): ConversationApi {
  const threads = new Map<string, Thread>();

  return {
    async createConversation() {
      const conversationId = randomId();
      threads.set(conversationId, { messages: [], polls: 0 });
      return { conversation_id: conversationId };
    },
    async sendMessage(conversationId, content) {
      const thread = threads.get(conversationId) ?? { messages: [], polls: 0 };
      const taskId = randomId();
      thread.messages.push({
        task_id: taskId,
        role: "user",
        content,
        status: "pending",
        created_at: now(),
      });
      thread.polls = 0;
      threads.set(conversationId, thread);
      return { conversation_id: conversationId, task_id: taskId, status: "pending" };
    },
    async getConversation(conversationId) {
      return {
        conversation_id: conversationId,
        messages: (threads.get(conversationId)?.messages ?? []).map((message) => ({ ...message })),
      };
    },
    async getTask(taskId) {
      const found = findThread(threads, taskId);
      if (!found) {
        return {
          task_id: taskId,
          conversation_id: "0".repeat(32),
          status: "failed",
          step_count: 0,
          last_event_type: null,
          reply: null,
          error: { code: "not_found", message: "没有找到这个会话或任务。", retryable: false },
        };
      }
      found.thread.polls += 1;
      if (found.thread.polls < 2) return snapshot(found, taskId, "running", null);
      const user = found.thread.messages.find((message) => message.task_id === taskId && message.role === "user");
      if (user) user.status = "succeeded";
      if (!found.thread.messages.some((message) => message.task_id === taskId && message.role === "assistant")) {
        found.thread.messages.push({
          task_id: taskId,
          role: "assistant",
          content: PREVIEW_REPLY,
          status: "succeeded",
          created_at: now(),
        });
      }
      return snapshot(found, taskId, "succeeded", PREVIEW_REPLY);
    },
  };
}

export const previewApi = createPreviewApi();

function findThread(threads: Map<string, Thread>, taskId: string): { conversationId: string; thread: Thread } | null {
  for (const [conversationId, thread] of threads) {
    if (thread.messages.some((message) => message.task_id === taskId)) {
      return { conversationId, thread };
    }
  }
  return null;
}

function snapshot(
  found: { conversationId: string },
  taskId: string,
  status: "running" | "succeeded",
  reply: string | null,
): TaskSnapshot {
  return {
    task_id: taskId,
    conversation_id: found.conversationId,
    status,
    step_count: status === "succeeded" ? 1 : 0,
    last_event_type: status === "succeeded" ? "assistant_message" : "user_message",
    reply,
    error: null,
  };
}

function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timestamp(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
}
