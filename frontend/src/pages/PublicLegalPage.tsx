import { useEffect } from "react";
import { Link } from "react-router-dom";
import BloggHeader from "./BloggPage/components/bloggHeader/BloggHeader";
import "./publicLegalPage.css";

type PublicLegalPageProps = {
  kind: "privacy" | "terms";
};

function PrivacyPolicy() {
  return (
    <>
      <p className="blogg-legal-intro">
        This policy explains what information Blogg processes, how it is used,
        and the choices available to people who use the site.
      </p>

      <section>
        <h2>1. About Blogg</h2>
        <p>
          Blogg is a publishing and personal library site. It lets people read
          public notes and, where an account is enabled, create, organize, manage,
          and share their own content. Optional features include media showcases
          and optional integrations with services such as YouTube and Spotify.
          A configured Gmail account may also be used by the administrator to
          deliver site newsletters.
        </p>
      </section>

      <section>
        <h2>2. Information processed by Blogg</h2>
        <p>Depending on the features you use, Blogg may process:</p>
        <ul>
          <li>
            <strong>Account and session information:</strong> information needed
            to register, sign in, maintain a session, and protect an account,
            such as an account identifier and associated email address.
          </li>
          <li>
            <strong>Content you provide:</strong> notes, titles, descriptions,
            tags, links, images, files, and other information you choose to
            create, upload, or publish.
          </li>
          <li>
            <strong>Optional personal-library entries:</strong> information you
            choose to enter or import into optional reading, activity, or other
            personal tracking features.
          </li>
          <li>
            <strong>Newsletter information:</strong> email addresses and
            subscription preferences provided when someone subscribes, plus
            message and delivery information needed to send newsletters.
          </li>
          <li>
            <strong>Technical and diagnostic information:</strong> request
            timestamps, page or route information, browser/device details, and
            error information used to maintain and troubleshoot the service.
          </li>
        </ul>
      </section>

      <section>
        <h2>3. YouTube API Services and Google data</h2>
        <p>
          Blogg uses YouTube API Services. When an administrator connects a
          Google account to the YouTube Library, Blogg requests read-only
          YouTube access through Google's OAuth authorization flow. The current
          integration uses the YouTube read-only scope and does not request
          permission to upload, edit, or delete YouTube videos or playlists.
        </p>
        <p>
          Depending on the enabled feature, Blogg may retrieve public playlists
          from the connected YouTube channel, playlist video information, and
          liked videos in the Music category for the YouTube Music picker. The
          information can include playlist and video identifiers, titles,
          channel or artist names, descriptions, thumbnails, item counts, and
          links.
        </p>
        <p>
          The YouTube Data API does not provide a user's YouTube Music listening
          history to this integration. Blogg does not label a liked video as
          listening history. A track selected by the administrator, or a
          supported liked-music fallback, may appear in the public music widget
          when that feature is enabled.
        </p>
        <p>
          Blogg uses YouTube data only to provide the YouTube Library and the
          related music and media display features described here. Blogg does
          not sell Google user data or use it for advertising. Blogg's use and
          transfer of information received from Google APIs will adhere to the
          Google API Services User Data Policy, including its Limited Use
          requirements.
        </p>
        <h3>Spotify</h3>
        <p>
          If the administrator connects Spotify, Blogg requests permission to
          read current playback state and currently playing track information.
          The integration can process playback status, track title, artist,
          album artwork, and links so that a currently playing track can be
          displayed in the site's music showcase. Blogg does not request
          permission to control playback or modify a Spotify library through
          these scopes. The Spotify connection can be disconnected by the
          administrator.
        </p>
        <h3>Gmail and newsletter delivery</h3>
        <p>
          Blogg can use a separately configured Gmail account to send
          administrator-initiated newsletters. The backend uses the Gmail
          send-only permission to send messages to newsletter recipients. It
          does not use this integration to read the sender's inbox or retrieve
          email content. The newsletter sender's OAuth client credentials and
          refresh token are held in the backend's server environment
          configuration and used by the server to obtain access tokens for
          sending.
        </p>
        <p>
          Read Google's{" "}
          <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">
            Privacy Policy
          </a>{" "}
          and the{" "}
          <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">
            Google API Services User Data Policy
          </a>.
        </p>
      </section>

      <section>
        <h2>4. How YouTube information is stored</h2>
        <p>
          The Google OAuth refresh token is stored by Blogg's server in encrypted
          form using AES-256-GCM encryption. The server uses it to request
          short-lived access tokens when it needs to call the YouTube API. The
          token is not intentionally exposed in the public feed or stored in the
          browser's local storage.
        </p>
        <p>
          YouTube playlist and liked-video responses may be cached temporarily
          to support the library and music features. Playback information may
          be read from Spotify when the integration is connected. Administrator-
          selected Now Playing and public-track settings are stored so the
          chosen display can be maintained. Only information intentionally
          selected or enabled for public display is presented to site visitors.
        </p>
      </section>

      <section>
        <h2>5. How information is used and shared</h2>
        <p>Blogg uses information to:</p>
        <ul>
          <li>operate accounts, sessions, and site features;</li>
          <li>store and display notes or other content according to its visibility settings;</li>
          <li>provide requested YouTube Library and media showcase features;</li>
          <li>secure, debug, maintain, and improve the service; and</li>
          <li>respond to support, privacy, or legal requests.</li>
        </ul>
        <p>
          Blogg does not sell personal information. Information may be processed
          by hosting, database, security, and other service providers only as
          needed to operate the site, or disclosed where required by law or
          necessary to protect the service and its users. Public notes and
          information deliberately placed in public showcase features can be
          viewed by visitors.
        </p>
      </section>

      <section>
        <h2>6. Retention and deletion</h2>
        <p>
          Blogg keeps account information and content for as long as needed to
          provide the service or until it is deleted. Temporary API caches
          expire automatically. The stored YouTube connection remains until it
          is disconnected, revoked, or deleted as part of a privacy request.
        </p>
        <p>
          You can revoke Blogg's Google access through your{" "}
          <a href="https://myaccount.google.com/connections" target="_blank" rel="noreferrer">
            Google Account connections
          </a>. To request deletion of information retained by Blogg, email the
          contact address below and identify the account or data concerned.
          Revoking Google access does not by itself delete notes or other
          information previously stored in Blogg.
        </p>
      </section>

      <section>
        <h2>7. Security</h2>
        <p>
          Blogg uses technical and organizational measures intended to protect
          information, including server-side access controls and encryption of
          stored Google OAuth refresh tokens. No internet service or storage
          system can be guaranteed to be completely secure.
        </p>
      </section>

      <section>
        <h2>8. Third-party services</h2>
        <p>
          Blogg may link to or integrate with third-party services. Those
          services operate under their own terms and privacy policies. When you
          use YouTube features, your use is also subject to{" "}
          <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">
            YouTube's Terms of Service
          </a>.
        </p>
      </section>

      <section>
        <h2>9. Changes to this policy</h2>
        <p>
          This policy may be updated when Blogg's features, data practices, or
          legal requirements change. The effective date at the top of this page
          identifies the latest published version.
        </p>
      </section>

      <section>
        <h2>10. Contact</h2>
        <p>
          For privacy questions or data requests, contact{" "}
          <a href="mailto:ashishmoharana7188@gmail.com">
            ashishmoharana7188@gmail.com
          </a>.
        </p>
      </section>
    </>
  );
}

function TermsOfService() {
  return (
    <>
      <p className="blogg-legal-intro">
        These terms describe the basic rules for accessing and using Blogg.
        Please read them together with the <Link to="/privacy">Privacy Policy</Link>.
      </p>

      <section>
        <h2>1. Using Blogg</h2>
        <p>
          Blogg provides a site for reading, writing, organizing, and sharing
          notes and related content. Some features require an account or are
          available only to the site administrator. By accessing or using Blogg,
          you agree to these terms.
        </p>
      </section>

      <section>
        <h2>2. Accounts and access</h2>
        <p>
          You are responsible for keeping your sign-in credentials and account
          access secure, and for activity carried out through your account.
          Provide accurate information where the service asks for it. Do not
          attempt to bypass access controls or use another person's account
          without permission.
        </p>
      </section>

      <section>
        <h2>3. Your content</h2>
        <p>
          You retain the rights you hold in content you create or upload.
          You are responsible for having the rights and permissions needed to
          submit that content. You grant Blogg permission to host, process,
          display, and distribute the content only as needed to operate the
          features and visibility settings you choose.
        </p>
        <p>
          Content marked or submitted for public display may be accessible to
          anyone. Do not publish confidential or sensitive information unless
          you intend it to be public. The site administrator may remove content
          that violates these terms or creates legal, safety, or operational
          concerns.
        </p>
      </section>

      <section>
        <h2>4. Acceptable use</h2>
        <p>You must not use Blogg to:</p>
        <ul>
          <li>break the law, violate another person's rights, or distribute harmful or deceptive material;</li>
          <li>interfere with the site's operation, security, or availability;</li>
          <li>attempt unauthorized access to accounts, systems, or data; or</li>
          <li>upload content that you do not have permission to use.</li>
        </ul>
      </section>

      <section>
        <h2>5. YouTube API Services</h2>
        <p>
          Blogg's YouTube Library and related music features use YouTube API
          Services. By using those features, you also agree to be bound by{" "}
          <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">
            YouTube's Terms of Service
          </a>. Your use of YouTube remains subject to Google's and YouTube's
          applicable policies.
        </p>
        <p>
          You can disconnect or revoke Blogg's Google authorization through your{" "}
          <a href="https://myaccount.google.com/connections" target="_blank" rel="noreferrer">
            Google Account connections
          </a>. Blogg's handling of information obtained through YouTube API
          Services is described in the <Link to="/privacy">Privacy Policy</Link>.
        </p>
      </section>

      <section>
        <h2>6. Third-party services and links</h2>
        <p>
          Blogg may link to services operated by third parties. Blogg does not
          control those services and is not responsible for their content,
          availability, or policies. Your use of a third-party service is
          governed by that provider's terms.
        </p>
      </section>

      <section>
        <h2>7. Availability and disclaimers</h2>
        <p>
          Blogg is provided on an as-available basis. Features may change,
          become temporarily unavailable, or be removed. To the extent permitted
          by law, Blogg is provided without warranties of uninterrupted
          availability, accuracy, or fitness for a particular purpose.
        </p>
        <p>
          Content and optional tracking tools are provided for general
          information and personal organization. They are not medical, legal,
          financial, or other professional advice.
        </p>
      </section>

      <section>
        <h2>8. Suspension or termination</h2>
        <p>
          Access may be suspended or terminated where necessary to protect the
          service, comply with law, address misuse, or enforce these terms.
          You may stop using Blogg at any time and may request deletion of
          eligible account information as described in the Privacy Policy.
        </p>
      </section>

      <section>
        <h2>9. Changes to these terms</h2>
        <p>
          These terms may be revised as Blogg changes. Continued use after an
          updated version is published constitutes acceptance of the revised
          terms to the extent permitted by applicable law.
        </p>
      </section>

      <section>
        <h2>10. Contact</h2>
        <p>
          Questions about these terms can be sent to{" "}
          <a href="mailto:ashishmoharana7188@gmail.com">
            ashishmoharana7188@gmail.com
          </a>.
        </p>
      </section>
    </>
  );
}

export default function PublicLegalPage({ kind }: PublicLegalPageProps) {
  const title = kind === "privacy" ? "Privacy Policy" : "Terms of Service";

  useEffect(() => {
    const previousTitle = window.document.title;
    window.document.title = `${title} | Blogg`;
    return () => {
      window.document.title = previousTitle;
    };
  }, [title]);

  return (
    <div className="blog-feed-page typewriter-font blogg-legal-page">
      <BloggHeader page="feed" />
      <main className="blogg-legal-content">
        <div className="blogg-legal-topline">
          <Link to="/feed">← Back to Blogg Feed</Link>
          <span>Last updated: 1 November 2026</span>
        </div>
        <article className="blogg-legal-card">
          <header className="blogg-legal-heading">
            <p className="blogg-legal-eyebrow">BLOGG · SITE POLICIES</p>
            <h1>{title}</h1>
            <p>Effective date: 1 November 2026</p>
          </header>
          {kind === "privacy" ? <PrivacyPolicy /> : <TermsOfService />}
          <nav className="blogg-legal-bottom-links" aria-label="Other legal information">
            <Link to="/privacy">Privacy Policy</Link>
            <Link to="/terms">Terms of Service</Link>
            <Link to="/feed">Blogg Feed</Link>
          </nav>
        </article>
      </main>
    </div>
  );
}
