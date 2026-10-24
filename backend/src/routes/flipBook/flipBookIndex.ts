import express from "express";
import { trace } from "../../middleware/trace.ts";
import {
  isConfiguredAdminRequest,
  optionalAuthenticationMiddleware,
} from "../../middleware/authenticationMiddleware.ts";
import { getAllBloggs } from "./flipBookUtil.ts";

const flipBookInterceptor = express.Router();

flipBookInterceptor.get(
  "/bloggs",
  optionalAuthenticationMiddleware,
  trace("BLOGGS_FETCH_ALL", async (req) => {
    const bloggs = await getAllBloggs(isConfiguredAdminRequest(req));

    return {
      success: true,
      message: "BLOGGS_FETCH_ALL",
      bloggs,
    };
  }),
);

export default flipBookInterceptor;
