import { Route, Routes } from "react-router-dom";
import HomePage from "../pages/BlogFeed";
import BloggPage from "../pages/BloggPage";

const Router = () => {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />

      <Route path="/blog" element={<BloggPage />} />
    </Routes>
  );
};

export default Router;
