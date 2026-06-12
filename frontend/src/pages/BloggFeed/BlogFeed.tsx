import { Link } from "react-router-dom";

const HomePage = () => {
  return (
    <div className="w-full min-h-screen relative">
      <div className="mt-10 ml-10">
        <Link className="text-black hover:font-bold" to="/blog">
          BLOG PROFILE
        </Link>
      </div>
    </div>
  );
};

export default HomePage;
