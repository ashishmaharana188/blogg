import express from "express";
import { trace } from "../../middleware/trace.ts";
import { saveStack, saveGroup } from "./canvasViewIndex.ts";

const canvasViewInterceptor = express.Router();

canvasViewInterceptor.post(
  "/stack/create",

  trace("STACK_SAVE", async (req) => {
    const savedBlog = await saveStack(req.body);

    return {
      success: true,
      message: "STACK_SAVE",
      blog: savedBlog,
    };
  }),
);

canvasViewInterceptor.post(
  "/group/create",

  trace("GROUP_SAVE", async (req) => {
    const savedBlog = await saveGroup(req.body);

    return {
      success: true,
      message: "GROUP_SAVE",
      blog: savedBlog,
    };
  }),
);

export default canvasViewInterceptor;
