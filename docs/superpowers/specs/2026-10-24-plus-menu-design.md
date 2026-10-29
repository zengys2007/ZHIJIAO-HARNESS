# Composer 加号菜单设计（2026-10-24）

## 目标

在教师工作台输入框左下角加一个 `+` 按钮，点击向上弹出两段式菜单（参照 Cursor 的加号菜单）。「权限」切换审批模式，「模型」打开设置里的 API/MCPs 配置，「文件」打开本机文件选择；其余项点击后显示自动消散的轻提示「该功能尚未开放」。

## 交互

- `+` 按钮位于输入框左下角、审批控制器（`✋ 手动审批 ▾`）左侧，26px 高圆角小按钮，与审批触发按钮同族样式。
- 点击向上弹出浮层；click-outside / Esc 关闭；箭头旋转指示。复用 ApprovalBar 已验证的弹层模式。
- 菜单两段结构（与参照图一致）：
  - **添加**：文件 file、目标 goal、计划 plan、反馈 feedback
  - **指令**：压缩 compact、权限 permission、模型 model、下载日志 export
- 每项：左侧线性图标 + 中文主标签 + 英文次标签（灰色小字）+ 右侧灰字描述：
  - 目标：设置或查看长期任务目标
  - 计划：进入或退出计划模式
  - 反馈：发送关于当前会话的反馈
  - 压缩：压缩以上对话内容
  - 模型：选择本会话使用的模型
  - 下载日志：将当前会话内容导出为 ZIP
  - 文件：无描述（与参照图一致）

## 行为

- **权限**：点击在「手动审批 / 自动执行」间直接切换；行右侧描述显示当前模式（如「当前：手动审批」，带 ✓）；与左下角现有审批控制器双向同步（同一个 `approvalMode` state，两处入口）；现有审批控制器保留。
- **模型**：点击后菜单关闭，进入设置视图并选中「API/MCPs配置」。不新增会话级模型字段，也不改发消息 API。
- **文件**：点击后菜单关闭，打开系统文件选择器。仅接受 Excel / Word / PDF / 图片；选中项进入输入区上方附件条。文档可改显示名与移除，图片可预览与移除。本阶段不上传、不解析、不改发消息契约。细节见 `2026-10-29-composer-attachments-design.md`。
- **其余项**：点击后菜单关闭，弹出约 2.5 秒自动消散的 toast：「该功能尚未开放」。不打断输入框焦点。
- 未实现项不做置灰，视觉与参照图一致。

## 实现落点

- 组件 `frontend/src/components/PlusMenu.tsx`：自包含弹层 + 8 项图标/文案；props 为 `approvalMode`、`onApprovalModeChange`、`onPickFile`、`onOpenModel`、`onUnavailable`。
- `frontend/src/components/Composer.tsx`：`leadingSlot` 与 `attachmentSlot`。
- `frontend/src/pages/Workbench.tsx`：toast、附件状态、隐藏 file input。
- `frontend/src/styles.css`：`.plus-*`、`.toast`、`.attachment-*`。

## 测试

- vitest：菜单开合；点「权限」后审批控制器同步；点「模型」进入 API/MCPs；点「文件」出现附件条并可改名/移除；点其他未实现项出现「尚未开放」toast。
- 通过标准：typecheck 零错误，相关用例全绿。

## 不做

- 不实现目标、计划模式、反馈通道、对话压缩、会话级多模型覆盖、导出 ZIP。
- 不改动既有审批控制器与其弹层行为。
- 附件不上传、不解析、不写入会话；发消息仍只带文本 `content`。
