import { useCallback, useEffect, useMemo, useState } from "react";
import {
  GOAL_GRADES, GOAL_SUBJECTS, GOAL_TERMS,
  type GoalNode, type GoalTree, type GoalTreeDetail, type GoalsApi,
} from "../types/goals";

type Props = {
  api: GoalsApi;
  onBack: () => void;
};

type Draft = {
  nodeId: string | null;
  parentId: string | null;
  level: "semester" | "unit" | "lesson";
  title: string;
  description: string;
  verifyCriteria: string;
};

const LEVEL_LABELS: Record<GoalNode["level"], string> = {
  semester: "学期总目标",
  unit: "单元",
  lesson: "课时目标",
};

/** 目标视图：左侧目标树列表/树形结构，右侧节点编辑。 */
export function GoalsView({ api, onBack }: Props) {
  const [trees, setTrees] = useState<GoalTree[]>([]);
  const [detail, setDetail] = useState<GoalTreeDetail | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newTree, setNewTree] = useState({ subject: "数学", grade: 7, term: "上", title: "", templateInit: true });

  const refreshTrees = useCallback(async () => {
    try {
      setTrees(await api.listGoalTrees({}));
    } catch {
      setBanner("目标树列表加载失败，可以稍后再试。");
    }
  }, [api]);

  useEffect(() => {
    void refreshTrees();
  }, [refreshTrees]);

  const nodesByParent = useMemo(() => {
    const map = new Map<string | null, GoalNode[]>();
    if (!detail) return map;
    for (const node of detail.nodes) {
      const list = map.get(node.parent_id) ?? [];
      list.push(node);
      map.set(node.parent_id, list);
    }
    return map;
  }, [detail]);

  const semesterNodes = nodesByParent.get(null)?.filter((n) => n.level === "semester") ?? [];
  const unitNodes = nodesByParent.get(null)?.filter((n) => n.level === "unit") ?? [];

  async function openTree(treeId: string) {
    setBanner(null);
    setSelected(null);
    setDraft(null);
    try {
      setDetail(await api.getGoalTree(treeId));
    } catch {
      setBanner("目标树读取失败，可以稍后再试。");
    }
  }

  async function createTree() {
    if (!newTree.title.trim()) {
      setBanner("请先填写目标树标题。");
      return;
    }
    setBusy(true);
    try {
      const tree = await api.createGoalTree({
        subject: newTree.subject, grade: newTree.grade, term: newTree.term,
        title: newTree.title.trim(), template_init: newTree.templateInit,
      });
      setCreating(false);
      setNewTree((s) => ({ ...s, title: "" }));
      await refreshTrees();
      await openTree(tree.tree_id);
    } catch (error) {
      setBanner(readMessage(error, "创建失败，可以稍后再试。"));
    } finally {
      setBusy(false);
    }
  }

  function selectNode(node: GoalNode) {
    setSelected(node.node_id);
    setDraft({
      nodeId: node.node_id, parentId: node.parent_id, level: node.level,
      title: node.title, description: node.description, verifyCriteria: node.verify_criteria,
    });
  }

  function startCreateChild(parent: GoalNode | null, level: Draft["level"]) {
    setDraft({
      nodeId: null, parentId: parent ? parent.node_id : null, level,
      title: "", description: "", verifyCriteria: "",
    });
  }

  async function saveDraft() {
    if (!draft || !detail) return;
    if (!draft.title.trim()) {
      setBanner("请填写标题。");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        title: draft.title.trim(), description: draft.description.trim(),
        verify_criteria: draft.verifyCriteria.trim(), standard_refs: [],
      };
      if (draft.nodeId === null) {
        await api.createGoalNode(detail.tree.tree_id, {
          parent_id: draft.parentId, level: draft.level,
          title: payload.title, description: payload.description,
          verify_criteria: payload.verify_criteria, standard_refs: [],
        });
      } else {
        await api.updateGoalNode(draft.nodeId, payload);
      }
      setDraft(null);
      setSelected(null);
      await openTree(detail.tree.tree_id);
    } catch (error) {
      setBanner(readMessage(error, "保存失败，可以稍后再试。"));
    } finally {
      setBusy(false);
    }
  }

  async function removeNode(node: GoalNode) {
    if (!detail) return;
    setBusy(true);
    try {
      await api.deleteGoalNode(node.node_id);
      if (selected === node.node_id) {
        setSelected(null);
        setDraft(null);
      }
      await openTree(detail.tree.tree_id);
    } catch (error) {
      setBanner(readMessage(error, "删除失败，可以稍后再试。"));
    } finally {
      setBusy(false);
    }
  }

  async function move(node: GoalNode, direction: "up" | "down") {
    if (!detail) return;
    try {
      await api.reorderGoalNode(node.node_id, direction);
      await openTree(detail.tree.tree_id);
    } catch {
      setBanner("调整顺序失败，可以稍后再试。");
    }
  }

  return (
    <section className="goals" aria-label="目标管理">
      <header className="goals-header">
        <button type="button" className="goals-back" onClick={detail ? () => { setDetail(null); setSelected(null); setDraft(null); } : onBack}>
          {detail ? "返回列表" : "返回对话"}
        </button>
        <h1 className="goals-title">{detail ? `${detail.tree.title}（${detail.tree.subject} · ${detail.tree.grade}年级${detail.tree.term}学期）` : "目标管理"}</h1>
        {detail ? (
          <div className="goals-actions">
            <button type="button" onClick={() => startCreateChild(null, "semester")}>加总目标</button>
            <button type="button" onClick={() => startCreateChild(null, "unit")}>加单元</button>
          </div>
        ) : (
          <button type="button" className="goals-new" onClick={() => setCreating((c) => !c)}>新建目标树</button>
        )}
      </header>

      {banner ? <p className="goals-banner" role="alert">{banner}</p> : null}

      {detail ? (
        <div className="goals-body">
          <div className="goals-tree" aria-label="目标树">
            <p className="goals-group-label">学期总目标</p>
            <NodeRow nodes={semesterNodes} onSelect={selectNode} onCreate={() => startCreateChild(null, "semester")} createLabel="加总目标" onMove={move} onDelete={removeNode} selected={selected} />
            <p className="goals-group-label">单元</p>
            {unitNodes.length === 0 ? <p className="goals-empty">还没有单元。点右上「加单元」开始拆解。</p> : null}
            {unitNodes.map((unit) => (
              <div key={unit.node_id} className="goals-unit">
                <NodeRow nodes={[unit]} onSelect={selectNode} onMove={move} onDelete={removeNode} selected={selected} />
                <div className="goals-lessons">
                  <NodeRow nodes={nodesByParent.get(unit.node_id) ?? []} onSelect={selectNode} onCreate={() => startCreateChild(unit, "lesson")} createLabel="加课时目标" onMove={move} onDelete={removeNode} selected={selected} />
                </div>
              </div>
            ))}
          </div>
          <div className="goals-editor">
            {draft ? (
              <form
                className="goals-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveDraft();
                }}
              >
                <p className="goals-form-heading">
                  {draft.nodeId === null ? `新建${LEVEL_LABELS[draft.level]}` : `编辑${LEVEL_LABELS[draft.level]}`}
                </p>
                <label>
                  标题
                  <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} required maxLength={100} />
                </label>
                <label>
                  描述
                  <textarea rows={3} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} maxLength={2000} />
                </label>
                <label>
                  可验证达成标准
                  <textarea rows={3} value={draft.verifyCriteria} onChange={(e) => setDraft({ ...draft, verifyCriteria: e.target.value })} maxLength={2000} />
                </label>
                <div className="goals-form-actions">
                  <button type="submit" disabled={busy}>保存</button>
                  <button type="button" onClick={() => { setDraft(null); setSelected(null); }}>取消</button>
                </div>
              </form>
            ) : (
              <p className="goals-hint">从左侧选择一条目标进行编辑，或新建目标。</p>
            )}
          </div>
        </div>
      ) : (
        <div className="goals-list">
          {creating ? (
            <form
              className="goals-form goals-create"
              onSubmit={(event) => {
                event.preventDefault();
                void createTree();
              }}
            >
              <p className="goals-form-heading">新建目标树</p>
              <label>
                学科
                <select value={newTree.subject} onChange={(e) => setNewTree({ ...newTree, subject: e.target.value })}>
                  {GOAL_SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label>
                年级
                <select value={newTree.grade} onChange={(e) => setNewTree({ ...newTree, grade: Number(e.target.value) })}>
                  {GOAL_GRADES.map((g) => <option key={g} value={g}>{g} 年级</option>)}
                </select>
              </label>
              <label>
                学期
                <select value={newTree.term} onChange={(e) => setNewTree({ ...newTree, term: e.target.value })}>
                  {GOAL_TERMS.map((t) => <option key={t} value={t}>{t}学期</option>)}
                </select>
              </label>
              <label>
                标题
                <input value={newTree.title} onChange={(e) => setNewTree({ ...newTree, title: e.target.value })} placeholder="如：七上数学-草稿" maxLength={100} required />
              </label>
              <label className="goals-check">
                <input type="checkbox" checked={newTree.templateInit} onChange={(e) => setNewTree({ ...newTree, templateInit: e.target.checked })} />
                按课标骨架预填学期总目标草稿
              </label>
              <div className="goals-form-actions">
                <button type="submit" disabled={busy}>创建</button>
                <button type="button" onClick={() => setCreating(false)}>取消</button>
              </div>
            </form>
          ) : null}
          {trees.length === 0 && !creating ? <p className="goals-empty">还没有目标树。点「新建目标树」，选学科后会自动预填课标骨架草稿。</p> : null}
          <ul>
            {trees.map((tree) => (
              <li key={tree.tree_id} className="goals-tree-item">
                <span className="goals-tree-name">{tree.title}</span>
                <span className="goals-tree-meta">{tree.subject} · {tree.grade} 年级{tree.term}学期</span>
                <button type="button" onClick={() => void openTree(tree.tree_id)}>打开</button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function NodeRow({ nodes, onSelect, onCreate, createLabel, onMove, onDelete, selected }: {
  nodes: GoalNode[];
  onSelect: (node: GoalNode) => void;
  onCreate?: () => void;
  createLabel?: string;
  onMove: (node: GoalNode, direction: "up" | "down") => void;
  onDelete: (node: GoalNode) => void;
  selected: string | null;
}) {
  return (
    <ul className="goals-nodes">
      {nodes.map((node, index) => (
        <li key={node.node_id} className={`goals-node ${selected === node.node_id ? "is-selected" : ""}`}>
          <button type="button" className="goals-node-title" onClick={() => onSelect(node)}>
            <span className="goals-node-level">{LEVEL_LABELS[node.level]}</span>
            {node.title}
          </button>
          {/* 上移/下移/删除只出现在选中行上，先选中再操作 */}
          {selected === node.node_id ? (
            <span className="goals-node-ops">
              <button type="button" aria-label="上移" disabled={index === 0} onClick={() => onMove(node, "up")}>↑</button>
              <button type="button" aria-label="下移" disabled={index === nodes.length - 1} onClick={() => onMove(node, "down")}>↓</button>
              <button type="button" onClick={() => onDelete(node)}>删除</button>
            </span>
          ) : null}
        </li>
      ))}
      {onCreate ? (
        <li>
          <button type="button" className="goals-node-add" onClick={onCreate}>{createLabel}</button>
        </li>
      ) : null}
    </ul>
  );
}

function readMessage(error: unknown, fallback: string): string {
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return fallback;
}
