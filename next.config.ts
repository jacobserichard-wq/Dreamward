import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Per-route HTTP header overrides.
   *
   * /wix-bridge needs to be embeddable inside an iframe hosted on
   * Wix's dashboard (manage.wix.com and its subdomains). The default
   * security posture is to deny embedding entirely; here we override
   * the Content-Security-Policy `frame-ancestors` directive for that
   * one route, allowing self + wix.com.
   *
   * `frame-ancestors` is the modern replacement for `X-Frame-Options`
   * — when both are set, browsers honor `frame-ancestors`. Setting
   * just frame-ancestors is sufficient. We explicitly remove
   * `X-Frame-Options` for this route too (in case Vercel's edge
   * adds it) by setting it to an explicit allow value — actually,
   * X-Frame-Options doesn't support a domain allowlist (only DENY,
   * SAMEORIGIN, or the deprecated ALLOW-FROM), so we just omit it
   * here and rely on browsers honoring CSP frame-ancestors over the
   * missing X-Frame-Options.
   *
   * All other routes inherit the default (no override → default
   * Next.js behavior, which is no X-Frame-Options + no CSP, leaving
   * embedding semantically allowed but most browsers default-deny
   * for cross-origin iframes anyway).
   *
   * If we later add app-wide security headers, this entry stays as
   * a specific override.
   */
  async headers() {
    return [
      {
        source: "/wix-bridge",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "frame-ancestors 'self' https://manage.wix.com https://*.wix.com",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
