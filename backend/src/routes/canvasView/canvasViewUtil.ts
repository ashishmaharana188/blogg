import express from "express";
import { trace } from "../../middleware/trace.ts";
import { saveStack, saveGroup } from "./canvasViewIndex.ts";
import { getDB } from "../../db/mongoDBConnect.ts";

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

canvasViewInterceptor.get("/stackAndGroup", async (req, res) => {
  const stacks = await getDB()
    .collection("stackGroupCanvas")
    .find({ stack_name: { $exists: true }, group_id: { $exists: false } })
    .sort({ _id: -1 })
    .toArray();
  const groups = await getDB()
    .collection("stackGroupCanvas")
    .find({ group_id: { $exists: true } })
    .sort({ _id: -1 })
    .toArray();

  res.json({
    stacks,
    groups,
  });
});

export default canvasViewInterceptor;
