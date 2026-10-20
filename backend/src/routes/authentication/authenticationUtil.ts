import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import type { Request, Response } from "express";
import type { SignOptions } from "jsonwebtoken";
import HttpError from "../../server/httpError.ts";
import {
  createUser,
  findUserByEmail,
  findUserById,
  findUserByUsername,
} from "./authenticationQueries.ts";

const JWT_SECRET = process.env.JWT_SECRET ?? (process.env.NODE_ENV === "production" ? "" : "dev-secret");
if (!JWT_SECRET) throw new Error("JWT_SECRET must be configured in production.");
const JWT_EXPIRES_IN = (process.env.JWT_EXPIRES_IN ?? "30d") as SignOptions["expiresIn"];
const COOKIE_MAX_AGE_MS = Number(process.env.AUTH_COOKIE_MAX_AGE_MS ?? 30 * 24 * 60 * 60 * 1000);
// Vercel and Render are different sites, so production API calls need cross-site cookies.
const COOKIE_SAME_SITE = (process.env.AUTH_COOKIE_SAME_SITE ?? (process.env.NODE_ENV === "production" ? "none" : "lax")) as "lax" | "strict" | "none";
const configuredAdminEmail = () => process.env.ADMIN_EMAIL?.trim().toLowerCase() ?? "";

const buildToken = (payload: { user_id: string; username: string; displayName: string; email: string }) =>
  jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

const authCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production" || COOKIE_SAME_SITE === "none",
  sameSite: COOKIE_SAME_SITE,
};
const setAuthCookie = (res: Response, token: string) => res.cookie("authToken", token, { ...authCookieOptions, maxAge: COOKIE_MAX_AGE_MS });
const clearAuthCookie = (res: Response) => res.clearCookie("authToken", authCookieOptions);

export const registerUser = async (_req: Request, res: Response, payload: { username: string; email: string; password: string }) => {
  if (process.env.ENABLE_ADMIN_REGISTRATION !== "true") throw new HttpError(403, "Admin account creation is disabled. Enable it temporarily for initial setup.");
  const adminEmail = configuredAdminEmail();
  if (!adminEmail) throw new HttpError(500, "ADMIN_EMAIL must be configured before creating the admin account.");
  if (payload.email.trim().toLowerCase() !== adminEmail) throw new HttpError(403, "Only the configured administrator account can be created.");
  const normalizedEmail = payload.email.trim().toLowerCase();
  if (await findUserByEmail(normalizedEmail)) throw new HttpError(409, "Email already exists.");
  if (await findUserByUsername(payload.username)) throw new HttpError(409, "Username already exists.");
  const passwordHash = await bcrypt.hash(payload.password, 10);
  const user = await createUser({ username: payload.username, email: normalizedEmail, passwordHash });
  setAuthCookie(res, buildToken({ user_id: user.id, username: user.username, displayName: user.displayName ?? user.username, email: user.email }));
  return { success: true, message: "Registration successful.", user: { ...user, isAdmin: true }, isAdmin: true };
};

export const loginUser = async (_req: Request, res: Response, payload: { email: string; password: string }) => {
  const adminEmail = configuredAdminEmail();
  if (!adminEmail) throw new HttpError(500, "ADMIN_EMAIL must be configured on the server.");
  if (payload.email.trim().toLowerCase() !== adminEmail) throw new HttpError(401, "Invalid email or password.");
  const user = await findUserByEmail(payload.email.trim().toLowerCase());
  if (!user || !(await bcrypt.compare(payload.password, user.passwordHash))) throw new HttpError(401, "Invalid email or password.");
  setAuthCookie(res, buildToken({ user_id: user.id, username: user.username, displayName: user.displayName ?? user.username, email: user.email }));
  return { success: true, message: "Login successful.", user: { ...user, isAdmin: true }, isAdmin: true };
};

export const logoutUser = async (_req: Request, res: Response) => {
  clearAuthCookie(res);
  return { success: true, message: "Logout successful." };
};

export const getCurrentUser = async (req: Request, res: Response) => {
  if (!req.user) {
    clearAuthCookie(res);
    return { success: true, user: null, isAdmin: false };
  }
  const user = await findUserById(req.user.user_id);
  if (!user) {
    clearAuthCookie(res);
    return { success: true, user: null, isAdmin: false };
  }
  const isAdmin = Boolean(configuredAdminEmail()) && user.email.trim().toLowerCase() === configuredAdminEmail();
  return { success: true, user: { ...user, isAdmin }, isAdmin };
};
