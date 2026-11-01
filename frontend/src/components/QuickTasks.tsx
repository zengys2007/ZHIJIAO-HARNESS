import type { ClassInsights } from "../types/api";

type Props = {
  insight: ClassInsights;
  /** 生成草稿后回填到对话输入框 */
  onDraft: (draft: string) => void;
};

/** 一键任务：按班级与薄弱点生成待发消息草稿，教师微调后发送 */
export function QuickTasks({ insight, onDraft }: Props) {
  const className = insight.class_name;
  const weakNames = insight.weak_points.map((item) => item.name);
  const focus = weakNames.length > 0 ? weakNames : insight.knowledge_points.map((item) => item.name).slice(0, 3);
  const focusText = focus.length > 0 ? `：${focus.join("、")}` : "";

  function draftForQuestions() {
    return `请为${className}出一套课堂练习题，重点覆盖薄弱知识点${focusText}。题型搭配合理，由易到难，附答案与讲解要点。`;
  }

  function draftForComments() {
    return `请根据${className}近期作业与测验表现，为每位学生写一段简短评语：先说具体进步，再指出最需要加强的知识点，语气鼓励、具体、不套话。`;
  }

  function draftForSlides() {
    return `请为${className}做一份课件内容，围绕薄弱知识点${focusText}展开：包含导入情境、核心讲解、两道例题和课堂练习，按幻灯片顺序分段输出。`;
  }

  return (
    <div className="quick-tasks" role="group" aria-label={`${className}的一键任务`}>
      <span className="quick-tasks-label">一键任务</span>
      <button type="button" className="quick-task" onClick={() => onDraft(draftForQuestions())}>
        出题
      </button>
      <button type="button" className="quick-task" onClick={() => onDraft(draftForComments())}>
        写评语
      </button>
      <button type="button" className="quick-task" onClick={() => onDraft(draftForSlides())}>
        做课件
      </button>
    </div>
  );
}
