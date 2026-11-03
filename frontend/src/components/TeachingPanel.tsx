import { useCallback, useEffect, useState } from "react";
import { teachingApi as defaultApi } from "../api/http";
import type { ClassInsights, TeachingApi, TeachingInsights, TeachingOverview } from "../types/api";
import { QuickTasks } from "./QuickTasks";

type Props = {
  /** 测试注入：默认走后端 */
  api?: TeachingApi;
  /** 一键任务生成的草稿回填到对话输入框 */
  onDraft: (draft: string) => void;
};

type Tab = "insights" | "classes" | "points" | "assignments" | "documents";

const TABS: { key: Tab; label: string }[] = [
  { key: "insights", label: "学情洞察" },
  { key: "classes", label: "班级名单" },
  { key: "points", label: "知识点" },
  { key: "assignments", label: "作业成绩" },
  { key: "documents", label: "教案与评分标准" },
];

const EMPTY_OVERVIEW: TeachingOverview = { classes: [], knowledge_points: [], assignments: [], documents: [] };
const EMPTY_INSIGHTS: TeachingInsights = { classes: [] };

export function TeachingPanel({ api = defaultApi, onDraft }: Props) {
  const [tab, setTab] = useState<Tab>("insights");
  const [overview, setOverview] = useState<TeachingOverview>(EMPTY_OVERVIEW);
  const [insights, setInsights] = useState<TeachingInsights>(EMPTY_INSIGHTS);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [nextOverview, nextInsights] = await Promise.all([api.loadOverview(), api.loadInsights()]);
      setOverview(nextOverview);
      setInsights(nextInsights);
      setNotice(null);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "读取教学数据失败，请稍后再试。");
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function run(action: () => Promise<void>, successMessage: string) {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await action();
      await refresh();
      setNotice(successMessage);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "操作失败，请稍后再试。");
    } finally {
      setBusy(false);
    }
  }

  async function seedExample() {
    if (seeding) return;
    setSeeding(true);
    setNotice(null);
    try {
      const created = await api.createClass("三年二班", ["小明", "小红", "小刚", "小芳"]);
      const classId = created.class_id;
      for (const [name, description, prerequisites] of [
        ["分数加减", "同分母分数的加减运算", []],
        ["分数乘除", "分数乘法与除法", ["分数加减"]],
        ["约分", "把分数化成最简形式", ["分数加减"]],
        ["通分", "化成同分母再比较或运算", ["约分"]],
      ] as const) {
        await api.createPoint(name, description, [...prerequisites]);
      }
      await api.createAssignment(classId, "第一单元测验", "quiz", [
        { student: "小明", scores: { 分数加减: 88, 约分: 82 } },
        { student: "小红", scores: { 分数加减: 92, 约分: 88 } },
        { student: "小刚", scores: { 分数加减: 70, 约分: 85 } },
        { student: "小芳", scores: { 分数加减: 95, 约分: 90 } },
      ]);
      await api.createAssignment(classId, "第二单元测验", "quiz", [
        { student: "小明", scores: { 分数加减: 90, 分数乘除: 58, 约分: 55, 通分: 60 } },
        { student: "小红", scores: { 分数加减: 94, 分数乘除: 72, 约分: 66, 通分: 63 } },
        { student: "小刚", scores: { 分数加减: 65, 分数乘除: 50, 约分: 70, 通分: 55 } },
        { student: "小芳", scores: { 分数加减: 96, 分数乘除: 80, 约分: 88, 通分: 76 } },
      ]);
      await api.createDocument(
        "lesson_plan",
        "分数单元教案",
        "教学目标：掌握分数加减乘除的运算顺序；理解约分与通分的联系。重点：异分母加减先通分。难点：判断结果是否最简。课堂安排：情境导入 5 分钟，例题讲解 15 分钟，分层练习 15 分钟，小结 5 分钟。",
      );
      await api.createDocument(
        "rubric",
        "单元测验评分标准",
        "计算题按步骤给分：过程正确但结果未约分扣 1 分；完全错误不得分。应用题：列式正确得一半分，答案带单位。卷面整洁可加 1 分，总分不超过 100。",
      );
      await refresh();
      setNotice("示例数据已录入。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "示例数据录入失败，请稍后再试。");
    } finally {
      setSeeding(false);
    }
  }

  const hasData = overview.classes.length > 0;

  return (
    <div className="teaching">
      <header className="teaching-header">
        <div>
          <h1>备课与学情</h1>
          <p className="teaching-lead">
            录入班级名单、知识点、作业成绩和教案后，对话会自动带上这些教学上下文；问「帮我分析这次单元测验」即可直接得到薄弱点分析。
          </p>
        </div>
        <button type="button" className="teaching-seed" disabled={seeding || busy} onClick={() => void seedExample()}>
          {seeding ? "正在录入…" : "一键示例数据"}
        </button>
      </header>

      <nav className="teaching-tabs" role="tablist" aria-label="教学数据">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={tab === item.key}
            className={`teaching-tab ${tab === item.key ? "is-active" : ""}`}
            onClick={() => setTab(item.key)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {notice ? (
        <p className="teaching-notice" role="status">
          {notice}
        </p>
      ) : null}

      {loading ? (
        <p className="teaching-loading" role="status">
          正在读取教学数据…
        </p>
      ) : tab === "insights" ? (
        <InsightsView insights={insights} hasData={hasData} onDraft={onDraft} />
      ) : tab === "classes" ? (
        <ClassesView api={api} overview={overview} busy={busy} run={run} />
      ) : tab === "points" ? (
        <PointsView api={api} overview={overview} busy={busy} run={run} />
      ) : tab === "assignments" ? (
        <AssignmentsView api={api} overview={overview} busy={busy} run={run} />
      ) : (
        <DocumentsView api={api} overview={overview} busy={busy} run={run} />
      )}
    </div>
  );
}

// ===== 学情洞察 =====

function InsightsView({
  insights,
  hasData,
  onDraft,
}: {
  insights: TeachingInsights;
  hasData: boolean;
  onDraft: (draft: string) => void;
}) {
  if (!hasData) {
    return (
      <p className="teaching-empty">
        还没有教学数据。先到「班级名单」「知识点」「作业成绩」录入，或点右上角「一键示例数据」。
      </p>
    );
  }
  if (insights.classes.length === 0) {
    return <p className="teaching-empty">还没有班级，先到「班级名单」建一个班。</p>;
  }
  return (
    <div className="teaching-insights">
      {insights.classes.map((row) => (
        <ClassInsightCard key={row.class_id} row={row} onDraft={onDraft} />
      ))}
    </div>
  );
}

function ClassInsightCard({ row, onDraft }: { row: ClassInsights; onDraft: (draft: string) => void }) {
  const latest = row.latest;
  return (
    <section className="insight-card">
      <div className="insight-head">
        <h2>{row.class_name}</h2>
        <span className="insight-meta">{row.student_count} 名学生</span>
        {latest ? (
          <span className="insight-meta">
            最近一次：{latest.kind === "quiz" ? "测验" : "作业"}「{latest.title}」
          </span>
        ) : (
          <span className="insight-meta">还没有作业/测验记录</span>
        )}
      </div>

      {latest ? (
        <div className="insight-weak">
          <p className="insight-section-label">薄弱点分布</p>
          {row.weak_points.length === 0 ? (
            <p className="insight-empty">最近一次没有明显薄弱点。</p>
          ) : (
            <ul className="weak-list">
              {row.weak_points.map((item) => (
                <li key={item.name} className="weak-item">
                  <span className="weak-name">{item.name}</span>
                  <span className="weak-bar" aria-hidden="true">
                    <span className="weak-bar-fill" style={{ width: `${Math.round(item.rate * 100)}%` }} />
                  </span>
                  <span className="weak-rate">{Math.round(item.rate * 100)}%</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {row.knowledge_points.length > 0 ? (
        <details className="insight-details">
          <summary>各知识点得分率</summary>
          <table className="insight-table">
            <thead>
              <tr>
                <th>知识点</th>
                <th>最近一次</th>
                <th>上一次</th>
                <th>近期均值</th>
                <th>覆盖人次</th>
              </tr>
            </thead>
            <tbody>
              {row.knowledge_points.map((point) => (
                <tr key={point.name}>
                  <td>{point.name}</td>
                  <td>{formatRate(point.latest_rate)}</td>
                  <td>{formatRate(point.previous_rate)}</td>
                  <td>{formatRate(point.recent_rate)}</td>
                  <td>{point.covered}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}

      {row.students.length > 0 ? (
        <details className="insight-details">
          <summary>每位学生的知识点均分</summary>
          <table className="insight-table">
            <thead>
              <tr>
                <th>学生</th>
                <th>整体得分率</th>
                <th>个人薄弱点</th>
              </tr>
            </thead>
            <tbody>
              {row.students.map((student) => (
                <tr key={student.name}>
                  <td>{student.name}</td>
                  <td>{formatRate(student.overall_rate)}</td>
                  <td>{student.weak.length > 0 ? student.weak.join("、") : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}

      <QuickTasks insight={row} onDraft={onDraft} />
    </section>
  );
}

function formatRate(rate: number | null): string {
  if (rate === null) return "—";
  return `${Math.round(rate * 100)}%`;
}

// ===== 班级名单 =====

function ClassesView({
  api,
  overview,
  busy,
  run,
}: {
  api: TeachingApi;
  overview: TeachingOverview;
  busy: boolean;
  run: (action: () => Promise<void>, successMessage: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [students, setStudents] = useState("");

  function submit() {
    const trimmedName = name.trim();
    const list = students
      .split(/[\n,，、]/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    if (!trimmedName || list.length === 0) return;
    void run(async () => {
      await api.createClass(trimmedName, list);
      setName("");
      setStudents("");
    }, "班级已保存。");
  }

  return (
    <div className="teaching-body">
      <section className="teaching-form">
        <h2>新建班级</h2>
        <label className="teaching-field">
          <span>班级名</span>
          <input value={name} onChange={(e) => setName(e.target.value)} disabled={busy} placeholder="例如：三年二班" />
        </label>
        <label className="teaching-field">
          <span>学生名单（每行一个名字）</span>
          <textarea
            rows={5}
            value={students}
            onChange={(e) => setStudents(e.target.value)}
            disabled={busy}
            placeholder={"小明\n小红\n小刚"}
          />
        </label>
        <button type="button" className="teaching-submit" disabled={busy || !name.trim() || !students.trim()} onClick={submit}>
          保存班级
        </button>
      </section>

      <section className="teaching-list">
        <h2>已有班级</h2>
        {overview.classes.length === 0 ? (
          <p className="teaching-empty">还没有班级。</p>
        ) : (
          overview.classes.map((item) => (
            <article key={item.class_id} className="teaching-item">
              <div className="teaching-item-head">
                <strong>{item.name}</strong>
                <span className="teaching-meta">{item.students.length} 名学生</span>
              </div>
              <p className="teaching-item-body">{item.students.length > 0 ? item.students.join("、") : "名单为空"}</p>
            </article>
          ))
        )}
      </section>
    </div>
  );
}

// ===== 知识点 =====

function PointsView({
  api,
  overview,
  busy,
  run,
}: {
  api: TeachingApi;
  overview: TeachingOverview;
  busy: boolean;
  run: (action: () => Promise<void>, successMessage: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [prerequisites, setPrerequisites] = useState("");

  function submit() {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const list = prerequisites
      .split(/[,，、]/)
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    void run(async () => {
      await api.createPoint(trimmedName, description.trim(), list);
      setName("");
      setDescription("");
      setPrerequisites("");
    }, "知识点已保存。");
  }

  return (
    <div className="teaching-body">
      <section className="teaching-form">
        <h2>新建知识点</h2>
        <label className="teaching-field">
          <span>名称</span>
          <input value={name} onChange={(e) => setName(e.target.value)} disabled={busy} placeholder="例如：通分" />
        </label>
        <label className="teaching-field">
          <span>说明（可空）</span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={busy}
            placeholder="化成同分母再比较或运算"
          />
        </label>
        <label className="teaching-field">
          <span>先修知识点（逗号分隔，可空）</span>
          <input value={prerequisites} onChange={(e) => setPrerequisites(e.target.value)} disabled={busy} placeholder="约分，分数加减" />
        </label>
        <button type="button" className="teaching-submit" disabled={busy || !name.trim()} onClick={submit}>
          保存知识点
        </button>
      </section>

      <section className="teaching-list">
        <h2>已有知识点</h2>
        {overview.knowledge_points.length === 0 ? (
          <p className="teaching-empty">还没有知识点。录入作业成绩时用到的知识点也会自动登记。</p>
        ) : (
          overview.knowledge_points.map((item) => (
            <article key={item.point_id} className="teaching-item">
              <div className="teaching-item-head">
                <strong>{item.name}</strong>
                {item.prerequisites.length > 0 ? (
                  <span className="teaching-meta">先修：{item.prerequisites.join("、")}</span>
                ) : null}
              </div>
              {item.description ? <p className="teaching-item-body">{item.description}</p> : null}
            </article>
          ))
        )}
      </section>
    </div>
  );
}

// ===== 作业成绩 =====

function AssignmentsView({
  api,
  overview,
  busy,
  run,
}: {
  api: TeachingApi;
  overview: TeachingOverview;
  busy: boolean;
  run: (action: () => Promise<void>, successMessage: string) => Promise<void>;
}) {
  const [classId, setClassId] = useState("");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<"homework" | "quiz">("quiz");
  const [records, setRecords] = useState("");

  const activeClassId = classId || overview.classes[0]?.class_id || "";
  const classNameById = new Map(overview.classes.map((item) => [item.class_id, item.name]));

  function submit() {
    const trimmedTitle = title.trim();
    if (!activeClassId || !trimmedTitle) return;
    const parsed: { student: string; scores: Record<string, number> }[] = [];
    for (const line of records.split("\n")) {
      const text = line.trim();
      if (!text) continue;
      const parts = text.split(/\s+/);
      if (parts.length < 2) return;
      const student = parts[0];
      const scores: Record<string, number> = {};
      for (const cell of parts.slice(1)) {
        const [pointName, rawScore] = cell.split(":");
        const score = Number(rawScore);
        if (!pointName || !Number.isFinite(score) || score < 0 || score > 100) return;
        scores[pointName] = score;
      }
      parsed.push({ student, scores });
    }
    if (parsed.length === 0) return;
    void run(async () => {
      await api.createAssignment(activeClassId, trimmedTitle, kind, parsed);
      setTitle("");
      setRecords("");
    }, "作业成绩已保存。");
  }

  return (
    <div className="teaching-body">
      <section className="teaching-form">
        <h2>录入作业/测验成绩</h2>
        <label className="teaching-field">
          <span>班级</span>
          <select value={activeClassId} onChange={(e) => setClassId(e.target.value)} disabled={busy || overview.classes.length === 0}>
            {overview.classes.map((item) => (
              <option key={item.class_id} value={item.class_id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="teaching-field">
          <span>标题</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} placeholder="例如：第二单元测验" />
        </label>
        <label className="teaching-field">
          <span>类型</span>
          <select value={kind} onChange={(e) => setKind(e.target.value === "homework" ? "homework" : "quiz")} disabled={busy}>
            <option value="quiz">测验</option>
            <option value="homework">作业</option>
          </select>
        </label>
        <label className="teaching-field">
          <span>成绩（每行：学生名 知识点:分数 知识点:分数）</span>
          <textarea
            rows={6}
            value={records}
            onChange={(e) => setRecords(e.target.value)}
            disabled={busy}
            placeholder={"小明 约分:55 通分:60\n小红 约分:66 通分:63"}
          />
        </label>
        <button
          type="button"
          className="teaching-submit"
          disabled={busy || !activeClassId || !title.trim() || !records.trim()}
          onClick={submit}
        >
          保存成绩
        </button>
      </section>

      <section className="teaching-list">
        <h2>已有记录</h2>
        {overview.assignments.length === 0 ? (
          <p className="teaching-empty">还没有作业/测验记录。</p>
        ) : (
          overview.assignments.map((item) => (
            <article key={item.assignment_id} className="teaching-item">
              <div className="teaching-item-head">
                <strong>{item.title}</strong>
                <span className="teaching-meta">
                  {classNameById.get(item.class_id) ?? "未知班级"} · {item.kind === "quiz" ? "测验" : "作业"} ·{" "}
                  {item.created_at.slice(0, 10)}
                </span>
              </div>
            </article>
          ))
        )}
      </section>
    </div>
  );
}

// ===== 教案与评分标准 =====

function DocumentsView({
  api,
  overview,
  busy,
  run,
}: {
  api: TeachingApi;
  overview: TeachingOverview;
  busy: boolean;
  run: (action: () => Promise<void>, successMessage: string) => Promise<void>;
}) {
  const [docType, setDocType] = useState<"lesson_plan" | "rubric">("lesson_plan");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  function submit() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle || !content.trim()) return;
    void run(async () => {
      await api.createDocument(docType, trimmedTitle, content.trim());
      setTitle("");
      setContent("");
    }, "文档已保存。");
  }

  return (
    <div className="teaching-body">
      <section className="teaching-form">
        <h2>新建教案/评分标准</h2>
        <label className="teaching-field">
          <span>类型</span>
          <select
            value={docType}
            onChange={(e) => setDocType(e.target.value === "rubric" ? "rubric" : "lesson_plan")}
            disabled={busy}
          >
            <option value="lesson_plan">教案</option>
            <option value="rubric">评分标准</option>
          </select>
        </label>
        <label className="teaching-field">
          <span>标题</span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} placeholder="例如：分数单元教案" />
        </label>
        <label className="teaching-field">
          <span>正文（可直接粘贴已有内容）</span>
          <textarea
            rows={8}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            disabled={busy}
            placeholder="教学目标、重点难点、课堂安排…"
          />
        </label>
        <button
          type="button"
          className="teaching-submit"
          disabled={busy || !title.trim() || !content.trim()}
          onClick={submit}
        >
          保存文档
        </button>
      </section>

      <section className="teaching-list">
        <h2>已有文档</h2>
        {overview.documents.length === 0 ? (
          <p className="teaching-empty">还没有教案或评分标准。</p>
        ) : (
          overview.documents.map((item) => (
            <article key={item.document_id} className="teaching-item">
              <div className="teaching-item-head">
                <strong>{item.title}</strong>
                <span className="teaching-meta">
                  {item.doc_type === "lesson_plan" ? "教案" : "评分标准"} · {item.created_at.slice(0, 10)}
                </span>
              </div>
            </article>
          ))
        )}
      </section>
    </div>
  );
}
