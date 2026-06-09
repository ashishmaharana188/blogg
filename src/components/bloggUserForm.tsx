import { userForm } from "../types/pageTypes";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { useRef, useState } from "react";

const UserForm = ({ onContentChange }: userForm) => {
  const [formData, setFormData] = useState({
    title: "",
    subtitle: "",
  });

  const editor = useCreateBlockNote();

  const titleRef = useRef<HTMLTextAreaElement>(null);

  const subtitleRef = useRef<HTMLTextAreaElement>(null);

  const handleTitleChange = (field: "title" | "subtitle", value: string) => {
    setFormData({
      ...formData,
      [field]: value,
    });

    console.log(...formData.title);
  };

  const autoResize = (ref: React.RefObject<HTMLTextAreaElement | null>) => {
    if (ref.current) {
      ref.current.style.height = "auto";
      ref.current.style.height = ref.current.scrollHeight + "px";
    }
  };

  const saveForm = () => {
    onContentChange("Form Saved");
  };

  return (
    <div className="mt-10 w-full min-h-screen relative">
      <div className="max-w-6xl mx-auto flex flex-col gap-4 p-4 relative">
        <textarea
          ref={titleRef}
          value={formData.title}
          onChange={(e) => {
            handleTitleChange("title", e.target.value);
            autoResize(titleRef);
          }}
          placeholder="Document Title"
          className="w-[800px] mt-10 resize-none overflow-hidden whitespace-pre-wrap  break-words text-4xl font-bold outline-none"
        />
        <div className="self-end -mt-4">
          <textarea
            ref={subtitleRef}
            value={formData.subtitle}
            onChange={(e) => {
              handleTitleChange("subtitle", e.target.value);
              autoResize(subtitleRef);
            }}
            placeholder="Author"
            className="w-[400px] mr-20 resize-none overflow-hidden whitespace-pre-wrap break-words text-2xl font-bold outline-none"
          />
        </div>
        <div className="mt-10">
          <BlockNoteView editor={editor} theme="dark" filePanel={true} />
        </div>

        <div className="flex justify-end mt-4">
          <button
            className="px-5 py-1 text-l bg-white text-black rounded  hover:bg-black hover:text-white"
            onClick={saveForm}
          >
            SAVE
          </button>
        </div>
      </div>
    </div>
  );
};

export default UserForm;
