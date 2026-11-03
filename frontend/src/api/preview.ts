import { countAskTokens, countMessageList, countPlanTokens } from "../lib/tokens";
import type {
  ConversationApi,
  ConversationMessage,
  TaskSnapshot,
  ToolCallProposed,
  ToolResult,
} from "../types/api";

const PREVIEW_REPLY = "本机服务还没接上。这是界面预览，正式回复会出现在这里。";

/** 可被 preview 注入的 mock 工具池 */
const MOCK_TOOL_POOL: { name: string; description: string; risk: "low" | "medium" | "high" }[] = [
  { name: "random_roll_call", description: "从班级名单里随机点一个人", risk: "low" },
  { name: "class_timer", description: "启动一个倒计时计时器", risk: "low" },
  { name: "class_poll", description: "发起一次课堂投票", risk: "medium" },
  { name: "list_students", description: "读取班级学生名单", risk: "medium" },
  { name: "open_websites", description: "打开外部教学网站", risk: "high" },
];

type Thread = {
  messages: ConversationMessage[];
  ask_mode: boolean;
  plan_mode: boolean;
  plan_status: "off" | "draft" | "approved";
  plan_body: string;
  /** task_id → 这一轮的工具调用提案（可能为空） */
  approvals: Record<string, ApprovalRecord[]>;
};

type ApprovalRecord = {
  call_id: string;
  name: string;
  arguments: Record<string, unknown>;
  risk: "low" | "medium" | "high";
  approval_status: ToolCallProposed["approval_status"];
  approval_note?: string;
  /** 执行成功后的结果 */
  result?: ToolResult;
};

export function createPreviewApi(now: () => string = timestamp): ConversationApi {
  const threads = new Map<string, Thread>();

  function getThread(conversationId: string): Thread | null {
    return threads.get(conversationId) ?? null;
  }

  function findTaskThread(taskId: string): { conversationId: string; thread: Thread } | null {
    for (const [cid, thread] of threads) {
      if (thread.messages.some((m) => m.task_id === taskId)) {
        return { conversationId: cid, thread };
      }
    }
    return null;
  }

  function buildAssistantMessage(
    taskId: string,
    content: string,
    approvals: ApprovalRecord[] | undefined,
  ): ConversationMessage {
    const toolCalls: ToolCallProposed[] = (approvals ?? []).map(
      (a) =>
        ({
          call_id: a.call_id,
          name: a.name,
          arguments: a.arguments,
          risk: a.risk,
          approval_status: a.approval_status,
          approval_note: a.approval_note,
        }) satisfies ToolCallProposed,
    );
    const toolResults: ToolResult[] = (approvals ?? [])
      .filter((a) => a.result)
      .map((a) => a.result as ToolResult);
    return {
      task_id: taskId,
      role: "assistant",
      content,
      status: "succeeded",
      created_at: now(),
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      ...(toolResults.length ? { tool_results: toolResults } : {}),
    };
  }

  function composeReply(userContent: string, withToolCalls: boolean): {
    text: string;
    approvals: ApprovalRecord[];
  } {
    const approvals: ApprovalRecord[] = [];
    if (withToolCalls) {
      const pick = MOCK_TOOL_POOL[Math.floor(Math.random() * MOCK_TOOL_POOL.length)];
      approvals.push({
        call_id: "call-" + randomId().slice(0, 8),
        name: pick.name,
        arguments: mockArguments(pick.name, userContent),
        risk: pick.risk,
        approval_status: "pending",
      });
    }
    const text = withToolCalls
      ? `这是一轮会调用工具的回复：模型提议使用 ${approvals.map((a) => a.name).join("、")}。审批后继续。`
      : PREVIEW_REPLY;
    return { text, approvals };
  }

  return {
    async createConversation() {
      const conversationId = randomId();
      threads.set(conversationId, {
        messages: [],
        approvals: {},
        ask_mode: false,
        plan_mode: false,
        plan_status: "off",
        plan_body: "",
      });
      return { conversation_id: conversationId };
    },
    async sendMessage(conversationId, content, _options) {
      const thread = getThread(conversationId);
      if (!thread) throw new Error("会话不存在");
      const taskId = randomId();
      thread.messages.push({
        task_id: taskId,
        role: "user",
        content,
        status: "pending",
        created_at: now(),
      });
      threads.set(conversationId, thread);
      return { conversation_id: conversationId, task_id: taskId, status: "pending" };
    },
    async getConversation(conversationId) {
      const thread = getThread(conversationId);
      if (!thread) {
        return { conversation_id: conversationId, messages: [] };
      }
      const merged: ConversationMessage[] = [];
      for (const message of thread.messages) {
        if (message.role === "assistant" && message.tool_calls === undefined) {
          // 这是一个尚未被补充的 assistant 消息，尝试补充 approvals
          const approvals = thread.approvals[message.task_id];
          if (approvals) {
            merged.push(buildAssistantMessage(message.task_id, message.content, approvals));
            continue;
          }
        }
        merged.push({ ...message });
      }
      return {
        conversation_id: conversationId,
        messages: merged,
        ask_mode: thread.ask_mode,
        plan_mode: thread.plan_mode,
        plan_status: thread.plan_status,
        plan_body: thread.plan_body,
        context: {
          used_tokens:
            countMessageList(merged.map((message) => message.content)) +
            countAskTokens(thread.ask_mode) +
            countPlanTokens(thread.plan_status, thread.plan_body),
          limit_tokens: 1_000_000,
          limit_source: "fallback" as const,
          output_tokens: 128_000,
          compressed: false,
          parts: [
            { name: "system", tokens: 0 },
            { name: "tools", tokens: 0 },
            { name: "context", tokens: 0 },
            { name: "summary", tokens: 0 },
            { name: "ask", tokens: countAskTokens(thread.ask_mode) },
            { name: "plan", tokens: countPlanTokens(thread.plan_status, thread.plan_body) },
            { name: "conversation", tokens: countMessageList(merged.map((message) => message.content)) },
          ],
        },
      };
    },
    async setAskMode(conversationId, askMode) {
      const thread = getThread(conversationId);
      if (!thread) throw new Error("会话不存在");
      thread.ask_mode = askMode;
      if (askMode) {
        thread.plan_mode = false;
        thread.plan_status = "off";
      }
      threads.set(conversationId, thread);
      return { ...planSnapshot(conversationId, thread), ask_mode: thread.ask_mode };
    },
    async setPlanMode(conversationId, planMode) {
      const thread = getThread(conversationId);
      if (!thread) throw new Error("会话不存在");
      thread.plan_mode = planMode;
      thread.plan_status = planMode ? "draft" : "off";
      if (planMode) thread.ask_mode = false;
      threads.set(conversationId, thread);
      return planSnapshot(conversationId, thread);
    },
    async savePlanBody(conversationId, body) {
      const thread = getThread(conversationId);
      if (!thread) throw new Error("会话不存在");
      if (thread.plan_status !== "draft") throw new Error("先进入计划模式再改计划。");
      thread.plan_body = body.trim();
      threads.set(conversationId, thread);
      return planSnapshot(conversationId, thread);
    },
    async generatePlan(conversationId) {
      const thread = getThread(conversationId);
      if (!thread) throw new Error("会话不存在");
      if (!thread.plan_body.trim()) throw new Error("还没有可确认的计划，先写出计划再生成。");
      if (thread.plan_status !== "draft" && thread.plan_status !== "approved") {
        throw new Error("先进入计划模式再改计划。");
      }
      thread.plan_status = "approved";
      thread.plan_mode = false;
      threads.set(conversationId, thread);
      return planSnapshot(conversationId, thread);
    },
    async getTask(taskId) {
      const found = findTaskThread(taskId);
      if (!found) {
        return {
          task_id: taskId,
          conversation_id: "0".repeat(32),
          status: "failed",
          step_count: 0,
          last_event_type: null,
          reply: null,
          error: { code: "not_found", message: "没有找到这个会话或任务。", retryable: false },
        } satisfies TaskSnapshot;
      }
      const { conversationId, thread } = found;
      const user = thread.messages.find((m) => m.task_id === taskId && m.role === "user");
      const existingAssistant = thread.messages.find(
        (m) => m.task_id === taskId && m.role === "assistant",
      );
      const hasAssistant = existingAssistant !== undefined;
      if (!hasAssistant && user) {
        // 点名、计时、投票这几个词会带出待审批的工具；其余消息只回预览文字
        const keywords = /点名|roll.?call|随机|计时|timer|投票|poll/i;
        const withTools = keywords.test(user.content);
        const { text, approvals: newApprovals } = composeReply(user.content, withTools);
        thread.approvals[taskId] = newApprovals;
        thread.messages.push(buildAssistantMessage(taskId, text, newApprovals));
        if (thread.plan_status === "draft") thread.plan_body = text;
        if (thread.plan_status === "approved") {
          thread.plan_status = "off";
          thread.plan_mode = false;
        }
      }
      const assistant = thread.messages.find((m) => m.task_id === taskId && m.role === "assistant");
      const finalApprovalStatuses = (thread.approvals[taskId] ?? []).map((a) => a.approval_status);
      const hasPending = finalApprovalStatuses.some((s) => s === "pending" || s === "running");
      let status: TaskSnapshot["status"] = "succeeded";
      let reply: string | null = assistant?.content ?? null;
      let stepCount = assistant ? 1 : 0;
      let lastEventType: string | null = assistant ? "assistant_message" : null;
      if (!assistant) {
        status = "running";
        reply = null;
      } else if (hasPending) {
        status = "running";
        reply = null;
        lastEventType = "tool_call_proposed";
      } else if (finalApprovalStatuses.length > 0) {
        stepCount = 1 + finalApprovalStatuses.filter((s) => s === "succeeded" || s === "failed").length;
        lastEventType = "tool_result";
      }
      return {
        task_id: taskId,
        conversation_id: conversationId,
        status,
        step_count: stepCount,
        last_event_type: lastEventType,
        reply,
        error: null,
      } satisfies TaskSnapshot;
    },
    async approveCall(conversationId, taskId, callId) {
      const thread = getThread(conversationId);
      if (!thread) throw new Error("会话不存在");
      const approvals = thread.approvals[taskId];
      if (!approvals) return;
      const target = approvals.find((a) => a.call_id === callId);
      if (!target) return;
      target.approval_status = "approved";
      target.approval_note = "已手动批准，执行中...";
      // 模拟执行耗时
      await new Promise((r) => setTimeout(r, 400));
      target.approval_status = "succeeded";
      target.approval_note = "已执行完成";
      target.result = {
        call_id: callId,
        name: target.name,
        content: mockResult(target.name),
        step_count: 2,
      };
      // 把更新后的 assistant 消息覆盖回 thread.messages
      const idx = thread.messages.findIndex((m) => m.task_id === taskId && m.role === "assistant");
      if (idx >= 0) {
        const orig = thread.messages[idx];
        thread.messages[idx] = buildAssistantMessage(taskId, orig.content, approvals);
      }
      threads.set(conversationId, thread);
    },
    async rejectCall(conversationId, taskId, callId) {
      const thread = getThread(conversationId);
      if (!thread) throw new Error("会话不存在");
      const approvals = thread.approvals[taskId];
      if (!approvals) return;
      const target = approvals.find((a) => a.call_id === callId);
      if (!target) return;
      target.approval_status = "rejected";
      target.approval_note = "已拒绝";
      target.result = {
        call_id: callId,
        name: target.name,
        content: "教师拒绝了此次工具调用。",
        step_count: 2,
      };
      const idx = thread.messages.findIndex((m) => m.task_id === taskId && m.role === "assistant");
      if (idx >= 0) {
        const orig = thread.messages[idx];
        thread.messages[idx] = buildAssistantMessage(taskId, orig.content, approvals);
      }
      threads.set(conversationId, thread);
    },
  };
}

export const previewApi = createPreviewApi();

function planSnapshot(conversationId: string, thread: Thread) {
  return {
    conversation_id: conversationId,
    ask_mode: thread.ask_mode,
    plan_mode: thread.plan_status === "draft",
    plan_status: thread.plan_status,
    plan_body: thread.plan_body,
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

/** 根据工具名生成合理的 mock 参数 */
function mockArguments(toolName: string, userContent: string): Record<string, unknown> {
  switch (toolName) {
    case "random_roll_call":
      return { count: 1, scope: "全班", note: userContent.slice(0, 40) };
    case "class_timer":
      return { duration_seconds: 300, label: "课堂练习" };
    case "class_poll":
      return { question: userContent.slice(0, 30), options: ["同意", "不同意", "弃权"] };
    case "list_students":
      return { group: "全部", include_profile: false };
    case "open_websites":
      return { urls: ["https://example.com/teaching"], new_tab: true };
    default:
      return { hint: userContent.slice(0, 30) };
  }
}

/** 根据工具名生成 mock 返回 */
function mockResult(toolName: string): string {
  switch (toolName) {
    case "random_roll_call":
      return "已随机点到：李明（第 12 排）、王芳（第 3 排）。";
    case "class_timer":
      return "已启动 5 分钟倒计时，结束时将提醒教师。";
    case "class_poll":
      return "投票已发起，当前 32 人参与：同意 21、不同意 8、弃权 3。";
    case "list_students":
      return "读取成功：本班共 45 人，名单已准备好。";
    case "open_websites":
      return "已在新标签页打开教学网站。";
    default:
      return "工具执行完成。";
  }
}
