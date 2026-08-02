import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import AuthLayout from "../components/authLayout";
import AuthInput from "../components/authInput";

import authenticationService from "../services/authenticationService";
import { useAuth } from "../../../context/authContext";

const Register = () => {
  const navigate = useNavigate();
  const { refreshUser } = useAuth();

  const [form, setForm] = useState({
    username: "",
    email: "",
    password: "",
    confirmPassword: "",
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (form.password !== form.confirmPassword) {
      alert("Passwords do not match.");
      return;
    }

    try {
      await authenticationService.register({
        username: form.username,
        email: form.email,
        password: form.password,
      });

      await refreshUser();

      navigate("/feed", { replace: true });
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <AuthLayout title="Create Account">
      <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
        <AuthInput
          label="Username"
          name="username"
          value={form.username}
          onChange={handleChange}
        />

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

        <AuthInput
          label="Confirm Password"
          type="password"
          name="confirmPassword"
          value={form.confirmPassword}
          onChange={handleChange}
        />

        <button
          className="bg-blue-600 text-white rounded-md py-2"
          type="submit"
        >
          Create Account
        </button>

        <p className="text-center text-sm">
          Already have an account?{" "}
          <Link to="/login" className="text-blue-600 hover:underline">
            Login
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
};

export default Register;
