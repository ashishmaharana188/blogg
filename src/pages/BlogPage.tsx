import BloggPage from "../components/bloggMain";
import { Link } from "react-router-dom";

const BlogPage = () => {
  return (
    <div className="w-full min-h-screen relative">
      <div className="flex flex-col">
        <div className="mt-10 ml-5">
          <Link className="text-black" to="/">
            HOMEPAGE
          </Link>
        </div>

        <BloggPage />
      </div>
    </div>
  );
};

export default BlogPage;
