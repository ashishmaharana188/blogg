import { userForm } from "./pageTypes";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";

const UserForm = ({ onContentChange }: userForm) => {
  const editor = useCreateBlockNote();

  const saveForm = () => {
    onContentChange("Form Saved");
  };

  return (
    <div className="w-full min-h-screen">
      <div className="max-w-6xl mx-auto flex flex-col gap-4 p-4">
        <div onClick={() => editor.focus()}>
          <BlockNoteView editor={editor} theme="light" filePanel={true} />
        </div>

        <button
          className="bg-slate-800 text-white p-2 rounded"
          onClick={() => console.log("Current Blocks:", editor.document)}
        >
          Debug State
        </button>

        <div className="flex justify-end">
          <button
            className="px-5 py-1 ml-5 text-base bg-white text-black rounded shadow hover:bg-black hover:text-white"
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
