import { Navigate, Route, Routes } from "react-router-dom";

import Login from "../pages/Authentication/pages/login";
import Register from "../pages/Authentication/pages/register";

import HomePage from "../pages/BloggFeed/BlogFeed";
import BloggPage from "../pages/BloggPage/BloggPage";

const isAuthenticated = false; // Replace with auth state later

const Router = () => {
  return (
    <Routes>
      {/* Public Routes */}

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
        element={isAuthenticated ? <HomePage /> : <Navigate to="/" replace />}
      />

      <Route
        path="/blog"
        element={isAuthenticated ? <BloggPage /> : <Navigate to="/" replace />}
      />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

export default Router;
