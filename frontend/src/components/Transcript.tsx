import type { ConversationMessage } from "../types/api";

type Turn = {
  taskId: string;
  user: ConversationMessage;
  assistant?: ConversationMessage;
};

export function Transcript({ messages, loading }: { messages: ConversationMessage[]; loading: boolean }) {
  const turns = groupTurns(messages);
  if (loading) {
    return (
      <section className="transcript" aria-label="对话">
        <p className="loading" role="status">
          正在读取这段对话。
        </p>
      </section>
    );
  }
  if (turns.length === 0) {
    return (
      <section className="transcript" aria-label="对话">
        <div className="empty">
          <h1>智教harness</h1>
          <p>用一句话说说这节课。回复会出现在这里。</p>
        </div>
      </section>
    );
  }

  return (
    <section className="transcript" aria-label="对话">
      <div className="column">
        {turns.map((turn) => (
          <article key={turn.taskId} className="turn">
            <div className="bubble user">
              <p className="who">我</p>
              <p className="content">{turn.user.content}</p>
            </div>
            {turn.assistant ? (
              <div className="bubble assistant">
                <p className="who">智教harness</p>
                <p className="content">{turn.assistant.content}</p>
              </div>
            ) : null}
            {turn.user.status === "pending" || turn.user.status === "running" ? (
              <p className="turn-status" role="status">
                正在回复
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
