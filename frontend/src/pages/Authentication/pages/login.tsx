import { useState } from "react";
import { useNavigate } from "react-router-dom";
import AuthLayout from "../components/authLayout";
import AuthInput from "../components/authInput";
import authenticationService from "../services/authenticationService";
import { useAuth } from "../../../context/authContext";

const Login = () => {
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const [form, setForm] = useState({ email: "", password: "" });
  const [errorMessage, setErrorMessage] = useState("");

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMessage("");
    try {
      await authenticationService.login(form);
      await refreshUser();
      navigate("/feed", { replace: true });
    } catch (error) {
      console.error(error);
      setErrorMessage("Administrator sign-in failed. Check the configured admin email and password.");
    }
  };

  return (
    <AuthLayout title="Administrator Login">
      <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
        <AuthInput label="Email" name="email" value={form.email} onChange={handleChange} />
        <AuthInput label="Password" type="password" name="password" value={form.password} onChange={handleChange} />
        {errorMessage && <p role="alert" className="text-sm text-red-700">{errorMessage}</p>}
        <button className="rounded-md bg-blue-600 py-2 text-white" type="submit">Login</button>
        <p className="text-center text-xs text-slate-500">Administrator access only. Public registration is disabled by default.</p>
      </form>
    </AuthLayout>
  );
};

export default Login;
