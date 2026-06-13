import crypto from "crypto";
import type { Request, Response, NextFunction } from "express";
import logger from "../logs/logger.ts";

export function middleware(req: Request, res: Response, next: NextFunction) {
  const requestId =
    req.headers["x-request-id"]?.toString() ?? crypto.randomUUID();

  const sessionId = req.headers["x-session-id"]?.toString() ?? "unknown";

  req.requestId = requestId;
  req.sessionId = sessionId;

  const start = Date.now();

  logger.info({
    event: "REQUEST_STARTED",
    requestId,
    sessionId,
    method: req.method,
    url: req.originalUrl,
  });

  logger.info({
    event: "REQUEST_PAYLOAD",
    requestId,
    sessionId,
    payload:
      req.method === "POST" || req.method === "PUT" || req.method === "PATCH"
        ? {
            author: req.body?.author,
            title: req.body?.title,
            subtitle: req.body?.subtitle,
            contentBlocks:
              req.body?.content?.filter(
                (block: any) => block.content?.length > 0,
              ).length ?? 0,
            groupId: req.body?.groupId,
          }
        : undefined,
  });

  next();
}
