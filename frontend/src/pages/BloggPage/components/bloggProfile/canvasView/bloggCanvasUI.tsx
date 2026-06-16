import React from "react";
import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";
import { IonIcon } from "@ionic/react";
import {
  addOutline,
  checkmarkOutline,
  closeOutline,
  folderOpenOutline,
  removeOutline,
  scanOutline,
} from "ionicons/icons";

import AutoZoomTrigger from "./autoZoomTrigger";
import NoteStackColumn from "./blogStackColumn";
import useBloggSectionState from "../../../hooks/canvasView/useBloggSectionState";
import useCanvasViewport from "../../../hooks/canvasView/useCanvasViewport";
import useCanvasInteractionMode from "../../../hooks/canvasView/useCanvasInteractionMode";

const NOTE_STACK_WIDTH = 650;
const NOTE_STACK_HEIGHT = 2600;

export default function BloggCanvasUI({
  onOpenForm,
}: {
  onOpenForm?: (stackId: string, groupId: string, bloggId?: string) => void;
}) {
  const state = useBloggSectionState();
  const { isInteracting, startInteraction, settleInteraction } =
    useCanvasInteractionMode(140);
  const { canvasScale, syncViewport, isRectVisible } = useCanvasViewport({
    initialScale: 1,
    initialPositionX: 0,
    initialPositionY: 0,
    buffer: 1800,
  });

  const visibleStacks = React.useMemo(
    () =>
      (state.stacks || []).filter((stack: any) => {
        const position = state.positions[stack.stack_id] || { x: 100, y: 150 };
        return isRectVisible({
          x: position.x,
          y: position.y,
          width: NOTE_STACK_WIDTH,
          height: NOTE_STACK_HEIGHT,
        });
      }),
    [isRectVisible, state.positions, state.stacks],
  );

  const groupsByStackId = React.useMemo(() => {
    const grouped = new Map<string, any[]>();
    (state.groups || []).forEach((group: any) => {
      const key = String(group.stack_id || "");
      const existing = grouped.get(key);
      if (existing) {
        existing.push(group);
      } else {
        grouped.set(key, [group]);
      }
    });
    return grouped;
  }, [state.groups]);

  const handleViewportUpdate = React.useCallback(
    (ref: any) => {
      syncViewport(ref);
      state.setCanvasScale(ref?.state?.scale || 1);
    },
    [state.setCanvasScale, syncViewport],
  );

  return (
    <div className="absolute inset-0 bg-[#f8f9fa] overflow-hidden font-sans">
      <TransformWrapper
        initialScale={1}
        initialPositionX={0}
        initialPositionY={0}
        minScale={0.1}
        maxScale={3}
        limitToBounds={false}
        centerZoomedOut={false}
        // 1. Restored standard wheel mechanics now that the math bug is fixed
        wheel={{
          step: 0.001,
        }}
        panning={{ excluded: ["no-pan"] }}
        onInit={handleViewportUpdate}
        onWheelStart={() => startInteraction()}
        onWheelStop={(ref) => {
          handleViewportUpdate(ref);
          settleInteraction();
        }}
        onPanningStart={() => startInteraction()}
        onPanningStop={(ref) => {
          handleViewportUpdate(ref);
          settleInteraction();
        }}
        onZoomStart={() => startInteraction()}
        onZoomStop={(ref) => {
          handleViewportUpdate(ref);
          settleInteraction();
        }}
      >
        {({ zoomIn, zoomOut, zoomToElement }) => (
          <React.Fragment>
            <AutoZoomTrigger
              targetId={null}
              zoomToElement={zoomToElement}
              onZoomed={() => {}}
            />

            <TransformComponent
              wrapperStyle={{
                width: "100%",
                height: "100%",
                position: "absolute",
                top: 0,
                left: 0,
              }}
              // 2. CRITICAL FIX: Forces the internal engine bounding box to map to the screen
              contentStyle={{
                width: "100%",
                height: "100%",
              }}
            >
              {/* 3. CRITICAL FIX: Replaced w-0 h-0 with w-full h-full to stop division-by-zero */}
              <div
                className={`relative w-full h-full ${isInteracting ? "canvas-interaction-reduced" : ""}`}
              >
                <div
                  className="absolute pointer-events-none opacity-40"
                  style={{
                    left: -5000,
                    top: -5000,
                    width: "10000px",
                    height: "10000px",
                    backgroundImage:
                      "radial-gradient(#d1d5db 1px, transparent 1px)",
                    backgroundSize: "24px 24px",
                  }}
                />

                {/* 4. CRITICAL FIX: Replaced w-0 h-0 with w-full h-full */}
                <div
                  id="canvas-container"
                  className="absolute left-0 top-0 z-10 w-full h-full"
                >
                  {!state.stacks || state.stacks.length === 0 ? (
                    <div className="absolute top-[200px] left-[100px] text-slate-500 font-mono text-sm bg-white/80 px-6 py-2 rounded-lg border border-slate-300 shadow-sm whitespace-nowrap">
                      [ NO STACKS FOUND. CREATE ONE TO START YOUR WORKSPACE. ]
                    </div>
                  ) : (
                    visibleStacks.map((stack: any) => (
                      <NoteStackColumn
                        key={stack.stack_id}
                        stack={stack}
                        groups={
                          groupsByStackId.get(String(stack.stack_id)) || []
                        }
                        activeGroupId={state.activeGroupId}
                        currentNotes={state.currentNotes}
                        initialPos={
                          state.positions[stack.stack_id] || { x: 100, y: 150 }
                        }
                        zIndex={state.zIndexes[stack.stack_id] || 10}
                        scale={canvasScale}
                        bringToFront={state.bringToFront}
                        onDragEnd={state.updatePosition}
                        onCreateGroup={state.createGroup}
                        onDeleteStack={state.handleDeleteStack}
                        onOpenGroup={state.handleOpenGroup}
                        onInitiateCreateNote={(
                          stackId: string,
                          groupId: string,
                        ) => {
                          if (onOpenForm) onOpenForm(stackId, groupId);
                        }}
                        onOpenNote={(blog: any) => {
                          if (onOpenForm)
                            onOpenForm(
                              blog.stack_id,
                              blog.group_id,
                              blog.blog_id,
                            );
                        }}
                        onDeleteGroup={state.handleDeleteGroup}
                        onDeleteNote={state.handleDeleteNote}
                        onRenameStack={state.renameStack}
                        onRenameGroup={state.renameGroup}
                        isHighlighted={false}
                        highlightedGroupId={null}
                        interactionReduced={isInteracting}
                      />
                    ))
                  )}
                </div>
              </div>
            </TransformComponent>

            <div className="absolute bottom-6 left-6 z-[100] flex flex-col gap-1 rounded-lg border border-slate-200 bg-white/95 p-1.5 shadow-sm pointer-events-auto">
              <button
                onClick={() => zoomIn(0.2)}
                className="p-2 text-slate-600 hover:text-black hover:bg-slate-100 rounded-md transition-colors"
              >
                <IonIcon icon={addOutline} className="w-5 h-5" />
              </button>
              <div className="text-[10px] font-mono font-bold text-center text-slate-500 py-1 border-y border-slate-100 w-full">
                {Math.round(canvasScale * 100)}%
              </div>
              <button
                onClick={() => zoomOut(0.2)}
                className="p-2 text-slate-600 hover:text-black hover:bg-slate-100 rounded-md transition-colors"
              >
                <IonIcon icon={removeOutline} className="w-5 h-5" />
              </button>
              <button
                onClick={() => zoomToElement("canvas-container", 1, 600)}
                className="p-2 text-slate-600 hover:text-black hover:bg-slate-100 rounded-md transition-colors mt-1 border-t border-slate-100 flex flex-col items-center justify-center"
              >
                <IonIcon icon={scanOutline} className="w-5 h-5" />
              </button>
            </div>
          </React.Fragment>
        )}
      </TransformWrapper>

      <div className="absolute right-6 top-6 z-[2000] pointer-events-auto flex gap-4 items-start">
        {state.isCreatingStack ? (
          <div className="bg-white/95 p-4 rounded-lg shadow-xl border border-slate-400 flex flex-col gap-2">
            <input
              autoFocus
              type="text"
              placeholder="Stack Name..."
              value={state.draftStackTitle}
              onChange={(e) => state.setDraftStackTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  state.createStack(state.draftStackTitle);
                  state.setIsCreatingStack(false);
                  state.setDraftStackTitle("");
                }
              }}
              className="p-2 border border-slate-300 rounded focus:outline-none focus:border-slate-900 text-sm font-bold bg-transparent"
            />
            <div className="flex justify-end gap-2 mt-1">
              <button
                onClick={() => state.setIsCreatingStack(false)}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-slate-100"
              >
                <IonIcon icon={closeOutline} className="h-4 w-4" />
              </button>
              <button
                onClick={() => {
                  state.createStack(state.draftStackTitle);
                  state.setIsCreatingStack(false);
                  state.setDraftStackTitle("");
                }}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-black text-white transition-colors hover:bg-black"
              >
                <IonIcon icon={checkmarkOutline} className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => state.setIsCreatingStack(true)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-white shadow-lg transition hover:bg-black"
          >
            <IonIcon icon={folderOpenOutline} className="h-5 w-5" />
          </button>
        )}
      </div>
    </div>
  );
}
