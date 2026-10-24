import { useState } from "react";
import type { ToolCallProposed, ToolResult, ToolRisk } from "../types/api";

type Props = {
  call: ToolCallProposed;
  result?: ToolResult;
  onApprove?: (callId: string) => void;
  onReject?: (callId: string) => void;
  disabled?: boolean;
};

const RISK_LABEL: Record<ToolRisk, string> = {
  low: "低风险",
  medium: "中风险",
  high: "高风险",
};

const RISK_CLASS: Record<ToolRisk, string> = {
  low: "risk risk-low",
  medium: "risk risk-medium",
  high: "risk risk-high",
};

export function ToolCallCard({ call, result, onApprove, onReject, disabled }: Props) {
  const [argsOpen, setArgsOpen] = useState(false);
  const isPending = call.approval_status === "pending";
  const isRunning = call.approval_status === "running";
  const hasResult = result !== undefined;

  return (
    <article className={`tool-card state-${call.approval_status}`} aria-label={`工具调用 ${call.name}`}>
      <header className="tool-head">
        <span className="tool-icon" aria-hidden>🔧</span>
        <span className="tool-name">{call.name}</span>
        <span className={RISK_CLASS[call.risk]}>{RISK_LABEL[call.risk]}</span>
        {call.approval_note ? (
          <span className="tool-note">{call.approval_note}</span>
        ) : null}
      </header>

      <button
        type="button"
        className="tool-toggle"
        onClick={() => setArgsOpen((open) => !open)}
        aria-expanded={argsOpen}
      >
        <span className="tool-toggle-label">{argsOpen ? "收起参数" : "展开参数"}</span>
        <span className="tool-toggle-arrow" aria-hidden>
          {argsOpen ? "▾" : "▸"}
        </span>
      </button>

      {argsOpen ? (
        <pre className="tool-args" aria-label="工具参数">
          {pretty(call.arguments)}
        </pre>
      ) : null}

      {isPending ? (
        <footer className="tool-actions">
          <button
            type="button"
            className="tool-btn approve"
            disabled={disabled}
            onClick={() => onApprove?.(call.call_id)}
          >
            批准执行
          </button>
          <button
            type="button"
            className="tool-btn reject"
            disabled={disabled}
            onClick={() => onReject?.(call.call_id)}
          >
            拒绝
          </button>
        </footer>
      ) : null}

      {isRunning ? <p className="tool-running" role="status">正在执行...</p> : null}

      {hasResult ? (
        <section className="tool-result" aria-label="工具返回">
          <p className="tool-result-label">返回结果</p>
          <pre className="tool-result-body">{result.content}</pre>
        </section>
      ) : null}
    </article>
  );
}

function pretty(args: Record<string, unknown>): string {
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}
