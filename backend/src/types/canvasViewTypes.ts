export interface StackDocument {
  stack_id: string;
  stack_name: string;
}

export interface GroupDocument {
  group_id: string;
  group_name: string;
  stack_id: string;
  created_at?: string;
  updated_at?: string;
}
