import { Link } from "react-router-dom";

const HomePage = () => {
  return (
    <div className="w-full min-h-screen relative">
      <div className="mt-10 ml-5">
        <Link className="text-black" to="/blog">
          BLOGPAGE
        </Link>
      </div>
    </div>
  );
};

export default HomePage;
