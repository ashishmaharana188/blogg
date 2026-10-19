import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import "./authPages.css";

interface Props {
  title: string;
  children: ReactNode;
}

const AuthLayout = ({ title, children }: Props) => (
  <div className="auth-page typewriter-font">
    <header className="auth-site-header">
      <Link to="/feed" className="auth-site-link">BLOG FEED</Link>
      <span className="auth-site-rule" aria-hidden="true" />
      <Link to="/blog" className="auth-site-link">BLOG PROFILE</Link>
    </header>

    <main className="auth-main">
      <section className="auth-card" aria-labelledby="auth-page-title">
        <p className="auth-eyebrow">SITE ACCOUNT</p>
        <h1 id="auth-page-title" className="auth-title">{title}</h1>
        {children}
      </section>
    </main>
  </div>
);

export default AuthLayout;
