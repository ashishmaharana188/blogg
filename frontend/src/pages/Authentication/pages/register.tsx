import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AuthLayout from "../components/authLayout";
import AuthInput from "../components/authInput";
import authenticationService from "../services/authenticationService";
import { useAuth } from "../../../context/authContext";
import AssetStateBox from "../../../components/AssetStateBox";
import { reportUiFailure } from "../../../utils/uiDiagnostics";

const Register = () => {
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const [form, setForm] = useState({ username: "", email: "", password: "", confirmPassword: "" });
  const [validationError, setValidationError] = useState("");
  const [requestFailed, setRequestFailed] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    setValidationError("");
    setRequestFailed(false);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setValidationError("");
    setRequestFailed(false);
    if (form.password !== form.confirmPassword) {
      setValidationError("Passwords do not match.");
      return;
    }
    try {
      await authenticationService.register({ username: form.username, email: form.email, password: form.password });
      await refreshUser();
      navigate("/feed", { replace: true });
    } catch (error) {
      reportUiFailure("Register.submit", error);
      setRequestFailed(true);
    }
  };

  return (
    <AuthLayout title="Create Administrator Account">
      <form className="auth-form" onSubmit={handleSubmit}>
        <AuthInput label="Username" name="username" value={form.username} onChange={handleChange} />
        <AuthInput label="Administrator email" name="email" value={form.email} onChange={handleChange} />
        <AuthInput label="Password" type="password" name="password" value={form.password} onChange={handleChange} />
        <AuthInput label="Confirm Password" type="password" name="confirmPassword" value={form.confirmPassword} onChange={handleChange} />
        {validationError && <p role="alert" className="auth-error">{validationError}</p>}
        {requestFailed && <AssetStateBox status="error" compact />}
        <button className="auth-submit" type="submit">Create Admin Account</button>
        <p className="auth-supporting-copy auth-muted-copy">One administrator account only. Turn registration off again after the initial account has been created.</p>
        <p className="auth-supporting-copy"><Link to="/login" className="auth-text-link">Back to administrator login</Link></p>
      </form>
    </AuthLayout>
  );
};

export default Register;
