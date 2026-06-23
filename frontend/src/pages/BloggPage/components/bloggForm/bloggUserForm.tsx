import { userFormtypes } from "../../../../types/pageTypes";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import { uploadFile } from "../../services/bloggService";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { useRef, useState } from "react";

// Pre-define full Tailwind classes so the compiler detects them
const TAG_COLORS = [
  "bg-blue-100 text-blue-800 border-blue-200",
  "bg-emerald-100 text-emerald-800 border-emerald-200",
  "bg-purple-100 text-purple-800 border-purple-200",
  "bg-amber-100 text-amber-800 border-amber-200",
  "bg-rose-100 text-rose-800 border-rose-200",
  "bg-cyan-100 text-cyan-800 border-cyan-200",
];

const UserForm = ({ onContentChange, selectedBlogg }: userFormtypes) => {
  const isReadOnly = selectedBlogg !== null && selectedBlogg !== undefined;

  const [formData, setFormData] = useState({
    author: "",
    title: "",
    description: "",
  });

  // Tag System State
  const [tags, setTags] = useState<{ text: string; colorClass: string }[]>(
    (selectedBlogg?.tags ?? []).map((text, index) => ({
      text,
      colorClass: TAG_COLORS[index % TAG_COLORS.length],
    })),
  );
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [tagInput, setTagInput] = useState("");

  const editor = useCreateBlockNote({
    initialContent: selectedBlogg?.content as any,
    uploadFile,
  });

  const authorRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);

  const handleTitleChange = (
    field: "author" | "title" | "description",
    value: string,
  ) => {
    setFormData({
      ...formData,
      [field]: value,
    });
  };

  const autoResize = (ref: React.RefObject<HTMLTextAreaElement | null>) => {
    if (ref.current) {
      ref.current.style.height = "auto";
      ref.current.style.height = ref.current.scrollHeight + "px";
    }
  };

  // Tag Input Handlers
  const confirmTag = () => {
    if (tagInput.trim()) {
      const randomColor =
        TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)];
      setTags([...tags, { text: tagInput.trim(), colorClass: randomColor }]);
    }
    setTagInput("");
    setIsAddingTag(false);
  };

  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      confirmTag();
    }
    if (e.key === "Escape") {
      setTagInput("");
      setIsAddingTag(false);
    }
  };

  const removeTag = (indexToRemove: number) => {
    setTags(tags.filter((_, index) => index !== indexToRemove));
  };

  const saveForm = () => {
    const blog = {
      author: formData.author,
      title: formData.title,
      subtitle: formData.description,
      tags: tags.map((t) => t.text), // Extract pure strings for the backend
      content: editor.document,
    };
    onContentChange(blog);
  };

  return (
    <div className="mt-10 w-full min-h-screen relative">
      <div className="max-w-6xl mx-auto flex flex-col gap-4 p-4 relative">
        <div className="self-center -mt-4">
          <textarea
            ref={authorRef}
            value={formData.author}
            readOnly={isReadOnly}
            onChange={(e) => {
              handleTitleChange("author", e.target.value);
              autoResize(authorRef);
            }}
            placeholder="Author"
            className="w-[500px] resize-none overflow-hidden whitespace-pre-wrap break-words text-xl outline-none text-center"
          />
        </div>
        <textarea
          ref={titleRef}
          value={formData.title}
          readOnly={isReadOnly}
          onChange={(e) => {
            handleTitleChange("title", e.target.value);
            autoResize(titleRef);
          }}
          placeholder="Document Title"
          className="w-[1100px] resize-none overflow-hidden whitespace-pre-wrap break-words text-4xl font-bold outline-none self-center text-center"
        />
        <div className="self-center -mt-4">
          <textarea
            ref={descriptionRef}
            value={formData.description}
            readOnly={isReadOnly}
            onChange={(e) => {
              handleTitleChange("description", e.target.value);
              autoResize(descriptionRef);
            }}
            placeholder="Description"
            className="w-[800px] mt-5 resize-none overflow-hidden whitespace-pre-wrap break-words text-xl outline-none text-center italic"
          />
        </div>

        {/* Dynamic Tag Container */}
        <div className="flex flex-wrap items-center justify-center gap-2 mt-4 min-h-[32px]">
          {tags.map((tag, index) => (
            <div
              key={index}
              className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border transition-all ${tag.colorClass}`}
            >
              <span>{tag.text}</span>

              {!isReadOnly && (
                <button
                  onClick={() => removeTag(index)}
                  className="hover:text-black opacity-50 hover:opacity-100 transition-opacity focus:outline-none"
                  title="Remove tag"
                >
                  ×
                </button>
              )}
            </div>
          ))}

          {!isReadOnly &&
            (isAddingTag ? (
              <input
                autoFocus
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                onBlur={confirmTag}
                placeholder="Type & Enter..."
                className="w-32 px-3 py-1 text-xs font-bold border border-gray-300 rounded-full focus:outline-none focus:border-slate-800 text-center bg-white shadow-sm"
              />
            ) : (
              <button
                onClick={() => setIsAddingTag(true)}
                className="px-4 py-1 text-xs border border-gray-300 rounded-full font-bold text-gray-600 hover:bg-gray-100 transition-colors shadow-sm"
              >
                + Add Tag
              </button>
            ))}
        </div>

        <div className="mt-10">
          <BlockNoteView
            editor={editor}
            theme="dark"
            filePanel={!selectedBlogg}
            editable={!selectedBlogg}
          />
        </div>
        {!isReadOnly && (
          <div className="flex justify-end mt-4">
            <button
              className="px-5 py-1 text-l bg-white border border-gray-300 text-black rounded font-bold hover:bg-black hover:text-white transition-colors"
              onClick={saveForm}
            >
              SAVE
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default UserForm;
