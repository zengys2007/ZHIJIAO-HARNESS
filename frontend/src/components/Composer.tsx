import { useAppearance } from "../lib/appearance";

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
  const { t } = useAppearance();
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
          {t("message")}
        </label>
        <textarea
          id="draft"
          name="content"
          rows={2}
          placeholder={t("draftPlaceholder")}
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
          {busy ? t("replying") : t("send")}
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
          <p className="hint">{t("enterHint")}</p>
        </div>
      )}
    </div>
  );
}
