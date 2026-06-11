import React, { useState } from "react";
import {
  motion,
  useMotionValue,
  useTransform,
  useAnimation,
} from "framer-motion";
import type { PanInfo } from "framer-motion";

// 1. LOCAL TYPE DEFINITIONS: Replaces the old backend useNotes import
export interface NoteGroup {
  group_id: string;
  stack_id: string;
  title: string;
}
export interface NoteItem {
  note_id: string;
  group_id: string;
  title: string;
  content: string;
}

const TAB_WIDTH = 600;
const TAB_HEIGHT = 65;
const CARD_WIDTH = 590;
const MAX_EXTENSION = 550;
const SNAP_THRESHOLD = 150;
const NEGATIVE_MARGIN = "-35px";
const OPEN_TRANSITION = {
  type: "spring",
  stiffness: 320,
  damping: 30,
  mass: 0.85,
} as const;
const CLOSE_TRANSITION = {
  type: "spring",
  stiffness: 430,
  damping: 38,
  mass: 0.8,
} as const;

interface GroupCardProps {
  group: NoteGroup;
  zIndex: number;
  stagger: number;
  isActive: boolean;
  notes: NoteItem[];
  onOpen: () => void;
  onInitiateCreateNote: () => void;
  onOpenNote: (note: NoteItem) => void;
  onDeleteGroup: (groupId: string) => void;
  onDeleteNote: (noteId: string) => void;
  onRenameGroup: (groupId: string, newTitle: string) => void;
  isHighlighted?: boolean;
  interactionReduced?: boolean;
}

const GroupCard = React.memo(
  ({
    group,
    zIndex,
    stagger,
    isActive,
    notes,
    onOpen,
    onInitiateCreateNote,
    onOpenNote,
    onDeleteGroup,
    onDeleteNote,
    onRenameGroup,
    isHighlighted,
    interactionReduced,
  }: GroupCardProps) => {
    const controls = useAnimation();
    const y = useMotionValue(0);
    const [isDragging, setIsDragging] = useState(false);

    // NEW EDIT STATES
    const [isRenaming, setIsRenaming] = useState(false);
    const [editTitle, setEditTitle] = useState(group.title);

    const cardHeight = useTransform(y, (latestY) => Math.max(0, -latestY));
    const contentOpacity = useTransform(y, [-30, -150], [0, 1]);
    const cardScale = useTransform(y, [-30, -MAX_EXTENSION], [0.98, 1]);
    const activeZ = isDragging || isActive ? 99999 : zIndex;
    const reducedVisuals = interactionReduced || isDragging;

    const handleDragStart = () => setIsDragging(true);
    React.useEffect(() => {
      if (isDragging) return;
      void controls.start({
        y: isActive ? -MAX_EXTENSION : 0,
        transition: isActive ? OPEN_TRANSITION : CLOSE_TRANSITION,
      });
    }, [controls, isActive, isDragging]);

    const handleDragEnd = async (_: any, info: PanInfo) => {
      setIsDragging(false);
      const shouldOpen = y.get() <= -SNAP_THRESHOLD || info.velocity.y < -300;
      if (shouldOpen !== isActive) {
        onOpen();
      }
      await controls.start({
        y: shouldOpen ? -MAX_EXTENSION : 0,
        transition: shouldOpen ? OPEN_TRANSITION : CLOSE_TRANSITION,
      });
    };

    const handleTabClick = () => {
      onOpen();
    };

    return (
      <motion.div
        className="no-pan relative flex justify-center overflow-visible"
        style={{
          width: "100%",
          height: TAB_HEIGHT,
          marginBottom: NEGATIVE_MARGIN,
          zIndex: activeZ,
          x: stagger,
        }}
      >
        <motion.div
          drag="y"
          dragConstraints={{ top: -MAX_EXTENSION, bottom: 0 }}
          dragElastic={0}
          dragMomentum={false}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          animate={controls}
          style={{ y, willChange: "transform" }}
          className={`relative overflow-visible ${reducedVisuals ? "canvas-interaction-reduced" : ""} ${
            !isDragging ? "transition-[filter] duration-100" : "transition-none"
          } ${
            isHighlighted
              ? "drop-shadow-[0_0_25px_rgba(59,130,246,0.8)] scale-[1.02] z-50"
              : ""
          }`}
        >
          <div
            onClick={handleTabClick}
            className="group relative z-10 cursor-pointer active:cursor-grabbing"
            style={{ width: TAB_WIDTH, height: TAB_HEIGHT }}
          >
            <svg
              viewBox="0 0 600 65"
              className="w-full h-full drop-shadow-sm overflow-visible canvas-heavy-shadow"
            >
              <path
                d="M0 65 L0 25 Q0 15, 10 15 L220 15 Q240 15, 250 5 L255 0 H425 Q435 0, 440 5 L445 15 Q455 15, 470 15 L590 15 Q600 15, 600 25 L600 65 Z"
                fill="#F3F4F6"
                stroke="#1F2937"
                strokeWidth="2"
                strokeLinejoin="round"
              />
              <text
                x="280"
                y="14"
                className="fill-gray-900 font-sans font-bold text-[10px] tracking-widest uppercase"
              ></text>
              <text
                x="400"
                y="14"
                textAnchor="end"
                className="fill-gray-900 font-sans font-bold text-xs uppercase"
              >
                {group.title.length > 20
                  ? group.title.substring(0, 17) + "..."
                  : group.title}
              </text>
            </svg>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDeleteGroup(group.group_id);
              }}
              className="absolute top-[21px] right-6 p-1 text-muted opacity-100 transition hover:text-red-600 sm:opacity-0 sm:group-hover:opacity-100"
              title="Delete Folder"
            >
              <svg
                className="w-4 h-4"
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

          <motion.div
            className="absolute left-1/2 transform -translate-x-1/2 bg-[#F3F4F6] rounded-b-xl border-2 border-t-0 border-gray-900 overflow-hidden flex flex-col canvas-heavy-shell"
            style={{
              top: TAB_HEIGHT - 2,
              width: CARD_WIDTH,
              height: cardHeight,
              scale: cardScale,
              transformOrigin: "top center",
              zIndex: 0,
            }}
          >
            <motion.div
              className="p-6 w-full h-full flex flex-col"
              style={{ opacity: contentOpacity }}
            >
              {/* EDITABLE FOLDER TITLE */}
              <div className="w-full flex justify-between items-end border-b-2 border-gray-300 pb-3 mb-4 shrink-0">
                {isRenaming ? (
                  <div className="flex items-center gap-2 w-full pr-4">
                    <input
                      autoFocus
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onPointerDown={(e) => e.stopPropagation()} // Prevents Framer Motion from swallowing keystrokes
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          onRenameGroup(group.group_id, editTitle);
                          setIsRenaming(false);
                        }
                        if (e.key === "Escape") {
                          setIsRenaming(false);
                          setEditTitle(group.title);
                        }
                      }}
                      className="flex-1 p-1 text-lg font-bold border border-gray-400 rounded bg-white text-slate-800"
                    />
                    <button
                      onClick={() => {
                        setIsRenaming(false);
                        setEditTitle(group.title);
                      }}
                      className="text-xs text-slate-500"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 w-full pr-4 overflow-hidden group/title">
                    <h2
                      className="text-xl font-bold text-slate-800 truncate cursor-pointer hover:text-black transition-colors"
                      onClick={() => {
                        setIsRenaming(true);
                        setEditTitle(group.title);
                      }}
                      title="Click to rename"
                    >
                      {group.title}
                    </h2>
                    <button
                      onClick={() => {
                        setIsRenaming(true);
                        setEditTitle(group.title);
                      }}
                      className="text-gray-400 opacity-100 transition-opacity hover:text-black sm:opacity-0 sm:group-hover/title:opacity-100"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                        />
                      </svg>
                    </button>
                  </div>
                )}

                <button
                  onClick={onInitiateCreateNote}
                  className="px-3 py-1.5 bg-black text-white text-xs font-bold rounded-md hover:bg-black transition shadow-sm whitespace-nowrap"
                >
                  + New Note
                </button>
              </div>

              <div className="flex-1 overflow-y-auto pr-2 pb-4 hide-scrollbar">
                {isActive && notes.length === 0 && (
                  <div className="flex flex-col items-center justify-center h-32 text-gray-400 italic text-sm font-mono border-2 border-dashed border-slate-300 rounded-lg">
                    [ NO NOTES SAVED YET ]
                  </div>
                )}
                {isActive && notes.length > 0 && (
                  <div className="flex flex-col shrink-0 border-t-2 border-b-2 border-gray-900">
                    {notes.map((note, index) => (
                      <div
                        key={note.note_id}
                        onClick={() => onOpenNote(note)}
                        className={`group flex items-center justify-between py-3 px-2 hover:bg-gray-200/50 transition-colors cursor-pointer ${
                          index !== notes.length - 1
                            ? "border-b border-gray-300"
                            : ""
                        }`}
                      >
                        <h4 className="font-bold text-slate-800 leading-tight truncate pr-4">
                          {note.title}
                        </h4>
                        <div className="flex items-center gap-4 shrink-0">
                          <span className="text-[10px] text-slate-500 font-mono">
                            Just now
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteNote(note.note_id);
                            }}
                            className="text-gray-400 opacity-100 transition-opacity hover:text-red-500 sm:opacity-0 sm:group-hover:opacity-100"
                          >
                            <svg
                              className="w-4 h-4"
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
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
          <motion.div
            className="absolute left-1/2 transform -translate-x-1/2 bg-gray-900 rounded-b-xl pointer-events-none"
            style={{
              top: TAB_HEIGHT,
              width: CARD_WIDTH - 10,
              height: cardHeight,
              zIndex: -1,
              opacity: 0.08,
            }}
          />
        </motion.div>
      </motion.div>
    );
  },
);

export default GroupCard;
