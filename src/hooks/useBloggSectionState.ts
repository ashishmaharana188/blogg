import { useState, useCallback } from "react";

export default function useNotesSectionState() {
  // Local Memory Arrays instead of Database Fetches
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

  const updatePosition = useCallback((id: string, x: number, y: number) => {
    setPositions((prev) => ({ ...prev, [id]: { x, y } }));
  }, []);

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

  const handleDeleteStack = () => {};
  const handleOpenGroup = (groupId: string) => setActiveGroupId(groupId);
  const handleDeleteGroup = () => {};
  const handleDeleteNote = () => {};
  const renameStack = () => {};
  const renameGroup = () => {};
  const createGroup = () => {};

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
