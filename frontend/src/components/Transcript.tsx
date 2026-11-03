import { useLayoutEffect, useRef, useState } from "react";
import { useAppearance } from "../lib/appearance";
import { splitPlanSchemes, type PlanScheme } from "../lib/planSchemes";
import type { ConversationMessage } from "../types/api";
import { ToolCallCard } from "./ToolCallCard";

const NEAR_BOTTOM = 48;

type Turn = {
  taskId: string;
  user: ConversationMessage;
  assistant?: ConversationMessage;
};

type Props = {
  messages: ConversationMessage[];
  loading: boolean;
  /** 透传给 ToolCallCard 的审批动作 */
  onApprove?: (taskId: string, callId: string) => void;
  onReject?: (taskId: string, callId: string) => void;
  /** 最近一条已完成的助手计划。多套方案可单选后再生成 */
  planAction?: {
    label: string;
    note: string;
    disabled: boolean;
    onGenerate: (choice: { title: string; text: string } | null) => void;
  } | null;
};

export function Transcript({ messages, loading, onApprove, onReject, planAction = null }: Props) {
  const { t } = useAppearance();
  const scroller = useRef<HTMLElement>(null);
  const stick = useRef(true);
  const followedTask = useRef<string | null>(null);
  const turns = groupTurns(messages);
  const activeTask = runningTask(messages);
  const planTurnId = planAction ? latestSucceededAssistant(messages) : null;

  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node) return;
    if (activeTask && activeTask !== followedTask.current) {
      stick.current = true;
      followedTask.current = activeTask;
    }
    if (!activeTask) followedTask.current = null;
    if (!stick.current) return;
    node.scrollTop = node.scrollHeight;
  }, [messages, loading, activeTask]);

  function onScroll() {
    const node = scroller.current;
    if (!node) return;
    stick.current = node.scrollHeight - node.scrollTop - node.clientHeight <= NEAR_BOTTOM;
  }
  if (loading) {
    return (
      <section ref={scroller} className="transcript" aria-label={t("conversation")} onScroll={onScroll}>
        <p className="loading" role="status">
          {t("reading")}
        </p>
      </section>
    );
  }
  if (turns.length === 0) {
    return (
      <section ref={scroller} className="transcript" aria-label={t("conversation")} onScroll={onScroll}>
        <div className="empty">
          <h1>智教harness</h1>
          <p>{t("emptyHint")}</p>
        </div>
      </section>
    );
  }

  return (
    <section ref={scroller} className="transcript" aria-label={t("conversation")} onScroll={onScroll}>
      <div className="column">
        {turns.map((turn) => (
          <article key={turn.taskId} className="turn">
            <div className="bubble user">
              <p className="who">{t("me")}</p>
              <p className="content">{turn.user.content}</p>
            </div>
            {turn.assistant ? (
              <AssistantBlock
                taskId={turn.taskId}
                assistant={turn.assistant}
                onApprove={onApprove}
                onReject={onReject}
                planAction={turn.taskId === planTurnId ? planAction : null}
              />
            ) : null}
            {turn.user.status === "pending" || turn.user.status === "running" ? (
              <p className="turn-status" role="status">
                {t("replying")}
              </p>
            ) : null}
            {turn.user.status === "failed" && turn.user.error ? (
              <p className="turn-error" role="alert">
                {turn.user.error.message}
              </p>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

function AssistantBlock({
  taskId,
  assistant,
  onApprove,
  onReject,
  planAction,
}: {
  taskId: string;
  assistant: ConversationMessage;
  onApprove?: (taskId: string, callId: string) => void;
  onReject?: (taskId: string, callId: string) => void;
  planAction?: {
    label: string;
    note: string;
    disabled: boolean;
    onGenerate: (choice: { title: string; text: string } | null) => void;
  } | null;
}) {
  const { t } = useAppearance();
  const hasCalls = (assistant.tool_calls?.length ?? 0) > 0;
  const resultsById = new Map((assistant.tool_results ?? []).map((r) => [r.call_id, r]));
  const split = assistant.content ? splitPlanSchemes(assistant.content) : { preface: "", footer: "", schemes: [] };
  const choices = split.schemes.length >= 2 ? split : null;

  return (
    <>
      <div className="bubble assistant">
        <p className="who">智教harness</p>
        {choices ? (
          <PlanChoices
            preface={choices.preface}
            footer={choices.footer}
            schemes={choices.schemes}
            action={planAction}
          />
        ) : (
          <>
            {assistant.content ? <RichText text={assistant.content} /> : null}
            {planAction && assistant.content ? (
              <div className="plan-generate-row">
                <p className="plan-generate-note">{planAction.note}</p>
                <button
                  type="button"
                  className="plan-generate"
                  disabled={planAction.disabled}
                  onClick={() => planAction.onGenerate(null)}
                >
                  {planAction.label}
                </button>
              </div>
            ) : null}
          </>
        )}
      </div>
      {hasCalls ? (
        <div className="tool-list" aria-label={t("toolCalls")}>
          {assistant.tool_calls!.map((call) => (
            <ToolCallCard
              key={call.call_id}
              call={call}
              result={resultsById.get(call.call_id)}
              onApprove={(callId) => onApprove?.(taskId, callId)}
              onReject={(callId) => onReject?.(taskId, callId)}
              disabled={call.approval_status !== "pending"}
            />
          ))}
        </div>
      ) : null}
    </>
  );
}

function PlanChoices({
  preface,
  footer = "",
  schemes,
  action,
}: {
  preface: string;
  footer?: string;
  schemes: PlanScheme[];
  action?: {
    label: string;
    note: string;
    disabled: boolean;
    onGenerate: (choice: { title: string; text: string } | null) => void;
  } | null;
}) {
  const recommended = schemes.findIndex((scheme) => scheme.recommended);
  const [selected, setSelected] = useState(recommended >= 0 ? recommended : 0);
  const choice = schemes[selected] ?? schemes[0];

  return (
    <>
      {preface ? <RichText text={preface} /> : null}
      <div className="plan-schemes" role="radiogroup" aria-label="方案">
        {schemes.map((scheme, index) => (
          <label key={scheme.key} className={index === selected ? "plan-scheme is-selected" : "plan-scheme"}>
            <input
              type="radio"
              name="plan-scheme"
              checked={index === selected}
              disabled={action?.disabled}
              onChange={() => setSelected(index)}
            />
            <span className="plan-scheme-state">{index === selected ? "已选用" : "选用"}</span>
            <span className="plan-scheme-copy">
              <span className="plan-scheme-title">
                {scheme.title}
                {scheme.recommended ? <span className="plan-scheme-badge">推荐</span> : null}
              </span>
              {scheme.body ? <RichText text={scheme.body} /> : null}
            </span>
          </label>
        ))}
      </div>
      {footer ? <RichText text={footer} /> : null}
      {action ? (
        <div className="plan-generate-row">
          <p className="plan-generate-note">{action.note}</p>
          <button
            type="button"
            className="plan-generate"
            disabled={action.disabled}
            onClick={() =>
              action.onGenerate({
                title: choice.title,
                text: `${choice.title}\n${choice.body}`.trim(),
              })
            }
          >
            {action.label}
          </button>
        </div>
      ) : null}
    </>
  );
}

function RichText({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <div className="content rich-text">
      {lines.map((line, index) => {
        const heading = /^(#{1,3})\s+(.*)$/.exec(line);
        if (heading) {
          return (
            <p key={index} className="rich-heading">
              {inlineMarks(heading[2])}
            </p>
          );
        }
        if (line.trim() === "---") return <hr key={index} className="rich-rule" />;
        if (line.trim() === "") return <div key={index} className="rich-gap" />;
        return <p key={index}>{inlineMarks(line)}</p>;
      })}
    </div>
  );
}

function inlineMarks(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

function latestSucceededAssistant(messages: ConversationMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "assistant" && message.status === "succeeded" && message.content.trim()) {
      return message.task_id;
    }
  }
  return null;
}

function runningTask(messages: ConversationMessage[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role !== "user") continue;
    if (message.status === "pending" || message.status === "running") return message.task_id;
    return null;
  }
  return null;
}

function groupTurns(messages: ConversationMessage[]): Turn[] {
  const turns: Turn[] = [];
  const byTask = new Map<string, Turn>();
  for (const message of messages) {
    if (message.role === "user") {
      const turn: Turn = { taskId: message.task_id, user: message };
      turns.push(turn);
      byTask.set(message.task_id, turn);
      continue;
    }
    const turn = byTask.get(message.task_id);
    if (turn) turn.assistant = message;
  }
  return turns;
}
