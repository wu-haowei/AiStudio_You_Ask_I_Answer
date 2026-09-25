import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv, type Plugin} from 'vite';

/*
 * Content Security Policy, added to the built page only.
 *
 * The site is served from GitHub Pages, which cannot set response headers, so the policy
 * goes in a <meta> tag. That covers what a meta tag can (which scripts, connections,
 * frames and forms the page may use) but not `frame-ancestors`, `X-Frame-Options` or
 * `nosniff` — those only work as real headers. Framing is handled separately by
 * public/frame-guard.js.
 *
 * It is not added in development: Vite's dev server injects inline scripts and a
 * websocket for hot reload that a strict policy would (correctly) refuse.
 *
 * Everything the app talks to is listed here. If a new external service is added and
 * stops working in the deployed site, its origin belongs in the matching directive.
 */
const contentSecurityPolicy = (extraConnect: string[]): string =>
  [
    "default-src 'self'",
    // Bundled scripts only — plus reCAPTCHA, which App Check loads when it is switched on
    "script-src 'self' https://www.google.com/recaptcha/ https://www.gstatic.com/recaptcha/",
    // Inline style="" attributes are used for safe-area padding and dynamic colours
    "style-src 'self' 'unsafe-inline'",
    // Backgrounds are stored as data: URLs and cropped through blob: URLs
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    [
      "connect-src 'self'",
      'https://*.googleapis.com', // Firestore, Auth (Identity Toolkit, Secure Token), Drive, App Check
      'https://www.google.com', // reCAPTCHA
      ...extraConnect,
    ].join(' '),
    "frame-src https://www.google.com https://*.firebaseapp.com", // reCAPTCHA challenge, Firebase Auth helper frame
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');

const securityMeta = (mode: string): Plugin => ({
  name: 'security-meta',
  apply: 'build',
  transformIndexHtml(html) {
    const env = loadEnv(mode, process.cwd(), 'VITE_');
    // A build made to test against the local emulator needs to reach it
    const extraConnect =
      env.VITE_USE_EMULATOR === 'true' ? ['http://127.0.0.1:8080', 'http://127.0.0.1:9099'] : [];
    const tags = [
      `<meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy(extraConnect)}" />`,
      // Email-link URLs carry a one-time code; other sites should only ever learn the origin
      '<meta name="referrer" content="strict-origin-when-cross-origin" />',
      '<script src="./frame-guard.js"></script>',
    ].join('\n    ');
    return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    ${tags}`);
  },
});

export default defineConfig(({mode}) => {
  return {
    base: './',
    plugins: [react(), tailwindcss(), securityMeta(mode)],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
