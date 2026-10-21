import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import AuthLayout from "../components/authLayout";
import AuthInput from "../components/authInput";
import authenticationService from "../services/authenticationService";
import { useAuth } from "../../../context/authContext";
import AssetStateBox from "../../../components/AssetStateBox";
import { reportUiFailure } from "../../../utils/uiDiagnostics";

const Login = () => {
  const navigate = useNavigate();
  const { refreshUser } = useAuth();
  const [form, setForm] = useState({ email: "", password: "" });
  const [requestFailed, setRequestFailed] = useState(false);
  const [registrationEnabled, setRegistrationEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    authenticationService
      .registrationStatus()
      .then((status) => {
        if (!cancelled) setRegistrationEnabled(status.registrationEnabled === true);
      })
      .catch((error) => {
        reportUiFailure("Login.registrationStatus", error);
        if (!cancelled) setRegistrationEnabled(false);
      });
    return () => { cancelled = true; };
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    setRequestFailed(false);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setRequestFailed(false);
    try {
      await authenticationService.login(form);
      await refreshUser();
      navigate("/feed", { replace: true });
    } catch (error) {
      reportUiFailure("Login.submit", error);
      setRequestFailed(true);
    }
  };

  return (
    <AuthLayout title="Administrator Login">
      <form className="auth-form" onSubmit={handleSubmit}>
        <AuthInput label="Email" name="email" value={form.email} onChange={handleChange} />
        <AuthInput label="Password" type="password" name="password" value={form.password} onChange={handleChange} />
        {requestFailed && <AssetStateBox status="error" compact />}
        <button className="auth-submit" type="submit">Login</button>
        {registrationEnabled ? (
          <p className="auth-supporting-copy">
            Initial setup? <Link to="/register" className="auth-text-link">Create administrator account</Link>
          </p>
        ) : (
          <p className="auth-supporting-copy auth-muted-copy">Administrator access only. Account creation is disabled.</p>
        )}
      </form>
    </AuthLayout>
  );
};

export default Login;
