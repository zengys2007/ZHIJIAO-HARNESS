export type TaskStatus = "pending" | "running" | "succeeded" | "failed";

export type ApiErrorBody = {
  code: string;
  message: string;
  retryable: boolean;
};

export type ConversationMessage = {
  task_id: string;
  role: "user" | "assistant";
  content: string;
  status: TaskStatus;
  created_at: string;
  error?: ApiErrorBody;
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
};
