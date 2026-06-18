import { getDB } from "../../db/mongoDBConnect.ts";
import type {
  StackDocument,
  GroupDocument,
} from "../../types/canvasViewTypes.ts";

export const saveStack = async (
  stack: StackDocument,
): Promise<StackDocument> => {
  const result = await getDB().collection("stackGroupCanvas").insertOne(stack);

  const savedStack = await getDB()
    .collection<StackDocument>("stackGroupCanvas")
    .findOne({
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
  const result = await getDB().collection("stackGroupCanvas").insertOne(group);

  const savedGroup = await getDB()
    .collection<GroupDocument>("stackGroupCanvas")
    .findOne({
      _id: result.insertedId,
    });

  if (!savedGroup) {
    throw new Error("Failed to save group");
  }

  return savedGroup;
};
