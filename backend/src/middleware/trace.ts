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

        payloadSummary: {
          success: response.success,
          message: response.message,
        },

        payload: response,
      });

      res.json(response);
    } catch (error) {
      logger.error({
        event: `${operation}_FAILED`,
        requestId: req.requestId,
        sessionId: req.sessionId,
        error: error instanceof Error ? error.message : String(error),
      });

      next(error);
    }
  };
}
