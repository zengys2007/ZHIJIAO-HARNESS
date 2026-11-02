import { useAppearance } from "../lib/appearance";

type ComposerProps = {
  value: string;
  busy: boolean;
  alert: string | null;
  onChange: (value: string) => void;
  onSubmit: () => void;
  /** 可选：输入框上方的附件条 */
  attachmentSlot?: React.ReactNode;
  /** 可选：输入框左下角最左侧的插槽（加号菜单） */
  leadingSlot?: React.ReactNode;
  /** 可选：嵌入输入框左下角的审批分段控制器 */
  approvalSegment?: React.ReactNode;
  /** 可选：输入框右下角的上下文用量 */
  contextSlot?: React.ReactNode;
  /** 计划模式。打开时在原输入框内显示灰色 plan */
  planMode?: boolean;
  /** 输入框无内容时按退格，退出计划模式 */
  onExitPlan?: () => void;
  /** 目标内联编辑。打开时在原输入框内显示灰色 goal，提交保存目标 */
  goalEditMode?: boolean;
  /** 输入框无内容时按退格，退出目标编辑（不提交） */
  onExitGoal?: () => void;
};

export function Composer({
  value,
  busy,
  alert,
  onChange,
  onSubmit,
  attachmentSlot,
  leadingSlot,
  approvalSegment,
  contextSlot,
  planMode = false,
  onExitPlan,
  goalEditMode = false,
  onExitGoal,
}: ComposerProps) {
  const { t } = useAppearance();
  const canSend = goalEditMode ? !busy : !busy && value.trim().length > 0;
  const fieldLabel = goalEditMode ? t("goal") : t("message");
  const placeholder = goalEditMode ? t("goalPlaceholder") : t("draftPlaceholder");
  const submitLabel = busy ? t("replying") : goalEditMode ? t("save") : t("send");
  const hint = goalEditMode ? t("goalHint") : t("enterHint");

  return (
    <div className="dock">
      {attachmentSlot}
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSend) onSubmit();
        }}
      >
        <div className="composer-field">
          <label className="sr-only" htmlFor="draft">
            {fieldLabel}
          </label>
          {planMode && !goalEditMode ? <span className="composer-plan">plan</span> : null}
          {goalEditMode ? <span className="composer-goal">goal</span> : null}
          <textarea
            id="draft"
            name="content"
            rows={2}
            placeholder={placeholder}
            value={value}
            disabled={busy}
            aria-label={fieldLabel}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (canSend) onSubmit();
                return;
              }
              if (event.key !== "Backspace" || value.length > 0) return;
              if (goalEditMode && onExitGoal) {
                event.preventDefault();
                onExitGoal();
                return;
              }
              if (planMode && onExitPlan) {
                event.preventDefault();
                onExitPlan();
              }
            }}
          />
        </div>
        <button className="send" type="submit" disabled={!canSend}>
          {submitLabel}
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
          <div className="composer-footer-right">
            <p className="hint">{hint}</p>
            {contextSlot}
          </div>
        </div>
      )}
    </div>
  );
}
