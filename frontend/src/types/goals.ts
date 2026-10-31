/** 与后端 app/api/goals.py 的 tree_view / node_view 一致。 */

export const GOAL_SUBJECTS = ["语文", "数学", "英语", "物理", "化学", "生物", "历史", "地理", "道德与法治"] as const;
export const GOAL_GRADES = [7, 8, 9] as const;
export const GOAL_TERMS = ["上", "下"] as const;

export type GoalSubject = (typeof GOAL_SUBJECTS)[number];
export type GoalLevel = "semester" | "unit" | "lesson";

export interface GoalTree {
  tree_id: string;
  subject: string;
  grade: number;
  term: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface GoalNode {
  node_id: string;
  tree_id: string;
  parent_id: string | null;
  level: GoalLevel;
  title: string;
  description: string;
  standard_refs: string[];
  verify_criteria: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface GoalTreeDetail {
  tree: GoalTree;
  nodes: GoalNode[];
}

export interface CreateTreeInput {
  subject: string;
  grade: number;
  term: string;
  title: string;
  template_init?: boolean;
}

export interface CreateNodeInput {
  parent_id: string | null;
  level: GoalLevel;
  title: string;
  description?: string;
  verify_criteria?: string;
  standard_refs?: string[];
}

export interface UpdateNodeInput {
  title: string;
  description?: string;
  verify_criteria?: string;
  standard_refs?: string[];
}

export interface GoalsApi {
  listGoalTrees(filter: { subject?: string; grade?: number; term?: string }): Promise<GoalTree[]>;
  createGoalTree(input: CreateTreeInput): Promise<GoalTree>;
  getGoalTree(treeId: string): Promise<GoalTreeDetail>;
  renameGoalTree(treeId: string, title: string): Promise<GoalTree>;
  deleteGoalTree(treeId: string): Promise<void>;
  createGoalNode(treeId: string, input: CreateNodeInput): Promise<GoalNode>;
  updateGoalNode(nodeId: string, input: UpdateNodeInput): Promise<GoalNode>;
  deleteGoalNode(nodeId: string): Promise<void>;
  reorderGoalNode(nodeId: string, direction: "up" | "down"): Promise<void>;
}
