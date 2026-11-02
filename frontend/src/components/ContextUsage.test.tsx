import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { AppearanceProvider } from "../lib/appearance";
import { ContextUsage } from "./ContextUsage";

afterEach(() => {
  cleanup();
});

describe("ContextUsage", () => {
  it("opens the remaining tokens until the limit", async () => {
    const user = userEvent.setup();
    render(
      <AppearanceProvider>
        <ContextUsage
          draft=""
          context={{
            used_tokens: 250_000,
            limit_tokens: 1_000_000,
            limit_source: "provider",
            compressed: true,
            parts: [
              { name: "system", tokens: 1_200 },
              { name: "tools", tokens: 0 },
              { name: "context", tokens: 8_000 },
              { name: "summary", tokens: 2_000 },
              { name: "conversation", tokens: 238_800 },
            ],
          }}
        />
      </AppearanceProvider>,
    );

    await user.click(screen.getByRole("button", { name: "上下文用量" }));
    expect(screen.getByText("750,000")).toBeTruthy();
    expect(screen.getByText("1,000,000")).toBeTruthy();
    expect(screen.getByText("system")).toBeTruthy();
    expect(screen.getByText("context")).toBeTruthy();
    expect(screen.getByText("conversation")).toBeTruthy();
    expect(screen.getByText("上限来自模型供应商")).toBeTruthy();
    expect(screen.getByText("较早的对话已压成摘要")).toBeTruthy();
  });
});
