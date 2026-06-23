export interface BloggGroup {
  group_id: string;
  group_name: string;
  stack_id: string;
  stack_name: string;
}
export interface BloggItem {
  blogg_id: string;
  group_id: string;
  title: string;
  content: string;
}

export interface BloggStack {
  stack_id: string;
  stack_name: string;
}

export interface BloggGroupCardProps {
  group: BloggGroup;
  zIndex: number;
  stagger: number;
  isActive: boolean;
  bloggs: BloggItem[];
  onOpen: () => void;
  onInitiateCreateBlog: () => void;
  onOpenBlogg: (blogg: BloggItem) => void;
  onDeleteGroup: (groupId: string) => void;
  onDeleteBlogg: (noteId: string) => void;
  onRenameGroup: (groupId: string, newTitle: string) => void;
  isHighlighted?: boolean;
  interactionReduced?: boolean;
}

export interface BloggStackColumnProps {
  stack: BloggStack;
  groups: BloggGroup[];
  activeGroupId: string | null;
  currentBlogg: BloggItem[];
  initialPos: { x: number; y: number };
  zIndex: number;
  scale: number;
  bringToFront: (id: string) => void;
  onDragEnd: (id: string, pos: { x: number; y: number }) => void;
  onCreateGroup: (groupName: string, stackId: string) => void;
  onDeleteStack: (stackId: string) => void;

  onOpenGroup: (groupId: string) => void;
  onInitiateCreateBlog: (
    stackId: string,

    groupId: string,
  ) => void;
  onOpenBlogg: (blogg: BloggItem) => void;
  onDeleteGroup: (groupId: string) => void;
  onDeleteBlogg: (noteId: string) => void;
  onRenameStack: (stackId: string, newTitle: string) => void;
  onRenameGroup: (groupId: string, newTitle: string) => void;
  isHighlighted?: boolean;
  highlightedGroupId?: string | null;
  interactionReduced?: boolean;
}
