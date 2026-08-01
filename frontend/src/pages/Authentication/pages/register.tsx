import { useState } from "react";
import AuthLayout from "../components/authLayout";
import AuthInput from "../components/authInput";

const Register = () => {
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

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    console.log(form);

    // authenticationService.register(form)
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
      </form>
    </AuthLayout>
  );
};

export default Register;
