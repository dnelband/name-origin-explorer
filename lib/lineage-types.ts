export type GroupMember = {
  id: string;
  label: string;
  language: string | null;
};

export type TreeNode = {
  id: string;
  label: string;
  nativeLabel: string | null;
  language: string | null;
  gender: string | null;
  wikidataQid: string | null;
  depth: number;
  parentId: string | null;
  kind?: "name" | "group";
  members?: GroupMember[];
};

export type TreeEdge = {
  source: string;
  target: string;
};

export type LineageTree = {
  rootId: string;
  nodes: TreeNode[];
  edges: TreeEdge[];
  budget?: {
    ancestorDepth: number;
    descendantDepth: number;
    orientation: "horizontal" | "vertical";
  };
};

export type FeaturedRoot = {
  id: string;
  label: string;
};
