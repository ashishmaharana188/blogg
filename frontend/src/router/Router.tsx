import { Navigate, Route, Routes } from "react-router-dom";
import Login from "../pages/Authentication/pages/login";
import Register from "../pages/Authentication/pages/register";
import HomePage from "../pages/BloggFeed/BlogFeed";
import BloggPage from "../pages/BloggPage/BloggPage";
import BloggReadPage from "../pages/BloggReadPage";
import BloggEmbedPage from "../pages/BloggEmbed/BloggEmbedPage";
import AccountPage from "../pages/Account/AccountPage";

/** Reading the feed and opening shared notes are public. Account routes remain optional. */
const Router = () => (
  <Routes>
    <Route path="/" element={<Navigate to="/feed" replace />} />
    <Route path="/account" element={<AccountPage />} />
    <Route path="/login" element={<Login />} />
    <Route path="/register" element={<Register />} />
    <Route path="/feed" element={<HomePage />} />
    <Route path="/blog" element={<BloggPage />} />
    <Route path="/blog/:bloggId" element={<BloggPage />} />
    <Route path="/read/:bloggId" element={<BloggReadPage />} />
    <Route path="/embed/:bloggId" element={<BloggEmbedPage />} />
    <Route path="*" element={<Navigate to="/feed" replace />} />
  </Routes>
);

export default Router;
