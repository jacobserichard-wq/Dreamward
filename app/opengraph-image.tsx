// app/opengraph-image.tsx
//
// Site-wide Open Graph / social share card (2026-07-02 review — every
// page previously shared as a BLANK card on FB/IG/Pinterest/iMessage/
// Slack/LinkedIn). Placed at the app root so all routes inherit it
// unless they define their own opengraph-image. Rendered with next/og
// ImageResponse (Satori): inline styles only, and any element with >1
// child must set display:flex. Brand hex pulled from app/globals.css.

import { ImageResponse } from "next/og";

export const alt =
  "Dreamward — real margin for makers who sell in person and online";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          backgroundColor: "#f7f4eb",
          padding: "68px 76px",
          fontFamily: "sans-serif",
        }}
      >
        {/* Brand row */}
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <svg width="60" height="60" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 22V10"
              stroke="#6e8970"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <path
              d="M12 13c-3.3 0-6-2.7-6-6 3.3 0 6 2.7 6 6Z"
              fill="#6e8970"
            />
            <path
              d="M12 11c0-3.3 2.7-6 6-6 0 3.3-2.7 6-6 6Z"
              fill="#6e8970"
            />
          </svg>
          <div style={{ fontSize: 40, fontWeight: 700, color: "#34362e" }}>
            Dreamward
          </div>
        </div>

        {/* Headline + subline */}
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              fontSize: 82,
              fontWeight: 700,
              color: "#34362e",
              lineHeight: 1.05,
              letterSpacing: "-0.02em",
            }}
          >
            Built for people.
          </div>
          <div
            style={{
              fontSize: 82,
              fontWeight: 700,
              color: "#34362e",
              lineHeight: 1.05,
              letterSpacing: "-0.02em",
            }}
          >
            Priced for people.
          </div>
          <div
            style={{
              fontSize: 34,
              color: "#62675a",
              marginTop: 26,
              lineHeight: 1.3,
            }}
          >
            Real margin for makers who sell in person and online.
          </div>
        </div>

        {/* Bottom strip */}
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              display: "flex",
              backgroundColor: "#dce3d2",
              color: "#566b4e",
              padding: "8px 22px",
              borderRadius: 999,
              fontSize: 26,
              fontWeight: 600,
            }}
          >
            from $10/mo
          </div>
          <div style={{ display: "flex", fontSize: 26, color: "#9aa08e" }}>
            Every feature, every plan · godreamward.com
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
