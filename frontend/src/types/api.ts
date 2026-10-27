export type TaskStatus = "pending" | "running" | "succeeded" | "failed";

export type ApiErrorBody = {
  code: string;
  message: string;
  retryable: boolean;
};

/** 工具调用的风险等级，用于在卡片上打标签 */
export type ToolRisk = "low" | "medium" | "high";

/** assistant 消息里携带、等待审批的工具调用提案 */
export type ToolCallProposed = {
  call_id: string;
  name: string;
  arguments: Record<string, unknown>;
  risk: ToolRisk;
  /** 审批结果：pending 表示等待用户点击，approved/rejected/running/succeeded/failed 表示已处理 */
  approval_status: "pending" | "approved" | "rejected" | "running" | "succeeded" | "failed";
  /** 审批结果的可读摘要，例如 "已自动执行"、"已拒绝"、"参数编辑后已执行" */
  approval_note?: string;
};

/** 工具执行完成后的结果 */
export type ToolResult = {
  call_id: string;
  name: string;
  content: string;
  /** 工具返回时的 step_count，用于与 ToolCallProposed 对齐 */
  step_count: number;
};

/** 审批模式：手动 / 自动。忽略自定义 */
export type ApprovalMode = "manual" | "auto";

export type ConversationMessage = {
  task_id: string;
  role: "user" | "assistant";
  content: string;
  status: TaskStatus;
  created_at: string;
  error?: ApiErrorBody;
  /** assistant 消息可能携带工具调用提案。生产后端通过 tool_node 写入，预览 API 通过 mock 生成 */
  tool_calls?: ToolCallProposed[];
  /** 工具执行完成后追加到 assistant 消息下方的结果列表 */
  tool_results?: ToolResult[];
};

export type TaskSnapshot = {
  task_id: string;
  conversation_id: string;
  status: TaskStatus;
  step_count: number;
  last_event_type: string | null;
  reply: string | null;
  error: ApiErrorBody | null;
};

/** 已登录用户的公开资料，由 /api/auth/me、login、register 返回 */
export type AuthUser = {
  user_id: string;
  username: string;
  display_name: string;
};

/** login / register / resume 的返回：用户资料 + 记住此设备的令牌（后端未附带时为 null） */
export type AuthResult = {
  user: AuthUser;
  remember_token: string | null;
};

/** /api/conversations 返回的会话摘要 */
export type ConversationSummary = {
  conversation_id: string;
  title: string;
  created_at: string;
};

export type ConversationApi = {
  createConversation(): Promise<{ conversation_id: string }>;
  sendMessage(
    conversationId: string,
    content: string,
  ): Promise<{ conversation_id: string; task_id: string; status: "pending" }>;
  getConversation(conversationId: string): Promise<{
    conversation_id: string;
    messages: ConversationMessage[];
  }>;
  getTask(taskId: string): Promise<TaskSnapshot>;
  /** 手动审批：批准一个 pending 的工具调用，执行后 tool_result 会随 getConversation 返回 */
  approveCall(conversationId: string, taskId: string, callId: string): Promise<void>;
  /** 手动审批：拒绝一个 pending 的工具调用，拒绝后 tool_result 记录拒绝原因 */
  rejectCall(conversationId: string, taskId: string, callId: string): Promise<void>;
};
