import { useEffect, useRef, useState } from "react";
import { DisconnectError, httpApi } from "../api/http";
import { previewApi } from "../api/preview";
import { pollTask } from "../lib/poll";
import { loadSessions, saveSessions, type SessionSummary } from "../lib/sessions";
import { CONTENT_LIMIT, INVALID_CONTENT_MESSAGE, codePointLength, conversationTitle } from "../lib/text";
import type { ConversationApi, ConversationMessage, TaskSnapshot } from "../types/api";
import { Composer } from "../components/Composer";
import { Sidebar } from "../components/Sidebar";
import { Transcript } from "../components/Transcript";

const EMPTY_MESSAGES: ConversationMessage[] = [];

type Props = {
  api?: ConversationApi;
};

export function Workbench({ api }: Props) {
  const [sessions, setSessions] = useState<SessionSummary[]>(loadSessions);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [cache, setCache] = useState<Record<string, ConversationMessage[]>>({});
  const [unsent, setUnsent] = useState<ConversationMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);
  const [preview, setPreview] = useState(false);
  const busyRef = useRef(false);
  const aliveRef = useRef(true);
  const clientRef = useRef<ConversationApi>(api ?? httpApi);
  const messages = (activeId ? cache[activeId] : unsent) ?? EMPTY_MESSAGES;

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  useEffect(() => {
    saveSessions(sessions);
  }, [sessions]);

  useEffect(() => {
    clientRef.current = api ?? (preview ? previewApi : httpApi);
  }, [api, preview]);

  function showMessages(id: string | null, next: ConversationMessage[]) {
    if (!id) {
      setUnsent(next);
      return;
    }
    setCache((current) => ({ ...current, [id]: next }));
    setUnsent([]);
  }

  function adopt(id: string, content: string, shown: ConversationMessage[]) {
    setSessions((current) => [{ id, title: conversationTitle(content) }, ...current.filter((item) => item.id !== id)]);
    setActiveId(id);
    setCache((current) => ({ ...current, [id]: shown }));
    setUnsent([]);
  }

  async function ensureConversation(currentId: string | null, content: string, shown: ConversationMessage[]) {
    if (currentId) return currentId;
    try {
      const created = await clientRef.current.createConversation();
      adopt(created.conversation_id, content, shown);
      return created.conversation_id;
    } catch (error) {
      if (api || !(error instanceof DisconnectError)) throw error;
      return usePreview(content, shown);
    }
  }

  async function usePreview(content: string, shown: ConversationMessage[]) {
    clientRef.current = previewApi;
    setPreview(true);
    const created = await previewApi.createConversation();
    adopt(created.conversation_id, content, shown);
    return created.conversation_id;
  }

  async function handleSubmit() {
    if (busyRef.current) return;
    const content = draft.trim();
    if (codePointLength(content) < 1 || codePointLength(content) > CONTENT_LIMIT) {
      setBanner(INVALID_CONTENT_MESSAGE);
      return;
    }

    busyRef.current = true;
    setSubmitting(true);
    setBanner(null);
    setDraft("");

    const base = messages;
    const shown = [...base, pendingMessage(content)];
    let viewId = activeId;
    showMessages(viewId, shown);

    try {
      viewId = await ensureConversation(viewId, content, shown);
      const client = clientRef.current;
      const accepted = await client.sendMessage(viewId, content);
      const task = await pollTask(client, accepted.task_id);
      const conversation = await client.getConversation(viewId);
      if (!aliveRef.current) return;
      showMessages(viewId, applyTask(conversation.messages, task, content));
    } catch (error) {
      if (!aliveRef.current) return;
      if (!api && error instanceof DisconnectError) {
        try {
          viewId = await usePreview(content, shown);
          const accepted = await previewApi.sendMessage(viewId, content);
          const task = await pollTask(previewApi, accepted.task_id);
          const conversation = await previewApi.getConversation(viewId);
          if (!aliveRef.current) return;
          showMessages(viewId, applyTask(conversation.messages, task, content));
          return;
        } catch (previewError) {
          showMessages(viewId, base);
          setDraft(content);
          setBanner(previewError instanceof Error ? previewError.message : "系统出错了，可以再发一次。");
          return;
        }
      }
      showMessages(viewId, base);
      setDraft(content);
      setBanner(error instanceof Error ? error.message : "系统出错了，可以再发一次。");
    } finally {
      busyRef.current = false;
      if (aliveRef.current) setSubmitting(false);
    }
  }

  function handleNew() {
    if (busyRef.current) return;
    setActiveId(null);
    setUnsent([]);
    setDraft("");
    setBanner(null);
  }

  function handleSelect(id: string) {
    if (busyRef.current || id === activeId) return;
    setBanner(null);
    setActiveId(id);
    if (cache[id]) return;
    void clientRef.current
      .getConversation(id)
      .then((conversation) => {
        if (!aliveRef.current) return;
        setCache((current) => ({ ...current, [id]: conversation.messages }));
      })
      .catch((error: unknown) => {
        if (!aliveRef.current) return;
        setBanner(error instanceof Error ? error.message : "系统出错了，可以再发一次。");
        setCache((current) => ({ ...current, [id]: current[id] ?? [] }));
      });
  }

  return (
    <div className="app">
      <Sidebar
        sessions={sessions}
        activeId={activeId}
        busy={submitting}
        preview={preview}
        onNew={handleNew}
        onSelect={handleSelect}
      />
      <main className="main">
        <Transcript messages={messages} loading={activeId !== null && cache[activeId] === undefined} />
        <Composer
          value={draft}
          busy={submitting}
          alert={banner}
          onChange={setDraft}
          onSubmit={() => {
            void handleSubmit();
          }}
        />
      </main>
    </div>
  );
}

function pendingMessage(content: string): ConversationMessage {
  return {
    task_id: `local-${crypto.randomUUID()}`,
    role: "user",
    content,
    status: "pending",
    created_at: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
}

function applyTask(messages: ConversationMessage[], task: TaskSnapshot, content: string): ConversationMessage[] {
  const hasUser = messages.some((message) => message.task_id === task.task_id && message.role === "user");
  const next = hasUser
    ? messages.map((message) => {
        if (message.task_id !== task.task_id || message.role !== "user") return message;
        return {
          ...message,
          status: task.status,
          ...(task.error ? { error: task.error } : {}),
        };
      })
    : [
        ...messages,
        {
          task_id: task.task_id,
          role: "user" as const,
          content,
          status: task.status,
          created_at: "",
          ...(task.error ? { error: task.error } : {}),
        },
      ];
  if (task.status === "succeeded" && task.reply && !next.some((message) => message.task_id === task.task_id && message.role === "assistant")) {
    return [
      ...next,
      {
        task_id: task.task_id,
        role: "assistant",
        content: task.reply,
        status: "succeeded",
        created_at: "",
      },
    ];
  }
  return next;
}
