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

export type PlanStatus = "off" | "draft" | "approved";

export type PlanSnapshot = {
  conversation_id: string;
  ask_mode?: boolean;
  plan_mode: boolean;
  plan_status: PlanStatus;
  plan_body: string;
};

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

export type StreamEvent =
  | { event: "snapshot"; text: string }
  | { event: "delta"; text: string }
  | { event: "reset" }
  | { event: "done" }
  | { event: "error"; code: string; message: string; retryable: boolean };

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
  pinned: boolean;
};

/** 用量圈里的一块。name 是 system、tools、context、summary、ask、plan、conversation。 */
export type ContextPart = {
  name: string;
  tokens: number;
};

/** 会话上下文用量。limit_source 标明上限来自供应商还是 1M 兜底。 */
export type ContextUsageInfo = {
  used_tokens: number;
  limit_tokens: number;
  limit_source: "provider" | "fallback";
  output_tokens?: number;
  compressed: boolean;
  parts?: ContextPart[];
};

export const EMPTY_CONTEXT: ContextUsageInfo = {
  used_tokens: 0,
  limit_tokens: 1_000_000,
  limit_source: "fallback",
  output_tokens: 128_000,
  compressed: false,
  parts: [],
};

export type ConversationApi = {
  createConversation(): Promise<{ conversation_id: string }>;
  sendMessage(
    conversationId: string,
    content: string,
    options?: { llmSource?: "local" | "dotenv" },
  ): Promise<{ conversation_id: string; task_id: string; status: "pending" }>;
  getConversation(conversationId: string): Promise<{
    conversation_id: string;
    messages: ConversationMessage[];
    context?: ContextUsageInfo;
    ask_mode?: boolean;
    plan_mode?: boolean;
    plan_status?: PlanStatus;
    plan_body?: string;
  }>;
  setAskMode(conversationId: string, askMode: boolean): Promise<PlanSnapshot & { ask_mode: boolean }>;
  setPlanMode(conversationId: string, planMode: boolean): Promise<PlanSnapshot>;
  savePlanBody(conversationId: string, body: string): Promise<PlanSnapshot>;
  generatePlan(conversationId: string): Promise<PlanSnapshot>;
  getTask(taskId: string): Promise<TaskSnapshot>;
  streamTask?(taskId: string): AsyncIterable<StreamEvent>;
  /** 手动审批：批准一个 pending 的工具调用，执行后 tool_result 会随 getConversation 返回 */
  approveCall(conversationId: string, taskId: string, callId: string): Promise<void>;
  /** 手动审批：拒绝一个 pending 的工具调用，拒绝后 tool_result 记录拒绝原因 */
  rejectCall(conversationId: string, taskId: string, callId: string): Promise<void>;
};

// ===== 教学上下文（备课与学情）=====

/** /api/teaching/overview 返回的班级（含名单） */
export type TeachingClassSummary = {
  class_id: string;
  name: string;
  created_at: string;
  students: string[];
};

export type TeachingPointSummary = {
  point_id: string;
  name: string;
  description: string;
  prerequisites: string[];
};

export type TeachingAssignmentSummary = {
  assignment_id: string;
  class_id: string;
  title: string;
  kind: string;
  created_at: string;
};

export type TeachingDocumentSummary = {
  document_id: string;
  doc_type: string;
  title: string;
  created_at: string;
};

export type TeachingOverview = {
  classes: TeachingClassSummary[];
  knowledge_points: TeachingPointSummary[];
  assignments: TeachingAssignmentSummary[];
  documents: TeachingDocumentSummary[];
};

export type InsightPoint = {
  name: string;
  latest_rate: number | null;
  previous_rate: number | null;
  recent_rate: number | null;
  covered: number;
};

export type WeakPoint = {
  name: string;
  rate: number;
};

export type StudentInsight = {
  name: string;
  overall_rate: number | null;
  by_point: Record<string, number>;
  weak: string[];
};

export type ClassInsights = {
  class_id: string;
  class_name: string;
  student_count: number;
  recent_assignments: { id: string; title: string; kind: string; created_at: string }[];
  latest: { id: string; title: string; kind: string; created_at: string } | null;
  knowledge_points: InsightPoint[];
  weak_points: WeakPoint[];
  students: StudentInsight[];
};

export type TeachingInsights = {
  classes: ClassInsights[];
};

/** 一次作业/测验的成绩录入 */
export type AssignmentRecordInput = {
  student: string;
  scores: Record<string, number>;
};

/** 教学上下文 API。测试可注入桩实现 */
export type TeachingApi = {
  loadOverview(): Promise<TeachingOverview>;
  loadInsights(): Promise<TeachingInsights>;
  createClass(name: string, students: string[]): Promise<{ class_id: string }>;
  createPoint(name: string, description: string, prerequisites: string[]): Promise<{ point_id: string }>;
  createAssignment(
    classId: string,
    title: string,
    kind: "homework" | "quiz",
    records: AssignmentRecordInput[],
  ): Promise<{ assignment_id: string }>;
  createDocument(
    docType: "lesson_plan" | "rubric",
    title: string,
    content: string,
  ): Promise<{ document_id: string }>;
};

// ===== 知识库 =====

export type KnowledgeSource = "paste" | "upload";

export type KnowledgeStatus = "pending" | "ready" | "failed";

export type KnowledgeDocument = {
  document_id: string;
  title: string;
  source: KnowledgeSource;
  filename: string;
  extension: string;
  status: KnowledgeStatus;
  message: string;
  created_at: string;
};

export type KnowledgeList = {
  embedding_model: string;
  documents: KnowledgeDocument[];
};

/** 知识库 API。测试可注入桩实现，页面不直接调用嵌入服务。 */
export type KnowledgeApi = {
  listDocuments(): Promise<KnowledgeList>;
  createPaste(title: string, content: string): Promise<KnowledgeDocument>;
  createUpload(file: File, title?: string): Promise<KnowledgeDocument>;
  deleteDocument(documentId: string): Promise<void>;
  embedDocument(documentId: string): Promise<KnowledgeDocument>;
  saveEmbeddingModel(model: string): Promise<{ embedding_model: string }>;
};
