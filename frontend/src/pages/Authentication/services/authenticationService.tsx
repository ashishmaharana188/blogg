import axios from "axios";
import { LoginRequest, RegisterRequest } from "../../../types/pageTypes";

const BASE_URL = "/api/auth";

const login = async (payload: LoginRequest) => {
  const { data } = await axios.post(`${BASE_URL}/login`, payload, {
    withCredentials: true,
  });

  return data;
};

const register = async (payload: RegisterRequest) => {
  const { data } = await axios.post(`${BASE_URL}/register`, payload, {
    withCredentials: true,
  });

  return data;
};

const logout = async () => {
  const { data } = await axios.post(
    `${BASE_URL}/logout`,
    {},
    {
      withCredentials: true,
    },
  );

  return data;
};

const me = async () => {
  const { data } = await axios.get(`${BASE_URL}/me`, {
    withCredentials: true,
  });

  return data;
};

export default {
  login,
  register,
  logout,
  me,
};
