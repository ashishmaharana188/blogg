import { Router } from "express";
import { trace } from "../../middleware/trace.ts";

import {
  loginUser,
  registerUser,
  logoutUser,
  getCurrentUser,
} from "./authenticationUtil.ts";

import { validateLogin, validateRegister } from "./authenticationValidation.ts";

const authenticationRouter = Router();

authenticationRouter.post(
  "/register",
  trace("AUTH_REGISTER", async (req, res) => {
    const validationError = validateRegister(req.body);

    if (validationError) {
      throw new Error(validationError);
    }

    return await registerUser(req, res, req.body);
  }),
);

authenticationRouter.post(
  "/login",
  trace("AUTH_LOGIN", async (req, res) => {
    const validationError = validateLogin(req.body);

    if (validationError) {
      throw new Error(validationError);
    }

    return await loginUser(req, res, req.body);
  }),
);

authenticationRouter.post(
  "/logout",
  trace("AUTH_LOGOUT", async (req, res) => {
    return await logoutUser(req, res);
  }),
);

authenticationRouter.get(
  "/me",
  trace("AUTH_ME", async (req) => {
    return await getCurrentUser(req);
  }),
);

export default authenticationRouter;
