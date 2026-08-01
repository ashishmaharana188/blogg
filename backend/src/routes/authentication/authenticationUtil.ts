import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import type { Request, Response } from "express";
import type { SignOptions } from "jsonwebtoken";

import {
  createUser,
  findUserByEmail,
  findUserById,
  findUserByUsername,
} from "./authenticationQueries.ts";

const JWT_SECRET = process.env.JWT_SECRET ?? "dev-secret";

const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN ??
  "7d") as SignOptions["expiresIn"];

const buildToken = (payload: {
  user_id: string;
  username: string;
  displayName: string;
  email: string;
}) =>
  jwt.sign(payload, JWT_SECRET, {
    expiresIn: JWT_EXPIRES_IN,
  });

export const registerUser = async (
  req: Request,
  res: Response,
  payload: {
    username: string;
    email: string;
    password: string;
  },
) => {
  const existingEmail = await findUserByEmail(payload.email);

  if (existingEmail) {
    throw new Error("Email already exists.");
  }

  const existingUsername = await findUserByUsername(payload.username);

  if (existingUsername) {
    throw new Error("Username already exists.");
  }

  const passwordHash = await bcrypt.hash(payload.password, 10);

  const user = await createUser({
    username: payload.username,
    email: payload.email,
    passwordHash,
  });

  const token = buildToken({
    user_id: user.id,
    username: user.username,
    displayName: user.displayName ?? user.username,
    email: user.email,
  });

  res.cookie("authToken", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  return {
    success: true,
    message: "Registration successful.",
    user,
  };
};

export const loginUser = async (
  req: Request,
  res: Response,
  payload: {
    email: string;
    password: string;
  },
) => {
  const user = await findUserByEmail(payload.email);

  if (!user) {
    throw new Error("Invalid email or password.");
  }

  const passwordMatches = await bcrypt.compare(
    payload.password,
    user.passwordHash,
  );

  if (!passwordMatches) {
    throw new Error("Invalid email or password.");
  }

  const token = buildToken({
    user_id: user.id,
    username: user.username,
    displayName: user.displayName ?? user.username,
    email: user.email,
  });

  res.cookie("authToken", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  });

  return {
    success: true,
    message: "Login successful.",
    user,
  };
};

export const logoutUser = async (_req: Request, res: Response) => {
  res.clearCookie("authToken");

  return {
    success: true,
    message: "Logout successful.",
  };
};

export const getCurrentUser = async (req: Request) => {
  if (!req.user) {
    throw new Error("User not authenticated.");
  }

  const user = await findUserById(req.user.user_id);

  if (!user) {
    throw new Error("User not found.");
  }

  return {
    success: true,
    user,
  };
};
