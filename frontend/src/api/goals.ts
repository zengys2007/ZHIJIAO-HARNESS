import { ApiRequestError, DisconnectError, ID, request } from "./http";
import type {
  GoalNode,
  GoalTree,
  GoalsApi,
} from "../types/goals";

export const defaultGoalsApi: GoalsApi = {
  listGoalTrees: async (filter) => {
    const params = new URLSearchParams();
    if (filter.subject) params.set("subject", filter.subject);
    if (filter.grade !== undefined) params.set("grade", String(filter.grade));
    if (filter.term) params.set("term", filter.term);
    const query = params.toString();
    const body = await request(`/api/goal-trees${query ? `?${query}` : ""}`);
    const record = recordOf(body) as { trees?: unknown };
    return Array.isArray(record.trees) ? record.trees.map(readTree) : [];
  },
  createGoalTree: async (input) => readTree(await request("/api/goal-trees", {
    method: "POST",
    body: JSON.stringify(input),
  })),
  getGoalTree: async (treeId) => {
    const body = await request(`/api/goal-trees/${treeId}`);
    const record = recordOf(body);
    const nodes = record.nodes;
    if (!Array.isArray(nodes)) throw malformed();
    return { tree: readTree(record.tree), nodes: nodes.map(readNode) };
  },
  renameGoalTree: async (treeId, title) => readTree(await request(`/api/goal-trees/${treeId}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  })),
  deleteGoalTree: async (treeId) => {
    await request(`/api/goal-trees/${treeId}`, { method: "DELETE" });
  },
  createGoalNode: async (treeId, input) => readNode(await request(`/api/goal-trees/${treeId}/nodes`, {
    method: "POST",
    body: JSON.stringify(input),
  })),
  updateGoalNode: async (nodeId, input) => readNode(await request(`/api/goal-nodes/${nodeId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  })),
  deleteGoalNode: async (nodeId) => {
    await request(`/api/goal-nodes/${nodeId}`, { method: "DELETE" });
  },
  reorderGoalNode: async (nodeId, direction) => {
    await request(`/api/goal-nodes/${nodeId}/reorder`, {
      method: "POST",
      body: JSON.stringify({ direction }),
    });
  },
};

function readTree(value: unknown): GoalTree {
  const r = recordOf(value);
  if (typeof r.tree_id !== "string" || !ID.test(r.tree_id)) throw malformed();
  return {
    tree_id: r.tree_id,
    subject: typeof r.subject === "string" ? r.subject : "",
    grade: typeof r.grade === "number" ? r.grade : 0,
    term: typeof r.term === "string" ? r.term : "",
    title: typeof r.title === "string" ? r.title : "",
    created_at: typeof r.created_at === "string" ? r.created_at : "",
    updated_at: typeof r.updated_at === "string" ? r.updated_at : "",
  };
}

function readNode(value: unknown): GoalNode {
  const r = recordOf(value);
  if (typeof r.node_id !== "string" || !ID.test(r.node_id)) throw malformed();
  const level = r.level;
  if (level !== "semester" && level !== "unit" && level !== "lesson") throw malformed();
  return {
    node_id: r.node_id,
    tree_id: typeof r.tree_id === "string" ? r.tree_id : "",
    parent_id: typeof r.parent_id === "string" ? r.parent_id : null,
    level,
    title: typeof r.title === "string" ? r.title : "",
    description: typeof r.description === "string" ? r.description : "",
    standard_refs: Array.isArray(r.standard_refs) ? r.standard_refs.filter((x): x is string => typeof x === "string") : [],
    verify_criteria: typeof r.verify_criteria === "string" ? r.verify_criteria : "",
    sort_order: typeof r.sort_order === "number" ? r.sort_order : 0,
    created_at: typeof r.created_at === "string" ? r.created_at : "",
    updated_at: typeof r.updated_at === "string" ? r.updated_at : "",
  };
}

function recordOf(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") throw malformed();
  return value as Record<string, unknown>;
}

function malformed(): ApiRequestError {
  return new ApiRequestError("internal", "系统出错了，可以再发一次。", true, 200);
}

export { ApiRequestError, DisconnectError };
