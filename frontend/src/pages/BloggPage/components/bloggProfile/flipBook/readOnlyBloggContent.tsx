import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";

type ReadOnlyBloggContentProps = {
  content: any[];
};

export function ReadOnlyBloggContent({ content }: ReadOnlyBloggContentProps) {
  const editor = useCreateBlockNote({
    initialContent: content,
  });

  return <BlockNoteView editor={editor} editable={false} theme="light" />;
}
