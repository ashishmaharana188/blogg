import BloggPage from "../components/bloggMain";

const BlogPage = () => {
  return (
    <div>
      <li>
        <a className={"text-black"} href="/blog">
          BLOGPAGE
        </a>
        <BloggPage />
      </li>
    </div>
  );
};

export default BlogPage;
