import { useState, useCallback, useEffect } from "react";
import {
  createGroup,
  createStack,
  renameStackRequest,
  renameGroupRequest,
  deleteStackRequest,
  deleteGroupRequest,
  fetchBloggByGroupRequest,
} from "../../services/canvasViewService";
import { fetchStackAndGroup } from "../../services/canvasViewService";

export default function useBloggSectionState() {
  const [stacks, setStacks] = useState<any[]>([]);
  const [positions, setPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [groups, setGroups] = useState<any[]>([]);
  const [zIndexes, setZIndexes] = useState<Record<string, number>>({});
  const [currentBlogg, setCurrentBlogg] = useState<any[]>([]);
  const [canvasScale, setCanvasScale] = useState(1);
  const [isCreatingStack, setIsCreatingStack] = useState(false);
  const [draftStackName, setDraftStackName] = useState("");
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);

  const updatePosition = useCallback((id: string, pos: { x: number; y: number }) => {
    setPositions((prev) => ({ ...prev, [id]: pos }));
  }, []);

  const bringToFront = useCallback((id: string) => {
    setZIndexes((prev) => {
      const maxZ = Math.max(0, ...Object.values(prev));
      return { ...prev, [id]: maxZ + 1 };
    });
  }, []);

  const createStackHandler = useCallback(async (stack_name: string) => {
    if (!stack_name.trim()) return;
    const stack = { stack_id: crypto.randomUUID(), stack_name };
    const savedStack = await createStack(stack);
    setStacks((prev) => [...prev, savedStack]);
    setPositions((prev) => ({ ...prev, [savedStack.stack_id]: { x: 400, y: 300 } }));
  }, []);

  function estimateStackHeight(stackId: string, groupsForCanvas: any[]): number {
    const STACK_HEADER_HEIGHT = 180;
    const GROUP_CARD_HEIGHT = 35;
    return STACK_HEADER_HEIGHT +
      groupsForCanvas.filter((group) => group.stack_id === stackId).length * GROUP_CARD_HEIGHT;
  }

  function canvasStackPosition(stacksForCanvas: any[], groupsForCanvas: any[]) {
    const generated: Record<string, { x: number; y: number }> = {};
    const rowHeights: Record<number, number> = {};
    stacksForCanvas.forEach((stack, index) => {
      const row = Math.floor(index / 3);
      rowHeights[row] = Math.max(rowHeights[row] || 0, estimateStackHeight(stack.stack_id, groupsForCanvas));
    });
    const rowStartPositions: Record<number, number> = {};
    let currentY = 50;
    const ROW_GAP = 100;
    Object.keys(rowHeights).forEach((row) => {
      const rowNumber = Number(row);
      rowStartPositions[rowNumber] = currentY;
      currentY += rowHeights[rowNumber] + ROW_GAP;
    });
    stacksForCanvas.forEach((stack, index) => {
      const column = index % 3;
      const row = Math.floor(index / 3);
      generated[stack.stack_id] = { x: 20 + column * 650, y: rowStartPositions[row] };
    });
    return generated;
  }

  useEffect(() => {
    let mounted = true;
    const loadCanvas = async () => {
      try {
        const data = await fetchStackAndGroup();
        if (!mounted) return;
        const loadedStacks = Array.isArray(data.stacks) ? data.stacks : [];
        const loadedGroups = Array.isArray(data.groups) ? data.groups : [];
        setStacks(loadedStacks);
        setGroups(loadedGroups);
        setPositions(canvasStackPosition(loadedStacks, loadedGroups));
      } catch (err) {
        console.error("Could not load Folder view:", err);
      }
    };
    loadCanvas();
    return () => {
      mounted = false;
    };
  }, []);

  const handleDeleteStack = useCallback(async (stackId: string) => {
    await deleteStackRequest({ stack_id: stackId });
    setStacks((prev) => prev.filter((stack) => stack.stack_id !== stackId));
    setGroups((prev) => prev.filter((group) => group.stack_id !== stackId));
  }, []);

  const renameStack = useCallback(async (stackId: string, newStackName: string) => {
    await renameStackRequest({ stack_id: stackId, stack_name: newStackName });
    setStacks((prev) => prev.map((stack) =>
      stack.stack_id === stackId ? { ...stack, stack_name: newStackName } : stack,
    ));
  }, []);

  const createGroupHandler = useCallback(async (groupName: string, stackId: string) => {
    if (!groupName.trim()) return;
    const group = {
      group_id: crypto.randomUUID(),
      stack_id: stackId,
      group_name: groupName.trim(),
    };
    const savedGroup = await createGroup(group);
    setGroups((prev) => [...prev, savedGroup ?? group]);
  }, []);

  const handleDeleteGroup = useCallback(async (groupId: string) => {
    await deleteGroupRequest({ group_id: groupId });
    setGroups((prev) => prev.filter((group) => group.group_id !== groupId));
    if (activeGroupId === groupId) {
      setActiveGroupId(null);
      setCurrentBlogg([]);
    }
  }, [activeGroupId]);

  const renameGroup = useCallback(async (groupId: string, newGroupName: string) => {
    await renameGroupRequest({ group_id: groupId, group_name: newGroupName });
    setGroups((prev) => prev.map((group) =>
      group.group_id === groupId ? { ...group, group_name: newGroupName } : group,
    ));
  }, []);

  const handleOpenGroup = useCallback(async (groupId: string) => {
    if (activeGroupId === groupId) {
      setActiveGroupId(null);
      setCurrentBlogg([]);
      return;
    }
    setActiveGroupId(groupId);
    try {
      const bloggs = await fetchBloggByGroupRequest({ group_id: groupId });
      setCurrentBlogg(bloggs);
    } catch (error) {
      console.error("Could not fetch folder notes:", error);
      setCurrentBlogg([]);
    }
  }, [activeGroupId]);

  const handleDeleteNote = useCallback(() => {
    console.log("Delete Note Logic Pending DB Implementation");
  }, []);

  return {
    stacks,
    groups,
    positions,
    zIndexes,
    canvasScale,
    setCanvasScale,
    isCreatingStack,
    setIsCreatingStack,
    draftStackName,
    setDraftStackName,
    activeGroupId,
    updatePosition,
    bringToFront,
    createStackHandler,
    handleDeleteStack,
    handleOpenGroup,
    handleDeleteGroup,
    handleDeleteNote,
    renameStack,
    renameGroup,
    createGroupHandler,
    currentBlogg,
  };
}
