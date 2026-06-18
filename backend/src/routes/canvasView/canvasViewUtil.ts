import express from "express";
import { trace } from "../../middleware/trace.ts";
import { saveStack, saveGroup } from "./canvasViewIndex.ts";

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

export default canvasViewInterceptor;
