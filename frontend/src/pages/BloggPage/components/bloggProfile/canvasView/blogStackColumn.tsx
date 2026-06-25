import React, { useState, useEffect, useRef } from "react";
import { IonIcon } from "@ionic/react";
import { addOutline, createOutline } from "ionicons/icons";
import GroupDivider from "./bloggGroupDivider";
import GroupCard from "./bloggGroupCard";
import useIsTouchDevice from "../../../hooks/canvasView/useIsTouchDevice";
import { BloggGroup, BloggStackColumnProps } from "./bloggCanvasType";

const BloggStackColumn = React.memo(
  ({
    stack,
    groups,
    activeGroupId,
    currentBlogg,
    initialPos,
    zIndex,
    scale,
    bringToFront,
    onDragEnd,
    onCreateGroup,
    onDeleteStack,
    onOpenGroup,
    onInitiateCreateBlog,
    onOpenBlogg,
    onDeleteGroup,
    onDeleteBlogg,
    onRenameStack,
    onRenameGroup,
    isHighlighted,
    highlightedGroupId,
    interactionReduced,
  }: BloggStackColumnProps) => {
    const isTouchDevice = useIsTouchDevice();
    const [isCreatingGroup, setIsCreatingGroup] = useState(false);
    const [groupName, setGroupName] = useState("");
    const [localPos, setLocalPos] = useState(initialPos || { x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const dragRef = useRef({ startX: 0, startY: 0, x: 0, y: 0 });
    const stackRef = useRef<HTMLDivElement | null>(null);
    const positionFrameRef = useRef<number | null>(null);

    const currentPos = useRef(initialPos || { x: 0, y: 0 });

    const [isRenamingStack, setIsRenamingStack] = useState(false);
    const [editStackName, setEditStackName] = useState(stack.stack_name);

    const applyPosition = React.useCallback(
      (nextPos: { x: number; y: number }) => {
        if (!stackRef.current) return;
        stackRef.current.style.transform = `translate3d(${nextPos.x}px, ${nextPos.y}px, 0)`;
      },
      [],
    );

    const schedulePosition = React.useCallback(() => {
      if (positionFrameRef.current !== null) return;
      positionFrameRef.current = window.requestAnimationFrame(() => {
        positionFrameRef.current = null;
        applyPosition(currentPos.current);
      });
    }, [applyPosition]);

    useEffect(() => {
      if (initialPos) {
        setLocalPos(initialPos);
        currentPos.current = initialPos;
        applyPosition(initialPos);
      }
    }, [applyPosition, initialPos]);

    useEffect(() => {
      return () => {
        if (positionFrameRef.current !== null) {
          window.cancelAnimationFrame(positionFrameRef.current);
        }
      };
    }, []);

    const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      e.stopPropagation();
      bringToFront(stack.stack_id);
      setIsDragging(true);
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        x: localPos.x,
        y: localPos.y,
      };
    };

    useEffect(() => {
      const handlePointerMove = (e: PointerEvent) => {
        if (!isDragging) return;
        const dx = (e.clientX - dragRef.current.startX) / scale;
        const dy = (e.clientY - dragRef.current.startY) / scale;
        const newPos = {
          x: dragRef.current.x + dx,
          y: dragRef.current.y + dy,
        };

        currentPos.current = newPos;
        schedulePosition();
      };
      const handlePointerUp = () => {
        if (isDragging) {
          setIsDragging(false);
          setLocalPos(currentPos.current);
          onDragEnd(stack.stack_id, currentPos.current);
        }
      };
      if (isDragging) {
        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", handlePointerUp);
      }
      return () => {
        window.removeEventListener("pointermove", handlePointerMove);
        window.removeEventListener("pointerup", handlePointerUp);
      };
    }, [isDragging, onDragEnd, scale, schedulePosition, stack.stack_id]);

    const reducedVisuals = interactionReduced || isDragging;
    const coverButtonVisibility = isTouchDevice
      ? "opacity-100"
      : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100";

    const groupMap = new Map<string, BloggGroup[]>();
    [...groups]
      .sort((a, b) => a.group_name.localeCompare(b.group_name))
      .forEach((g) => {
        const c = (g.group_name.charAt(0) || "#").toUpperCase();
        if (!groupMap.has(c)) groupMap.set(c, []);
        groupMap.get(c)!.push(g);
      });

    const handleUploadCover = async (
      e: React.ChangeEvent<HTMLInputElement>,
      stackId: string,
    ) => {
      if (!e.target.files || !e.target.files[0] || !stackId) return;
      // 2. Local Stub: Replaced the backend fetch call
      console.log(
        `[Local Mode] Upload requested for stack ${stackId}, but backend is disabled.`,
      );
    };

    let z = 10;
    const els: React.ReactNode[] = [];
    Array.from(groupMap.entries()).forEach(([char, charGroups]) => {
      els.push(<GroupDivider key={char} char={char} zIndex={z} />);
      z++;

      charGroups.forEach((g, i) => {
        console.log("GROUP CHECK", {
          activeGroupId,
          groupId: g.group_id,
          currentBlogg,
          passedBloggs: activeGroupId === g.group_id ? currentBlogg : [],
        });
        els.push(
          <GroupCard
            key={g.group_id}
            group={g}
            zIndex={z}
            stagger={i % 2 === 0 ? -10 : 10}
            isActive={activeGroupId === g.group_id}
            bloggs={activeGroupId === g.group_id ? currentBlogg : []}
            onOpen={() => onOpenGroup(g.group_id)}
            onInitiateCreateBlog={() =>
              onInitiateCreateBlog(
                g.stack_id,

                g.group_id,
              )
            }
            onOpenBlogg={onOpenBlogg}
            onDeleteGroup={onDeleteGroup}
            onDeleteBlogg={onDeleteBlogg}
            onRenameGroup={onRenameGroup}
            isHighlighted={highlightedGroupId === g.group_id}
            interactionReduced={reducedVisuals}
          />,
        );
        z++;
      });
      els.push(<div key={`spacer-${char}`} className="w-full" />);
    });

    return (
      <div
        ref={stackRef}
        id={stack.stack_id}
        className={`no-pan absolute flex flex-col items-center w-[650px] pb-32 ${
          !isDragging ? "transition-transform duration-300" : "transition-none"
        } ${isDragging ? "z-[9999]" : ""} ${isHighlighted ? "z-[9999]" : ""} ${
          reducedVisuals ? "canvas-interaction-reduced" : ""
        }`}
        style={{
          left: 0,
          top: 0,
          transform: `translate3d(${localPos.x}px, ${localPos.y}px, 0)`,
          willChange: "transform",
          contain: "layout style",
          backfaceVisibility: "hidden",
          zIndex: isDragging || isHighlighted ? 9999 : zIndex,
        }}
        onPointerDown={(e) => {
          e.stopPropagation();
          bringToFront(stack.stack_id);
        }}
      >
        <div
          className={`group relative mb-8 flex w-[600px] flex-col gap-4 rounded-xl border bg-white/95 p-4 transition-[box-shadow,border-color,transform] duration-300 shadow-xl ${
            isHighlighted
              ? "border-black shadow-[0_0_40px_rgba(59,130,246,0.4)] scale-[1.03]"
              : "border-gray-300"
          } ${isDragging ? "shadow-2xl cursor-grabbing" : "cursor-grab"}`}
          onPointerDown={handlePointerDown}
          style={{ touchAction: "none" }}
        >
          <div className="flex justify-between items-center border-b border-gray-300 pb-2 relative pointer-events-none">
            <div className="flex items-center gap-2 p-1.5 text-muted rounded-md">
              <svg
                className="w-1 h-1"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M4 8h16M4 16h16"
                />
              </svg>
            </div>

            <div
              className={`absolute -top-1 right-135 z-50 pointer-events-auto transition-opacity ${coverButtonVisibility}`}
            >
              <label
                className="no-pan cursor-pointer bg-black/50 hover:bg-black/70 text-white p-1.5 rounded-full shadow-sm transition-colors flex items-center justify-center"
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <input
                  type="file"
                  className="hidden"
                  accept="image/*,video/*,audio/*"
                  onChange={(e) => handleUploadCover(e, stack.stack_id)}
                  onClick={(e) => e.stopPropagation()}
                />
                <IonIcon icon={addOutline} className="w-4 h-4" />
              </label>
            </div>
            {isRenamingStack ? (
              <div className="absolute left-10 flex gap-2 items-center pointer-events-auto z-10 w-3/4">
                <input
                  type="text"
                  value={editStackName}
                  onChange={(e) => setEditStackName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      onRenameStack(stack.stack_id, editStackName);
                      setIsRenamingStack(false);
                    }
                    if (e.key === "Escape") {
                      setIsRenamingStack(false);
                      setEditStackName(stack.stack_name);
                    }
                  }}
                  className="w-full p-1 text-lg font-bold border border-gray-400 rounded focus:outline-none pointer-events-auto bg-white"
                  autoFocus
                  onPointerDown={(e) => e.stopPropagation()}
                />
                <button
                  onClick={() => {
                    setIsRenamingStack(false);
                    setEditStackName(stack.stack_name);
                  }}
                  className="text-xs text-muted pointer-events-auto"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="absolute left-10 flex items-center gap-2 group/stack pointer-events-auto">
                <h3
                  className="typewriter-font
                  font-extrabold text-xl text-primary tracking-tight cursor-pointer hover:text-black transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsRenamingStack(true);
                    setEditStackName(stack.stack_name);
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  title="Click to rename"
                >
                  {stack.stack_name}
                </h3>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsRenamingStack(true);
                    setEditStackName(stack.stack_name);
                  }}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="text-gray-400 hover:text-black opacity-0 group-hover/stack:opacity-100 transition-opacity"
                >
                  <IonIcon icon={createOutline} className="w-4 h-4" />
                </button>
              </div>
            )}

            <div className="flex gap-2 pointer-events-auto">
              <button
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteStack(stack.stack_id);
                }}
                className="text-gray-400 hover:text-red-500 transition"
                title="Delete Stack"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
              </button>
            </div>
          </div>

          {isCreatingGroup ? (
            <div
              className="flex gap-2"
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <input
                autoFocus
                type="text"
                placeholder="Folder Name..."
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    onCreateGroup(groupName, stack.stack_id);
                    setIsCreatingGroup(false);
                    setGroupName("");
                  }
                }}
                className="flex-1 p-2 text-sm border border-gray-300 rounded focus:outline-none focus:border-gray-900 font-bold"
              />
              <button
                onClick={() => setIsCreatingGroup(false)}
                className="px-2 text-xs font-bold text-muted hover:text-primary"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  onCreateGroup(groupName, stack.stack_id);
                  setIsCreatingGroup(false);
                  setGroupName("");
                }}
                className="px-3 text-xs font-bold bg-black text-accent-text rounded hover:bg-black"
              >
                Save
              </button>
            </div>
          ) : (
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => setIsCreatingGroup(true)}
              className="typewriter-font w-full py-2 bg-gray-100 hover:bg-gray-200 border border-gray-300 text-gray-700 text-sm font-bold rounded transition border-dashed"
            >
              + New Folder
            </button>
          )}
        </div>
        <div
          className="flex flex-col items-center w-full cursor-auto"
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {els.length > 0 ? (
            els
          ) : (
            <div className="text-gray-400 font-mono text-xs italic mt-8">
              [ EMPTY STACK ]
            </div>
          )}
        </div>
      </div>
    );
  },
);

export default BloggStackColumn;
