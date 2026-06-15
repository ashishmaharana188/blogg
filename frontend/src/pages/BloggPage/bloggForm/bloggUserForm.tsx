import { userFormtypes } from "../../../types/pageTypes";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";

import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";
import { useRef, useState } from "react";

const UserForm = ({ onContentChange }: userFormtypes) => {
  const [formData, setFormData] = useState({
    author: "",
    title: "",
    description: "",
    content: <object data="" type=""></object>,
  });

  async function uploadFile(file: File) {
    const formData = new FormData();

    formData.append("file", file);

    const response = await fetch("http://localhost:3000/blogMediaUpload", {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      throw new Error("Media upload failed");
    }

    const data = await response.json();

    return data.media.url;
  }

  const editor = useCreateBlockNote({
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

  const saveForm = () => {
    const blog = {
      author: formData.author,
      title: formData.title,
      subtitle: formData.description,
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
          onChange={(e) => {
            handleTitleChange("title", e.target.value);
            autoResize(titleRef);
          }}
          placeholder="Document Title"
          className="w-[1100px]  resize-none overflow-hidden whitespace-pre-wrap break-words text-4xl font-bold outline-none self-center text-center"
        />
        <div className="self-center -mt-4">
          <textarea
            ref={descriptionRef}
            value={formData.description}
            onChange={(e) => {
              handleTitleChange("description", e.target.value);
              autoResize(descriptionRef);
            }}
            placeholder="Description"
            className="w-[800px] mt-5 resize-none overflow-hidden whitespace-pre-wrap break-words text-xl outline-none text-center italic"
          />
        </div>

        <button className="w-30 rounded-full border font-semibold self-center text-center">
          + Add Tag
        </button>

        <div className="mt-10">
          <BlockNoteView editor={editor} theme="dark" filePanel={true} />
        </div>

        <div className="flex justify-end mt-4">
          <button
            className="px-5 py-1 text-l bg-white text-black rounded font-bold hover:bg-black hover:text-white"
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
