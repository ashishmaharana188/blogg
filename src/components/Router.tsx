import { Link, Route, Routes } from "react-router-dom";
import HomePage from "../pages/HomePage";
import BlogPage from "../pages/BlogPage";

const Router = () => {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />

      <Route path="/blog" element={<BlogPage />} />
    </Routes>
  );
};

export default Router;
