import express from "express";
import { trace } from "../../middleware/trace.ts";
import {
  isConfiguredAdminRequest,
  optionalAuthenticationMiddleware,
} from "../../middleware/authenticationMiddleware.ts";
import { getAllBloggs, getBloggFeedPage } from "./flipBookUtil.ts";

const flipBookInterceptor = express.Router();

// Feed route must be bounded and registered separately from the legacy list
// endpoint, which the flipbook continues to use for one selected folder.
flipBookInterceptor.get(
  "/bloggs/feed",
  optionalAuthenticationMiddleware,
  trace("BLOGGS_FEED_PAGE", async (req) => {
    const rawLimit = typeof req.query.limit === "string" ? Number(req.query.limit) : 12;
    const rawCursor = typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    const page = await getBloggFeedPage(
      isConfiguredAdminRequest(req),
      Number.isFinite(rawLimit) ? rawLimit : 12,
      rawCursor,
    );
    return { success: true, message: "BLOGGS_FEED_PAGE", ...page };
  }),
);

flipBookInterceptor.get(
  "/bloggs",
  optionalAuthenticationMiddleware,
  trace("BLOGGS_FETCH_ALL", async (req) => {
    const stackId = typeof req.query.stackId === "string" ? req.query.stackId.trim() : "";
    const groupId = typeof req.query.groupId === "string" ? req.query.groupId.trim() : "";
    // Do not accidentally serve a site-wide flipbook if only one filter is set.
    const scope = stackId && groupId ? { stackId, groupId } : {};
    const bloggs = await getAllBloggs(isConfiguredAdminRequest(req), scope);
    return { success: true, message: "BLOGGS_FETCH_ALL", bloggs };
  }),
);

export default flipBookInterceptor;
