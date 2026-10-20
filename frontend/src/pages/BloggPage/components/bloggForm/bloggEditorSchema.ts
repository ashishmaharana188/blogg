import { BlockNoteSchema } from "@blocknote/core";
import { createLinkPreview } from "./linkPreviewBlock";

/** Shared by the editor, feed, and reader so saved custom blocks always render. */
export const bloggEditorSchema = BlockNoteSchema.create().extend({
  blockSpecs: {
    linkPreview: createLinkPreview(),
  },
});
