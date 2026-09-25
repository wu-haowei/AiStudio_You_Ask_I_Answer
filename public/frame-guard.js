/*
 * Anti-clickjacking, as far as a static host allows.
 *
 * The proper defence is a `frame-ancestors 'none'` / `X-Frame-Options: DENY` response
 * header, but GitHub Pages cannot send one and a <meta> tag's frame-ancestors is ignored.
 * So if this page finds itself inside somebody else's frame, it hides itself rather than
 * be shown under an invisible overlay, and tries to break out.
 *
 * This is a best-effort measure: a framing page can sandbox the frame to stop scripts
 * from running at all. It is loaded as its own file (not inline) so the page's Content
 * Security Policy does not need 'unsafe-inline' for scripts. It hides the page only when
 * framed, never the other way round, so a failure to load it cannot blank the site.
 */
if (window.top !== window.self) {
  document.documentElement.style.display = 'none';
  try {
    window.top.location = window.self.location;
  } catch (err) {
    // Cross-origin frames may not navigate their parent; staying hidden is the fallback
  }
}
