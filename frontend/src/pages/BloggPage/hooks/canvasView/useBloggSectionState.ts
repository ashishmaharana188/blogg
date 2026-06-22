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

  const [positions, setPositions] = useState<
    Record<string, { x: number; y: number }>
  >({});
  const [groups, setGroups] = useState<any[]>([]);
  const [zIndexes, setZIndexes] = useState<Record<string, number>>({});

  const [currentBlogg, setCurrentBlogg] = useState<any[]>([]);

  const [canvasScale, setCanvasScale] = useState(1);
  const [isCreatingStack, setIsCreatingStack] = useState(false);
  const [draftStackName, setDraftStackName] = useState("");
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);

  const updatePosition = useCallback(
    (id: string, pos: { x: number; y: number }) => {
      setPositions((prev) => ({ ...prev, [id]: pos }));
    },
    [],
  );

  const bringToFront = useCallback((id: string) => {
    setZIndexes((prev) => {
      const maxZ = Math.max(0, ...Object.values(prev));
      return { ...prev, [id]: maxZ + 1 };
    });
  }, []);

  const createStackHandler = useCallback(async (stack_name: string) => {
    if (!stack_name.trim()) return;

    const stack = {
      stack_id: crypto.randomUUID(),
      stack_name,
    };

    const savedStack = await createStack(stack);
    setStacks((prev) => [...prev, savedStack]);
    setPositions((prev) => ({
      ...prev,
      [savedStack.stack_id]: { x: 400, y: 300 },
    }));
  }, []);

  //useEffect to load group and stack data from mongo

  function estimateStackHeight(stackId: string, groups: any[]): number {
    const STACK_HEADER_HEIGHT = 180;
    const GROUP_CARD_HEIGHT = 35;

    const stackGroups = groups.filter((group) => group.stack_id === stackId);
    const stackGroupLength = stackGroups.length;

    return STACK_HEADER_HEIGHT + stackGroupLength * GROUP_CARD_HEIGHT;
  }

  function canvasStackPosition(stacks: any[], groups: any[]) {
    //final value
    const generatePositions: Record<string, { x: number; y: number }> = {};

    const rowHeights: Record<number, number> = {};
    //row max height-1
    stacks.forEach((stack, index) => {
      const row = Math.floor(index / 5);

      const estimatedHeight = estimateStackHeight(stack.stack_id, groups);
      //phase1
      rowHeights[row] = Math.max(rowHeights[row] || 0, estimatedHeight);
    });

    //row start-2
    const rowStartPositions: Record<number, number> = {};

    let currentY = 50;
    //rowGap-3
    const ROW_GAP = 100;
    //phase2
    Object.keys(rowHeights).forEach((row) => {
      const rowNumber = Number(row);
      rowStartPositions[rowNumber] = currentY;
      currentY += rowHeights[rowNumber] + ROW_GAP;
    });
    //phase3
    stacks.forEach((stack, index) => {
      const column = index % 5;
      const x = 20 + column * 650;

      const row = Math.floor(index / 5);
      const y = rowStartPositions[row];

      generatePositions[stack.stack_id] = {
        x,
        y,
      };
    });

    return generatePositions;
  }

  useEffect(() => {
    const loadCanvas = async () => {
      try {
        const data = await fetchStackAndGroup();
        console.log("FETCHED DATA", data);
        console.log("STACKS", data.stacks);
        console.log("GROUPS", data.groups);
        setStacks(data.stacks);
        setGroups(data.groups);
        setPositions(canvasStackPosition(data.stacks, data.groups));
      } catch (err) {
        console.error(err);
      }
    };

    loadCanvas();
  }, []);

  const handleDeleteStack = useCallback(async (stackId: string) => {
    await deleteStackRequest({
      stack_id: stackId,
    });

    setStacks((prev) => prev.filter((s) => s.stack_id !== stackId));

    setGroups((prev) => prev.filter((g) => g.stack_id !== stackId));
  }, []);

  const renameStack = useCallback(
    async (stackId: string, newStackName: string) => {
      await renameStackRequest({
        stack_id: stackId,
        stack_name: newStackName,
      });
      setStacks((prev) =>
        prev.map((stack) =>
          stack.stack_id === stackId
            ? { ...stack, stack_name: newStackName }
            : stack,
        ),
      );
    },
    [],
  );

  const createGroupHandler = useCallback(
    async (groupName: string, stackId: string) => {
      const group = {
        group_id: crypto.randomUUID(),
        stack_id: stackId,
        group_name: groupName,
      };

      await createGroup(group);

      setGroups((prev) => [...prev, group]);
    },
    [],
  );

  const handleDeleteGroup = useCallback(async (groupId: string) => {
    await deleteGroupRequest({
      group_id: groupId,
    });
    setGroups((prev) => prev.filter((g) => g.group_id !== groupId));
  }, []);

  const renameGroup = useCallback(
    async (groupId: string, newGroupName: string) => {
      await renameGroupRequest({
        group_id: groupId,
        group_name: newGroupName,
      });

      setGroups((prev) =>
        prev.map((group) =>
          group.group_id === groupId
            ? { ...group, group_name: newGroupName }
            : group,
        ),
      );
    },
    [],
  );

  const handleOpenGroup = useCallback(
    async (groupId: string) => {
      const isClosing = activeGroupId === groupId;

      if (isClosing) {
        setActiveGroupId(null);
        setCurrentBlogg([]);
        return;
      }

      setActiveGroupId(groupId);

      const bloggs = await fetchBloggByGroupRequest({
        group_id: groupId,
      });

      setCurrentBlogg(bloggs);
    },
    [activeGroupId],
  );

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
