import { ApiRequestError } from "../api/http";
import type { ConversationApi, StreamEvent, TaskSnapshot } from "../types/api";
import { pollTask } from "./poll";
import { reduceStreamText } from "./sse";

type StreamClient = Pick<ConversationApi, "getTask"> & {
  streamTask?: ConversationApi["streamTask"];
};

export async function followTask(
  client: StreamClient,
  taskId: string,
  onText: (text: string) => void,
): Promise<TaskSnapshot> {
  if (!client.streamTask) return pollTask(client, taskId);
  let text = "";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      for await (const event of client.streamTask(taskId)) {
        if (event.event === "done" || event.event === "error") return client.getTask(taskId);
        text = reduceStreamText(text, event);
        onText(text);
      }
    } catch (error) {
      if (error instanceof ApiRequestError) throw error;
    }
  }
  return pollTask(client, taskId);
}

export type { StreamEvent };
