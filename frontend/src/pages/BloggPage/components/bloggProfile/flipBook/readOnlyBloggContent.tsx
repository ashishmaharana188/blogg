import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";

type ReadOnlyBloggContentProps = {
  content: any[];
};

export function ReadOnlyBloggContent({ content }: ReadOnlyBloggContentProps) {
  const editor = useCreateBlockNote({
    initialContent:
      content.length > 0 ? content : [{ type: "paragraph", content: "" }],
  });

  // Read-only renderers should not expose image download or other editor toolbar actions.
  return <BlockNoteView editor={editor} editable={false} theme="light" formattingToolbar={false} />;
}
