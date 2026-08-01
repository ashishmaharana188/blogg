import type {
  LoginRequest,
  RegisterRequest,
} from "../../types/authenticationTypes.ts";

export const validateRegister = (
  payload: Partial<RegisterRequest>,
): string | null => {
  if (!payload.username || payload.username.trim().length < 3) {
    return "Username must be at least 3 characters long.";
  }

  if (!payload.email || !payload.email.includes("@")) {
    return "A valid email is required.";
  }

  if (!payload.password || payload.password.length < 6) {
    return "Password must be at least 6 characters long.";
  }

  return null;
};

export const validateLogin = (
  payload: Partial<LoginRequest>,
): string | null => {
  if (!payload.email || !payload.email.includes("@")) {
    return "A valid email is required.";
  }

  if (!payload.password || payload.password.length < 1) {
    return "Password is required.";
  }

  return null;
};
