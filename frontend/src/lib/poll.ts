import type { ConversationApi, TaskSnapshot } from "../types/api";
import { ApiRequestError } from "../api/http";

export async function pollTask(
  api: Pick<ConversationApi, "getTask">,
  taskId: string,
  pause: (ms: number) => Promise<void> = wait,
): Promise<TaskSnapshot> {
  for (let attempt = 0; attempt < 600; attempt += 1) {
    const task = await api.getTask(taskId);
    if (task.status === "succeeded" || task.status === "failed") return task;
    await pause(1000);
  }
  throw new ApiRequestError("interrupted", "这次处理被中断了，可以再发一次。", true, 0);
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
