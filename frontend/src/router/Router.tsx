import { Navigate, Route, Routes } from "react-router-dom";

import Login from "../pages/Authentication/pages/login";
import Register from "../pages/Authentication/pages/register";

import HomePage from "../pages/BloggFeed/BlogFeed";
import BloggPage from "../pages/BloggPage/BloggPage";

import { useAuth } from "../context/authContext";

const Router = () => {
  const { user, loading } = useAuth();

  if (loading) {
    return null;
  }

  const isAuthenticated = !!user;

  return (
    <Routes>
      {/* Public Routes */}

      <Route
        path="/"
        element={
          isAuthenticated ? (
            <Navigate to="/feed" replace />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />

      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to="/feed" replace /> : <Login />}
      />

      <Route
        path="/register"
        element={
          isAuthenticated ? <Navigate to="/feed" replace /> : <Register />
        }
      />

      {/* Protected Routes */}

      <Route
        path="/feed"
        element={
          isAuthenticated ? <HomePage /> : <Navigate to="/login" replace />
        }
      />

      <Route
        path="/blog"
        element={
          isAuthenticated ? <BloggPage /> : <Navigate to="/login" replace />
        }
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

export default Router;
