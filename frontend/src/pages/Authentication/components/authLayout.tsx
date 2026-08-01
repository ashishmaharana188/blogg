import { ReactNode } from "react";

interface Props {
  title: string;
  children: ReactNode;
}

const AuthLayout = ({ title, children }: Props) => {
  return (
    <div className="min-h-screen flex justify-center items-center bg-gray-100">
      <div className="bg-white shadow-lg rounded-xl w-full max-w-md p-8">
        <h1 className="text-3xl font-bold mb-6 text-center">{title}</h1>

        {children}
      </div>
    </div>
  );
};

export default AuthLayout;
