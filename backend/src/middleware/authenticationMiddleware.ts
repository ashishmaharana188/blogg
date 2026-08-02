import type { Request, Response, NextFunction } from "express";

import jwt from "jsonwebtoken";

import HttpError from "../server/httpError.ts";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret";

export const authenticationMiddleware = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const token = req.cookies?.authToken;

  if (!token) {
    return next(new HttpError(401, "Authentication required."));
  }

  try {
    req.user = jwt.verify(token, JWT_SECRET) as {
      user_id: string;
      username: string;
      displayName: string;
      email: string;
    };

    next();
  } catch (error) {
    console.error(error);

    next(new HttpError(401, "Invalid authentication token."));
  }
};
