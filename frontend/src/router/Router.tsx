import { Navigate, Route, Routes, useParams } from "react-router-dom";
import Login from "../pages/Authentication/pages/login";
import Register from "../pages/Authentication/pages/register";
import HomePage from "../pages/BloggFeed/BlogFeed";
import BloggPage from "../pages/BloggPage/BloggPage";
import BloggReadPage from "../pages/BloggReadPage";
import BloggEmbedPage from "../pages/BloggEmbed/BloggEmbedPage";
import AccountPage from "../pages/Account/AccountPage";
import FeedBackgroundAdminPanel from "../components/FeedBackgroundAdminPanel";

function SharedBloggRedirect() {
  const { bloggId = "" } = useParams<{ bloggId: string }>();
  return <Navigate to={`/read/${encodeURIComponent(bloggId)}`} replace />;
}

function AdminAccountPage() {
  return <> <AccountPage /> <FeedBackgroundAdminPanel /> </>;
}

/** Reading the feed and opening shared notes are public. Account routes remain optional. */
const Router = () => (
  <Routes>
    <Route path="/" element={<Navigate to="/feed" replace />} />
    <Route path="/account" element={<AdminAccountPage />} />
    <Route path="/login" element={<Login />} />
    <Route path="/register" element={<Register />} />
    <Route path="/feed" element={<HomePage />} />
    <Route path="/blog" element={<BloggPage />} />
    <Route path="/blog/:bloggId" element={<BloggPage />} />
    <Route path="/read/:bloggId" element={<BloggReadPage />} />
    <Route path="/embed/:bloggId" element={<BloggEmbedPage />} />
    <Route path="/share/account" element={<Navigate to="/account?view=public" replace />} />
    <Route path="/share/:bloggId" element={<SharedBloggRedirect />} />
    <Route path="*" element={<Navigate to="/feed" replace />} />
  </Routes>
);

export default Router;
