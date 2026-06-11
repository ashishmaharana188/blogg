import { useState, useCallback } from "react";

export default function useBloggSectionState() {
  const [stacks, setStacks] = useState<any[]>([
    { stack_id: "demo-1", title: "Local UI Demo Stack" },
  ]);
  const [groups, setGroups] = useState<any[]>([]);
  const [positions, setPositions] = useState<
    Record<string, { x: number; y: number }>
  >({
    "demo-1": { x: 300, y: 200 },
  });
  const [zIndexes, setZIndexes] = useState<Record<string, number>>({});

  const [canvasScale, setCanvasScale] = useState(1);
  const [isCreatingStack, setIsCreatingStack] = useState(false);
  const [draftStackTitle, setDraftStackTitle] = useState("");
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);

  // FIX: Matches the (id, object) signature fired by the column drag end
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

  const createStack = useCallback((title: string) => {
    if (!title.trim()) return;
    const newId = `stack-${Date.now()}`;
    setStacks((prev) => [...prev, { stack_id: newId, title }]);
    setPositions((prev) => ({ ...prev, [newId]: { x: 400, y: 300 } }));
  }, []);

  const handleDeleteStack = useCallback((stackId: string) => {
    setStacks((prev) => prev.filter((s) => s.stack_id !== stackId));
    setGroups((prev) => prev.filter((g) => g.stack_id !== stackId));
  }, []);

  const renameStack = useCallback((stackId: string, newTitle: string) => {
    setStacks((prev) =>
      prev.map((s) => (s.stack_id === stackId ? { ...s, title: newTitle } : s)),
    );
  }, []);

  const createGroup = useCallback((title: string, stackId: string) => {
    if (!title.trim()) return;
    setGroups((prev) => [
      ...prev,
      { group_id: `group-${Date.now()}`, stack_id: stackId, title },
    ]);
  }, []);

  const handleDeleteGroup = useCallback((groupId: string) => {
    setGroups((prev) => prev.filter((g) => g.group_id !== groupId));
  }, []);

  const renameGroup = useCallback((groupId: string, newTitle: string) => {
    setGroups((prev) =>
      prev.map((g) => (g.group_id === groupId ? { ...g, title: newTitle } : g)),
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
    draftStackTitle,
    setDraftStackTitle,
    activeGroupId,
    updatePosition,
    bringToFront,
    createStack,
    handleDeleteStack,
    handleOpenGroup,
    handleDeleteGroup,
    handleDeleteNote,
    renameStack,
    renameGroup,
    createGroup,
    currentNotes: [],
  };
}
