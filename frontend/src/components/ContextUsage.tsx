import { useEffect, useRef, useState } from "react";
import { useAppearance } from "../lib/appearance";
import { countDraftTokens } from "../lib/tokens";
import { EMPTY_CONTEXT, type ContextUsageInfo } from "../types/api";

type Props = {
  context?: ContextUsageInfo;
  draft: string;
};

const RADIUS = 6;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function ContextUsage({ context = EMPTY_CONTEXT, draft }: Props) {
  const { t } = useAppearance();
  const [open, setOpen] = useState(false);
  const [draftTokens, setDraftTokens] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const parts = context.parts ?? [];
  const measured = parts.reduce((sum, part) => sum + part.tokens, 0) + draftTokens;
  const used = parts.length > 0 ? measured : context.used_tokens + draftTokens;
  const rows = draftTokens > 0 ? [...parts, { name: "draft", tokens: draftTokens }] : parts;
  const partTitles: Record<string, string> = {
    system: t("contextPartSystem"),
    tools: t("contextPartTools"),
    context: t("contextPartContext"),
    summary: t("contextPartSummary"),
    conversation: t("contextPartConversation"),
    goal: t("contextPartGoal"),
    plan: t("contextPartPlan"),
    draft: t("contextPartDraft"),
  };
  const limit = context.limit_tokens;
  const ratio = limit > 0 ? Math.min(1, used / limit) : 0;
  const remaining = Math.max(0, limit - used);
  const tone = ratio >= 0.9 ? "danger" : ratio >= 0.7 ? "warm" : "neutral";

  useEffect(() => {
    const timer = window.setTimeout(() => setDraftTokens(countDraftTokens(draft)), 200);
    return () => window.clearTimeout(timer);
  }, [draft]);

  useEffect(() => {
    if (!open) return;
    const handleDoc = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", handleDoc);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleDoc);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open]);

  return (
    <div className="context-usage" ref={rootRef}>
      <button
        type="button"
        className={`context-ring is-${tone}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={t("contextUsage")}
        onClick={() => setOpen((current) => !current)}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
          <circle className="context-ring-track" cx="8" cy="8" r={RADIUS} />
          <circle
            className="context-ring-value"
            cx="8"
            cy="8"
            r={RADIUS}
            strokeDasharray={`${CIRCUMFERENCE * ratio} ${CIRCUMFERENCE}`}
          />
        </svg>
      </button>
      {open ? (
        <div className="context-popover" role="dialog" aria-label={t("contextUsage")}>
          <p>
            <span>{t("contextUsed")}</span>
            <span>{formatTokens(used)}</span>
          </p>
          <p>
            <span>{t("contextRemaining")}</span>
            <span>{formatTokens(remaining)}</span>
          </p>
          <p>
            <span>{t("contextLimit")}</span>
            <span>{formatTokens(limit)}</span>
          </p>
          <ul className="context-parts">
            {rows.map((part) => (
              <li key={part.name}>
                <span className="context-part-name" title={partTitles[part.name] ?? part.name}>
                  {part.name}
                </span>
                <span className="context-part-bar" aria-hidden="true">
                  <span style={{ width: `${limit > 0 ? Math.min(100, (part.tokens / limit) * 100) : 0}%` }} />
                </span>
                <span>{formatTokens(part.tokens)}</span>
              </li>
            ))}
          </ul>
          <p className="context-note">
            {context.limit_source === "provider" ? t("contextProvider") : t("contextFallback")}
          </p>
          {context.compressed ? <p className="context-note">{t("contextCompressed")}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function formatTokens(value: number): string {
  return Math.max(0, Math.round(value)).toLocaleString("zh-CN");
}
