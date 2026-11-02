import { getEncoding } from "js-tiktoken";

const encoding = getEncoding("o200k_base");
const MESSAGE_OVERHEAD = 4;
const REPLY_PRIMER = 3;

export function countTextTokens(text: string): number {
  if (!text) return 0;
  return encoding.encode(text).length;
}

/** 输入框里尚未发送的草稿，按一条用户消息的包装计算。 */
export function countDraftTokens(text: string): number {
  if (!text) return 0;
  return MESSAGE_OVERHEAD + countTextTokens(text);
}

/** 与后端输出预留一致。目标本身超过「窗口减去这段预留」时不能保存。 */
export const OUTPUT_RESERVE = 2000;
const GOAL_LABEL = "当前会话目标：";

/** 目标挂进上下文时增加的 token，与后端 goal_tokens 同一算法。 */
export function countGoalTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return countDraftTokens(GOAL_LABEL + trimmed.replaceAll("</", "<\\/"));
}

/** 与后端 plan.py 固定说明一致。 */
export const PLAN_MESSAGE =
  "当前处于计划模式：先写出可审阅的计划，等教师确认后再生成具体成品；不要跳过计划直接交付。";

/** 计划模式打开时增加的 token，与后端 plan_tokens 同一算法。 */
export function countPlanTokens(enabled: boolean): number {
  return enabled ? countDraftTokens(PLAN_MESSAGE) : 0;
}

/** 预览模式没有供应商计数时，用同一编码器估算已有消息。 */
export function countMessageList(contents: string[]): number {
  const body = contents.reduce((sum, content) => sum + MESSAGE_OVERHEAD + countTextTokens(content), 0);
  return contents.length === 0 ? 0 : REPLY_PRIMER + body;
}
