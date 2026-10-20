import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import { bloggEditorSchema } from "../../bloggForm/bloggEditorSchema";

type ReadOnlyBloggContentProps = {
  content: any[];
};

export function ReadOnlyBloggContent({ content }: ReadOnlyBloggContentProps) {
  const editor = useCreateBlockNote({
    schema: bloggEditorSchema,
    initialContent: content.length > 0 ? content : [{ type: "paragraph", content: "" }],
  });

  // Read-only renderers share the schema so saved preview blocks render outside the editor.
  return <BlockNoteView editor={editor} editable={false} theme="light" formattingToolbar={false} />;
}
