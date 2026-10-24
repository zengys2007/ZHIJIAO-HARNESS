import { useEffect, useRef, useState } from "react";
import type { ApprovalMode } from "../types/api";

type Props = {
  mode: ApprovalMode;
  onChange: (mode: ApprovalMode) => void;
  pendingCount?: number;
};

type Option = {
  value: ApprovalMode;
  label: string;
  hint: string;
  icon: string;
};

const OPTIONS: Option[] = [
  {
    value: "manual",
    label: "手动审批",
    hint: "每次工具调用都要确认",
    icon: "✋",
  },
  {
    value: "auto",
    label: "自动执行",
    hint: "直接执行所有工具调用",
    icon: "⚡",
  },
];

export function ApprovalBar({ mode, onChange, pendingCount = 0 }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const current = OPTIONS.find((o) => o.value === mode) ?? OPTIONS[0];

  // 点击外部 / Esc 关闭
  useEffect(() => {
    if (!open) return;
    const handleDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleDoc);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleDoc);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  function handlePick(value: ApprovalMode) {
    onChange(value);
    setOpen(false);
  }

  return (
    <div className="approval-inline" ref={rootRef}>
      <button
        type="button"
        className={`approval-trigger ${open ? "is-open" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="审批模式"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="approval-trigger-icon" aria-hidden>
          {current.icon}
        </span>
        <span className="approval-trigger-label">{current.label}</span>
        {pendingCount > 0 ? (
          <span className="approval-trigger-badge" role="status">
            {pendingCount}
          </span>
        ) : null}
        <span className="approval-trigger-caret" aria-hidden>
          {open ? "▴" : "▾"}
        </span>
      </button>

      {open ? (
        <div className="approval-popover" role="menu" aria-label="选择审批模式">
          {OPTIONS.map((opt) => {
            const selected = opt.value === mode;
            return (
              <label key={opt.value} className={`approval-option ${selected ? "is-selected" : ""}`}>
                <input
                  type="radio"
                  name="approval-mode"
                  value={opt.value}
                  checked={selected}
                  onChange={() => handlePick(opt.value)}
                />
                <span className="approval-option-icon" aria-hidden>
                  {opt.icon}
                </span>
                <span className="approval-option-main">
                  <span className="approval-option-label">{opt.label}</span>
                  <span className="approval-option-hint">{opt.hint}</span>
                </span>
                {selected ? <span className="approval-option-check" aria-hidden>✓</span> : null}
              </label>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
