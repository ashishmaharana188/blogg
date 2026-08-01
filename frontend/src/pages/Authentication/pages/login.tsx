import { useState } from "react";
import AuthLayout from "../components/authLayout";
import AuthInput from "../components/authInput";

const Login = () => {
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

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    console.log(form);

    // authenticationService.login(form)
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
      </form>
    </AuthLayout>
  );
};

export default Login;
