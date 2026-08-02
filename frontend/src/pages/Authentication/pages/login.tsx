import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import AuthLayout from "../components/authLayout";
import AuthInput from "../components/authInput";

import authenticationService from "../services/authenticationService";
import { useAuth } from "../../../context/authContext";

const Login = () => {
  const navigate = useNavigate();
  const { refreshUser } = useAuth();

  const [form, setForm] = useState({
    email: "",
    password: "",
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    try {
      await authenticationService.login(form);

      await refreshUser();

      navigate("/feed", { replace: true });
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <AuthLayout title="Login">
      <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
        <AuthInput
          label="Email"
          name="email"
          value={form.email}
          onChange={handleChange}
        />

        <AuthInput
          label="Password"
          type="password"
          name="password"
          value={form.password}
          onChange={handleChange}
        />

        <button
          className="bg-blue-600 text-white rounded-md py-2"
          type="submit"
        >
          Login
        </button>

        <p className="text-center text-sm">
          Don't have an account?{" "}
          <Link to="/register" className="text-blue-600 hover:underline">
            Create one
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
};

export default Login;
