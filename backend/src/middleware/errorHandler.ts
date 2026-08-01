import type { NextFunction, Request, Response } from "express";
import HttpError from "../server/httpError.ts";
import logger from "../logs/logger.ts";

export function errorHandler(
  error: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (error instanceof HttpError) {
    logger.warn({
      event: "HTTP_ERROR",
      requestId: req.requestId,
      sessionId: req.sessionId,
      statusCode: error.statusCode,
      message: error.message,
    });

    return res.status(error.statusCode).json({
      success: false,
      message: error.message,
    });
  }

  logger.error({
    event: "UNHANDLED_ERROR",
    requestId: req.requestId,
    sessionId: req.sessionId,
    error: error.message,
    stack: error.stack,
  });

  return res.status(500).json({
    success: false,
    message: "Internal Server Error",
  });
}
