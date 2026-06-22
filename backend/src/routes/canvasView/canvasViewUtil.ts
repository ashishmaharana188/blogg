import { getDB } from "../../db/mongoDBConnect.ts";
import type {
  StackDocument,
  GroupDocument,
} from "../../types/canvasViewTypes.ts";
//save stack
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
//save group
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
//load stacks and groups

export async function getStacksAndGroups() {
  const stacks = await getDB()
    .collection("stackGroupCanvas")
    .find({
      stack_name: { $exists: true },
      group_id: { $exists: false },
    })
    .sort({ _id: -1 })
    .toArray();

  const groups = await getDB()
    .collection("stackGroupCanvas")
    .find({
      group_id: { $exists: true },
    })
    .sort({ _id: -1 })
    .toArray();

  return {
    stacks,
    groups,
  };
}
//detele and rename stacks and groups
const canvasCollection = () => {
  return getDB().collection("stackGroupCanvas");
};

export async function renameStack(payload: {
  stack_id: string;
  stack_name: string;
}) {
  const updatedStack = await canvasCollection().findOneAndUpdate(
    {
      stack_id: payload.stack_id,
      group_id: { $exists: false },
    },
    {
      $set: {
        stack_name: payload.stack_name,
      },
    },
    {
      returnDocument: "after",
    },
  );

  return updatedStack;
}

export async function renameGroup(payload: {
  group_id: string;
  group_name: string;
}) {
  const updatedGroup = await canvasCollection().findOneAndUpdate(
    {
      group_id: payload.group_id,
    },
    {
      $set: {
        group_name: payload.group_name,
      },
    },
    {
      returnDocument: "after",
    },
  );

  return updatedGroup;
}

export async function deleteGroup(payload: { group_id: string }) {
  const deletedGroup = await canvasCollection().deleteOne({
    group_id: payload.group_id,
  });

  return deletedGroup;
}

export async function deleteStack(payload: { stack_id: string }) {
  const deletedStack = await canvasCollection().deleteOne({
    stack_id: payload.stack_id,
    group_id: { $exists: false },
  });

  if (deletedStack.deletedCount === 0) {
    return {
      deletedStack,
      deletedGroups: null,
    };
  }

  const deletedGroups = await canvasCollection().deleteMany({
    stack_id: payload.stack_id,
    group_id: { $exists: true },
  });

  return {
    deletedStack,
    deletedGroups,
  };
}
