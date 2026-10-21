## Agent 技能

项目技能都在 `.agents/skills/`。Cursor 会加载这里的 `SKILL.md`，协作者和检出本仓库的远程 Agent 打开项目即可使用。

`skills-lock.json` 只记录用 `npx skills` 安装的技能。Superpowers 是按 MIT 许可复制进仓库的，版本说明见 `.agents/skills/SUPERPOWERS-UPSTREAM.txt`。

### 工作方式（Superpowers 6.1.1）

| 技能 | 何时使用 |
| --- | --- |
| `using-superpowers` | 开始工作时，先确定该用哪个技能 |
| `brainstorming` | 做功能或改行为之前，先把意图和设计说清楚 |
| `writing-plans` | 有规格之后、写代码之前，先写实现计划 |
| `test-driven-development` | 先写测试，再写实现 |
| `executing-plans` | 按书面计划执行，并在检查点复核 |
| `subagent-driven-development` | 在当前会话里把计划拆成独立任务执行 |
| `dispatching-parallel-agents` | 两件以上互不依赖的任务并行处理 |
| `using-git-worktrees` | 功能开发需要和当前工作区隔离时 |
| `systematic-debugging` | 遇到 bug、测试失败或异常行为时，先查原因 |
| `verification-before-completion` | 声称完成、修好或测试通过之前，先跑验证 |
| `requesting-code-review` | 功能做完或合并前，对照需求做审查 |
| `receiving-code-review` | 收到审查意见后，先核对再改 |
| `finishing-a-development-branch` | 测试通过后，决定合并、提 PR 或清理 |
| `writing-skills` | 新建或修改技能 |

### 前端

| 技能 | 何时使用 |
| --- | --- |
| `vercel-react-best-practices` | 写、改或审查 React 代码时的性能约定。其中 Next.js 专有条目只在用到对应 API 时适用 |
| `web-design-guidelines` | 审查界面、无障碍和交互是否符合 Web Interface Guidelines |

### 只在本机

`find-skills` 装在用户目录 `~/.agents/skills/`，不在本仓库里。它用来查找还能安装哪些技能，不会跟着项目同步给其他人。
