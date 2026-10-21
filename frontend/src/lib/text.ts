export const CONTENT_LIMIT = 4000;
export const INVALID_CONTENT_MESSAGE = "请把这句话写成 1 到 4000 字后再发送。";

export function codePointLength(value: string): number {
  return [...value.trim()].length;
}

export function conversationTitle(content: string): string {
  const line = content.trim().split("\n", 1)[0] ?? "";
  const chars = [...line];
  if (chars.length <= 18) return line;
  return `${chars.slice(0, 18).join("")}…`;
}
