import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppearanceProvider } from "../lib/appearance";
import type { ConversationMessage } from "../types/api";
import { Transcript } from "./Transcript";

afterEach(() => {
  cleanup();
});

describe("Transcript", () => {
  it("模型输出时把对话滚到最下面，人往上翻之后就停住", () => {
    const metrics = { scroll: 800, client: 200 };
    const restore = installMetrics(metrics);
    try {
      const view = render(
        <AppearanceProvider>
          <Transcript messages={turn("task-1", "通")} loading={false} />
        </AppearanceProvider>,
      );
      const scroller = document.querySelector(".transcript") as HTMLElement;
      expect(scroller.scrollTop).toBe(800);

      scroller.scrollTop = 0;
      fireEvent.scroll(scroller);
      view.rerender(
        <AppearanceProvider>
          <Transcript messages={turn("task-1", "通分是把分母化成一样。")} loading={false} />
        </AppearanceProvider>,
      );
      expect(scroller.scrollTop).toBe(0);

      view.rerender(
        <AppearanceProvider>
          <Transcript messages={turn("task-2", "新的一轮")} loading={false} />
        </AppearanceProvider>,
      );
      expect(scroller.scrollTop).toBe(800);
    } finally {
      restore();
    }
  });
});

function turn(taskId: string, assistant: string): ConversationMessage[] {
  return [
    {
      task_id: taskId,
      role: "user",
      content: "什么是通分",
      status: "running",
      created_at: "2026-11-03T00:00:00Z",
    },
    {
      task_id: taskId,
      role: "assistant",
      content: assistant,
      status: "running",
      created_at: "2026-11-03T00:00:01Z",
    },
  ];
}

function installMetrics(metrics: { scroll: number; client: number }) {
  const scroll = Object.getOwnPropertyDescriptor(Element.prototype, "scrollHeight");
  const client = Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight");
  Object.defineProperty(Element.prototype, "scrollHeight", {
    configurable: true,
    get() {
      return metrics.scroll;
    },
  });
  Object.defineProperty(Element.prototype, "clientHeight", {
    configurable: true,
    get() {
      return metrics.client;
    },
  });
  return () => {
    if (scroll) Object.defineProperty(Element.prototype, "scrollHeight", scroll);
    else delete (Element.prototype as { scrollHeight?: number }).scrollHeight;
    if (client) Object.defineProperty(Element.prototype, "clientHeight", client);
    else delete (Element.prototype as { clientHeight?: number }).clientHeight;
  };
}
