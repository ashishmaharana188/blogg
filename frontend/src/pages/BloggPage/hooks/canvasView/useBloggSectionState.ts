import { useState, useCallback, useEffect } from "react";
import { createGroup, createStack } from "../../services/canvasViewService";
import { fetchStackAndGroup } from "../../services/canvasViewService";

export default function useBloggSectionState() {
  const [stacks, setStacks] = useState<any[]>([]);

  const [positions, setPositions] = useState<
    Record<string, { x: number; y: number }>
  >({});
  const [groups, setGroups] = useState<any[]>([]);
  const [zIndexes, setZIndexes] = useState<Record<string, number>>({});

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

  useEffect(() => {
    const loadCanvas = async () => {
      try {
        const data = await fetchStackAndGroup();
        console.log("FETCHED DATA", data);
        console.log("STACKS", data.stacks);
        console.log("GROUPS", data.groups);
        setStacks(data.stacks);
        setGroups(data.groups);
        const generatedPositions: Record<string, { x: number; y: number }> = {};

        data.stacks.forEach((stack: any, index: any) => {
          generatedPositions[stack.stack_id] = {
            x: 20 + index * 650,
            y: 50,
          };
        });

        setPositions(generatedPositions);
      } catch (err) {
        console.error(err);
      }
    };

    loadCanvas();
  }, []);

  const handleDeleteStack = useCallback((stackId: string) => {
    setStacks((prev) => prev.filter((s) => s.stack_id !== stackId));
    setGroups((prev) => prev.filter((g) => g.stack_id !== stackId));
  }, []);

  const renameStack = useCallback((stackId: string, newStackName: string) => {
    setStacks((prev) =>
      prev.map((s) =>
        s.stack_id === stackId ? { ...s, stack_name: newStackName } : s,
      ),
    );
  }, []);

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

  const handleDeleteGroup = useCallback((groupId: string) => {
    setGroups((prev) => prev.filter((g) => g.group_id !== groupId));
  }, []);

  const renameGroup = useCallback((groupId: string, newGroupName: string) => {
    setGroups((prev) =>
      prev.map((g) =>
        g.group_id === groupId ? { ...g, group_name: newGroupName } : g,
      ),
    );
  }, []);

  const handleOpenGroup = useCallback((groupId: string) => {
    setActiveGroupId((prev) => (prev === groupId ? null : groupId));
  }, []);

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
    currentNotes: [],
  };
}
