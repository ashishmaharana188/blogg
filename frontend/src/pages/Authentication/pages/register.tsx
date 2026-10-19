import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AuthLayout from "../components/authLayout";
import AuthInput from "../components/authInput";
import authenticationService from "../services/authenticationService";
import { useAuth } from "../../../context/authContext";

const Register = () => {
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const [form, setForm] = useState({ username: "", email: "", password: "", confirmPassword: "" });
  const [errorMessage, setErrorMessage] = useState("");

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMessage("");
    if (form.password !== form.confirmPassword) {
      setErrorMessage("Passwords do not match.");
      return;
    }
    try {
      await authenticationService.register({ username: form.username, email: form.email, password: form.password });
      await refreshUser();
      navigate("/feed", { replace: true });
    } catch (error) {
      console.error(error);
      setErrorMessage("Admin registration is disabled unless ENABLE_ADMIN_REGISTRATION is temporarily enabled on the server, and the email must match ADMIN_EMAIL.");
    }
  };

  return (
    <AuthLayout title="Create Administrator Account">
      <form className="flex flex-col gap-5" onSubmit={handleSubmit}>
        <AuthInput label="Username" name="username" value={form.username} onChange={handleChange} />
        <AuthInput label="Administrator email" name="email" value={form.email} onChange={handleChange} />
        <AuthInput label="Password" type="password" name="password" value={form.password} onChange={handleChange} />
        <AuthInput label="Confirm Password" type="password" name="confirmPassword" value={form.confirmPassword} onChange={handleChange} />
        {errorMessage && <p role="alert" className="text-sm leading-5 text-red-700">{errorMessage}</p>}
        <button className="rounded-md bg-blue-600 py-2 text-white" type="submit">Create Admin Account</button>
        <p className="text-center text-xs text-slate-500">One administrator account only. Turn registration off again after the initial account has been created.</p>
        <p className="text-center text-sm"><Link to="/login" className="text-blue-600 hover:underline">Back to administrator login</Link></p>
      </form>
    </AuthLayout>
  );
};

export default Register;
