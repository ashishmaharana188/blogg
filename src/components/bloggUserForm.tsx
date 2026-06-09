import { useEffect, useState } from "react";
import { userForm } from "./pageTypes";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";

// Matched exact imports from notesFormUI
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";

const UserForm = ({ onContentChange }: userForm) => {
  const editor = useCreateBlockNote();
  const [isMounted, setIsMounted] = useState(false);

  // Safeguard: Defers editor rendering until React has stabilized the parent DOM
  useEffect(() => {
    const timer = setTimeout(() => setIsMounted(true), 50);
    return () => clearTimeout(timer);
  }, []);

  const saveForm = () => {
    onContentChange("Form Saved");
  };

  return (
    <div className="w-full min-h-screen">
      <div className="max-w-6xl mx-auto flex flex-col gap-4 p-4">
        <div>
          {/* Editor only mounts after the timeout */}
          {isMounted && (
            <BlockNoteView editor={editor} theme="light" filePanel={true} />
          )}
        </div>

        <div className="flex justify-end">
          <button
            className="px-5 py-1 text-base bg-slate-800 text-white rounded shadow hover:bg-black"
            onClick={() => saveForm()}
          >
            SAVE
          </button>
        </div>
      </div>
    </div>
  );
};

export default UserForm;
