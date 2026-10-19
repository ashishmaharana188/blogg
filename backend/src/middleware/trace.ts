import type { Request, Response, NextFunction } from "express";
import logger from "../logs/logger.ts";

type HandlerResponse = {
  success?: boolean;
  message?: string;
  [key: string]: unknown;
};

type Handler = (
  req: Request,
  res: Response,
  next: NextFunction,
) => Promise<HandlerResponse> | HandlerResponse;

function errorDetails(error: unknown) {
  if (error instanceof Error) {
    const extended = error as Error & {
      code?: unknown;
      http_code?: unknown;
    };
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: extended.code,
      http_code: extended.http_code,
    };
  }

  if (typeof error === "object" && error !== null) {
    const details = error as Record<string, unknown>;
    return {
      name: typeof details.name === "string" ? details.name : undefined,
      message:
        typeof details.message === "string" ? details.message : String(error),
      code: details.code,
      http_code: details.http_code,
    };
  }

  return { message: String(error) };
}

export function trace(operation: string, handler: Handler) {
  return async (req: Request, res: Response, next: NextFunction) => {
    logger.info({
      event: `${operation}_STARTED`,
      requestId: req.requestId,
      sessionId: req.sessionId,
    });

    try {
      const response = await handler(req, res, next);

      logger.info({
        event: `${operation}_SUCCESS`,
        requestId: req.requestId,
        sessionId: req.sessionId,
      });

      logger.info({
        event: "RESPONSE_PAYLOAD",
        requestId: req.requestId,
        sessionId: req.sessionId,
        payload: {
          success: response?.success,
          message: response?.message,
        },
      });

      res.json(response);
    } catch (error) {
      logger.error({
        event: `${operation}_FAILED`,
        requestId: req.requestId,
        sessionId: req.sessionId,
        error: errorDetails(error),
      });

      next(error);
    }
  };
}
