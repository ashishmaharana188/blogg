import express from "express";
import { trace } from "../../middleware/trace.ts";
import { getAllBloggs } from "./flipBookUtil.ts";
const flipBookInterceptor = express.Router();

flipBookInterceptor.get(
  "/bloggs",
  trace("BLOGGS_FETCH_ALL", async () => {
    const bloggs = await getAllBloggs();

    return {
      success: true,
      message: "BLOGGS_FETCH_ALL",
      bloggs,
    };
  }),
);

export default flipBookInterceptor;
