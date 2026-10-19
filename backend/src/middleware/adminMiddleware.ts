import type { Request, Response, NextFunction } from "express";
import HttpError from "../server/httpError.ts";

/** Requires a valid session AND that the session belongs to ADMIN_EMAIL. */
export const adminMiddleware = (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  const configuredAdmin = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const signedInEmail = req.user?.email?.trim().toLowerCase();

  if (!configuredAdmin || !signedInEmail || signedInEmail !== configuredAdmin) {
    return next(new HttpError(403, "Administrator access required."));
  }

  next();
};
