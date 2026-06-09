import { Link } from "react-router-dom";

const Router = () => {
  return (
    <div className="flex gap-4 p-4 text-black">
      <Link to="/">Home</Link>

      <Link className="text-black" to="/blog">
        New Blog
      </Link>
    </div>
  );
};

export default Router;
