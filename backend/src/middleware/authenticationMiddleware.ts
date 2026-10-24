import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import HttpError from "../server/httpError.ts";

const JWT_SECRET = process.env.JWT_SECRET ?? (process.env.NODE_ENV === "production" ? "" : "dev-secret");
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET must be configured in production.");
}

type AuthenticatedUser = {
  user_id: string;
  username: string;
  displayName: string;
  email: string;
};

export const authenticationMiddleware = (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  const token = req.cookies?.authToken;
  if (!token) return next(new HttpError(401, "Authentication required."));

  try {
    req.user = jwt.verify(token, JWT_SECRET) as AuthenticatedUser;
    next();
  } catch {
    next(new HttpError(401, "Invalid authentication token."));
  }
};

/**
 * Populate req.user when a valid session cookie exists, but allow anonymous
 * requests through. Use this only on read endpoints that have public content.
 */
export const optionalAuthenticationMiddleware = (
  req: Request,
  _res: Response,
  next: NextFunction,
) => {
  const token = req.cookies?.authToken;
  if (token) {
    try {
      req.user = jwt.verify(token, JWT_SECRET) as AuthenticatedUser;
    } catch {
      // An expired or invalid cookie is treated as an anonymous public request.
    }
  }
  next();
};

/** Same identity rule used by adminMiddleware, for routes that also serve public reads. */
export const isConfiguredAdminRequest = (req: Request): boolean => {
  const configuredAdmin = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const signedInEmail = req.user?.email?.trim().toLowerCase();
  return Boolean(configuredAdmin && signedInEmail && signedInEmail === configuredAdmin);
};
