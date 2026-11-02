export function codePointLength(value: string): number {
  return [...value.trim()].length;
}

export function conversationTitle(content: string): string {
  const line = content.trim().split("\n", 1)[0] ?? "";
  const chars = [...line];
  if (chars.length <= 18) return line;
  return `${chars.slice(0, 18).join("")}…`;
}
