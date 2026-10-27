import { useEffect, useRef, useState } from "react";
import { useAppearance } from "../lib/appearance";
import type { ApprovalMode } from "../types/api";

type Props = {
  approvalMode: ApprovalMode;
  onApprovalModeChange: (mode: ApprovalMode) => void;
  /** 点击未实现的功能项时触发 */
  onUnavailable: () => void;
};

type Item = {
  key: string;
  label: string;
  en: string;
  /** 右侧灰色描述；权限项由运行时计算 */
  desc?: string;
  icon: React.ReactNode;
  kind: "plain" | "permission";
};

/** 未实现项点击后的统一提示文案 */
export const UNAVAILABLE_TOAST = "该功能尚未开放";

export function PlusMenu({ approvalMode, onApprovalModeChange, onUnavailable }: Props) {
  const { locale, t } = useAppearance();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // 点击外部 / Esc 关闭（与 ApprovalBar 同一套模式）
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

  const permissionDesc = `${t("currentPrefix")}${approvalMode === "manual" ? t("manual") : t("automatic")}`;

  const sections: { title: string; items: Item[] }[] = [
    {
      title: t("add"),
      items: [
        { key: "file", label: t("file"), en: "file", icon: <FileIcon />, kind: "plain" },
        { key: "goal", label: t("goal"), en: "goal", desc: t("goalDesc"), icon: <GoalIcon />, kind: "plain" },
        { key: "plan", label: t("plan"), en: "plan", desc: t("planDesc"), icon: <PlanIcon />, kind: "plain" },
        { key: "feedback", label: t("feedback"), en: "feedback", desc: t("feedbackDesc"), icon: <FeedbackIcon />, kind: "plain" },
      ],
    },
    {
      title: t("commands"),
      items: [
        { key: "compact", label: t("compact"), en: "compact", desc: t("compactDesc"), icon: <CompactIcon />, kind: "plain" },
        { key: "permission", label: t("permission"), en: "permission", desc: permissionDesc, icon: <ShieldIcon />, kind: "permission" },
        { key: "model", label: t("model"), en: "model", desc: t("modelDesc"), icon: <ChipIcon />, kind: "plain" },
        { key: "export", label: t("exportLogs"), en: "export", desc: t("exportDesc"), icon: <DownloadIcon />, kind: "plain" },
      ],
    },
  ];

  function handleItemClick(item: Item) {
    if (item.kind === "permission") {
      // 在手动 / 自动间直接切换，菜单保持打开以查看当前状态
      onApprovalModeChange(approvalMode === "manual" ? "auto" : "manual");
      return;
    }
    onUnavailable();
    setOpen(false);
  }

  return (
    <div className="plus-inline" ref={rootRef}>
      <button
        type="button"
        className={`plus-trigger ${open ? "is-open" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("more")}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden>＋</span>
      </button>

      {open ? (
        <div className="plus-popover" role="menu" aria-label={t("more")}>
          {sections.map((section) => (
            <div key={section.title} className="plus-section">
              <p className="plus-section-label">{section.title}</p>
              {section.items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="menuitem"
                  className={`plus-item ${item.kind === "permission" ? "is-permission" : ""}`}
                  onClick={() => handleItemClick(item)}
                >
                  <span className="plus-item-icon" aria-hidden>
                    {item.icon}
                  </span>
                  <span className="plus-item-main">
                    <span className="plus-item-label">{item.label}</span>
                    {locale === "zh" ? <span className="plus-item-en">{item.en}</span> : null}
                  </span>
                  {item.desc ? (
                    <span className={`plus-item-desc ${item.kind === "permission" ? "is-active" : ""}`}>
                      {item.kind === "permission" ? `✓ ${item.desc}` : item.desc}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ===== 线性图标（与 Sidebar 设置图标同风格） ===== */

function FileIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path
        d="M7 4.5h7l4 4v11H7z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
      <path d="M14 4.5v4h4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}

function GoalIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="7.5" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="3.8" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
    </svg>
  );
}

function PlanIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path
        d="M5 6.3l1.8 1.8L9.3 5.6M5 13.3l1.8 1.8L9.3 12.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M12.5 7h6.5M12.5 14h6.5M6 19.5h12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function FeedbackIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path
        d="M5 7a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2h-5.5L8 19.5V16H7a2 2 0 0 1-2-2z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function CompactIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path
        d="M12 4v5m0 5v5M9.5 6.5 12 9l2.5-2.5M9.5 17.5 12 15l2.5 2.5M5 12h14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path
        d="M12 4l6 2.2v5c0 4-2.6 6.6-6 8-3.4-1.4-6-4-6-8v-5z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChipIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <rect x="7" y="7" width="10" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M10 4.5v2M14 4.5v2M10 17.5v2M14 17.5v2M4.5 10h2M4.5 14h2M17.5 10h2M17.5 14h2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path
        d="M12 4v9m0 0-3-3m3 3 3-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M5 16v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
