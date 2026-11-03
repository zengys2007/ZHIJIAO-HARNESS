import type { StreamEvent } from "../types/api";

export function reduceStreamText(text: string, event: StreamEvent): string {
  if (event.event === "snapshot") return event.text;
  if (event.event === "reset") return "";
  if (event.event === "delta") return text + event.text;
  return text;
}

export function parseSseChunk(buffer: string): { events: StreamEvent[]; rest: string } {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  const events: StreamEvent[] = [];
  for (const part of parts) {
    const event = parseBlock(part);
    if (event) events.push(event);
  }
  return { events, rest };
}

function parseBlock(block: string): StreamEvent | null {
  let name = "";
  let data = "";
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) name = line.slice(6).trim();
    else if (line.startsWith("data:")) data = line.slice(5).trim();
  }
  if (name === "" || data === "") return null;
  const payload = JSON.parse(data) as Record<string, unknown>;
  if (name === "snapshot" || name === "delta") {
    return { event: name, text: typeof payload.text === "string" ? payload.text : "" };
  }
  if (name === "reset" || name === "done") return { event: name };
  if (name === "error") {
    return {
      event: "error",
      code: typeof payload.code === "string" ? payload.code : "internal",
      message: typeof payload.message === "string" ? payload.message : "系统出错了，可以再发一次。",
      retryable: payload.retryable === true,
    };
  }
  return null;
}
