import React from "react";

interface AuthInputProps {
  label: string;
  type?: string;
  name: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

const AuthInput = ({
  label,
  type = "text",
  name,
  value,
  onChange,
}: AuthInputProps) => {
  const id = `auth-field-${name}`;

  return (
    <div className="auth-field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        name={name}
        value={value}
        onChange={onChange}
        autoComplete={name === "email" ? "email" : name.toLowerCase().includes("password") ? (name === "confirmPassword" ? "new-password" : "current-password") : "username"}
        required
      />
    </div>
  );
};

export default AuthInput;
