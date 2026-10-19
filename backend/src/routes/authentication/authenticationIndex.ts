import { Router } from "express";
import { trace } from "../../middleware/trace.ts";
import { authenticationMiddleware } from "../../middleware/authenticationMiddleware.ts";
import {
  loginUser,
  registerUser,
  logoutUser,
  getCurrentUser,
} from "./authenticationUtil.ts";
import { validateLogin, validateRegister } from "./authenticationValidation.ts";

const authenticationRouter = Router();

// The Login screen asks this endpoint before showing the registration link.
// It reveals only whether the one-time setup form is currently enabled.
authenticationRouter.get("/registration-status", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.json({ registrationEnabled: process.env.ENABLE_ADMIN_REGISTRATION === "true" });
});

authenticationRouter.post(
  "/register",
  trace("AUTH_REGISTER", async (req, res) => {
    const validationError = validateRegister(req.body);
    if (validationError) throw new Error(validationError);
    return await registerUser(req, res, req.body);
  }),
);

authenticationRouter.post(
  "/login",
  trace("AUTH_LOGIN", async (req, res) => {
    const validationError = validateLogin(req.body);
    if (validationError) throw new Error(validationError);
    return await loginUser(req, res, req.body);
  }),
);

authenticationRouter.post(
  "/logout",
  authenticationMiddleware,
  trace("AUTH_LOGOUT", async (req, res) => await logoutUser(req, res)),
);

authenticationRouter.get(
  "/me",
  authenticationMiddleware,
  trace("AUTH_ME", async (req, res) => await getCurrentUser(req, res)),
);

export default authenticationRouter;
