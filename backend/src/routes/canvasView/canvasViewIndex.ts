// backend/src/routes/canvasView/canvasViewIndex.ts

import { getDB } from "../../db/mongoDBConnect.ts";
import { StackDocument, GroupDocument } from "./../../types/canvasViewTypes.ts";

export const saveStack = async (
  stack: StackDocument,
): Promise<StackDocument> => {
  const result = await getDB().collection("stacks").insertOne(stack);

  const savedStack = await getDB().collection<StackDocument>("stacks").findOne({
    _id: result.insertedId,
  });

  if (!savedStack) {
    throw new Error("Failed to save stack");
  }

  return savedStack;
};

export const saveGroup = async (
  group: GroupDocument,
): Promise<GroupDocument> => {
  const result = await getDB().collection("groups").insertOne(group);

  const savedGroup = await getDB().collection<GroupDocument>("groups").findOne({
    _id: result.insertedId,
  });

  if (!savedGroup) {
    throw new Error("Failed to save group");
  }

  return savedGroup;
};
