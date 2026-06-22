import express from "express";
import { trace } from "../../middleware/trace.ts";
import {
  saveStack,
  saveGroup,
  getStacksAndGroups,
  renameStack,
  renameGroup,
  deleteStack,
  deleteGroup,
} from "./canvasViewUtil.ts";

const canvasViewInterceptor = express.Router();

canvasViewInterceptor.post(
  "/stack/stackCreate",

  trace("STACK_SAVE", async (req) => {
    const savedStack = await saveStack(req.body);

    return {
      success: true,
      message: "STACK_SAVE",
      stack: savedStack,
    };
  }),
);

canvasViewInterceptor.post(
  "/group/groupCreate",

  trace("GROUP_SAVE", async (req) => {
    const savedGroup = await saveGroup(req.body);

    return {
      success: true,
      message: "GROUP_SAVE",
      group: savedGroup,
    };
  }),
);

canvasViewInterceptor.get(
  "/stackAndGroup",
  trace("STACK_AND_GROUP_FETCH", async () => {
    const stacksGroupData = await getStacksAndGroups();

    return {
      success: true,
      message: "STACK_AND_GROUP_FETCH",
      ...stacksGroupData,
    };
  }),
);

canvasViewInterceptor.post(
  "/stack/stackRename",

  trace("STACK_RENAME", async (req) => {
    const renamedStack = await renameStack(req.body);

    return {
      success: true,
      message: "STACK_RENAME",
      stack: renamedStack,
    };
  }),
);

canvasViewInterceptor.post(
  "/group/groupRename",
  trace("GROUP_RENAME", async (req) => {
    const renamedGroup = await renameGroup(req.body);

    return {
      success: true,
      message: "GROUP_RENAME",
      group: renamedGroup,
    };
  }),
);

canvasViewInterceptor.post(
  "/group/groupDelete",
  trace("GROUP_DELETE", async (req) => {
    const deletedGroup = await deleteGroup(req.body);

    return {
      success: true,
      message: "GROUP_DELETE",
      group: deletedGroup,
    };
  }),
);

canvasViewInterceptor.post(
  "/stack/stackDelete",
  trace("STACK_DELETE", async (req) => {
    const deletedStack = await deleteStack(req.body);

    return {
      success: true,
      message: "STACK_DELETE",
      result: deletedStack,
    };
  }),
);

export default canvasViewInterceptor;
