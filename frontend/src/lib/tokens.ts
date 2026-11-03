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

/** 供应商没返回最大输出时的兜底，与后端 DEFAULT_OUTPUT_LIMIT 一致。 */
export const OUTPUT_RESERVE = 128_000;

export const ASK_LEAD = "当前处于提问模式：只回答教师的问题，不要交付试题、评语或课件成品。";

/** 提问说明占用的 token。关闭时为 0。算法与后端 ask_tokens 一致。 */
export function countAskTokens(enabled: boolean): number {
  return enabled ? countDraftTokens(ASK_LEAD) : 0;
}

export const PLAN_DRAFT_LEAD = "当前处于计划模式：只修订下面的计划，不要交付试题、评语或课件成品。";
export const PLAN_DELIVER_LEAD = "教师已确认下面的计划。请按这份计划生成可直接使用的成品，不要再改写成新计划。";
const PLAN_BODY_LABEL = "计划正文：";

/** 与后端 plan_message 一致。 */
export function planMessage(status: "off" | "draft" | "approved", body: string): string {
  const text = body.trim();
  if (status === "draft") {
    if (!text) return PLAN_DRAFT_LEAD;
    return `${PLAN_DRAFT_LEAD}\n${PLAN_BODY_LABEL}\n${text.replaceAll("</", "<\\/")}`;
  }
  if (status === "approved" && text) {
    return `${PLAN_DELIVER_LEAD}\n${PLAN_BODY_LABEL}\n${text.replaceAll("</", "<\\/")}`;
  }
  return "";
}

/** 计划说明占用的 token，与后端 plan_tokens 同一算法。 */
export function countPlanTokens(status: "off" | "draft" | "approved", body = ""): number {
  const text = planMessage(status, body);
  return text ? countDraftTokens(text) : 0;
}

/** 预览模式没有供应商计数时，用同一编码器估算已有消息。 */
export function countMessageList(contents: string[]): number {
  const body = contents.reduce((sum, content) => sum + MESSAGE_OVERHEAD + countTextTokens(content), 0);
  return contents.length === 0 ? 0 : REPLY_PRIMER + body;
}
