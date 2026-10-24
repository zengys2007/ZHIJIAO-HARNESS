type ComposerProps = {
  value: string;
  busy: boolean;
  alert: string | null;
  onChange: (value: string) => void;
  onSubmit: () => void;
  /** 可选：输入框左下角最左侧的插槽（加号菜单） */
  leadingSlot?: React.ReactNode;
  /** 可选：嵌入输入框左下角的审批分段控制器 */
  approvalSegment?: React.ReactNode;
};

export function Composer({ value, busy, alert, onChange, onSubmit, leadingSlot, approvalSegment }: ComposerProps) {
  const canSend = !busy && value.trim().length > 0;

  return (
    <div className="dock">
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSend) onSubmit();
        }}
      >
        <label className="sr-only" htmlFor="draft">
          消息
        </label>
        <textarea
          id="draft"
          name="content"
          rows={2}
          placeholder="写下这节课想解决的问题"
          value={value}
          disabled={busy}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (canSend) onSubmit();
            }
          }}
        />
        <button className="send" type="submit" disabled={!canSend}>
          {busy ? "正在回复" : "发送"}
        </button>
      </form>
      {alert ? (
        <p className="banner" role="alert">
          {alert}
        </p>
      ) : (
        <div className="composer-footer">
          <div className="composer-footer-left">
            {leadingSlot}
            {approvalSegment}
          </div>
          <p className="hint">Enter 发送，Shift+Enter 换行</p>
        </div>
      )}
    </div>
  );
}
