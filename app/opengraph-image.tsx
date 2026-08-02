import { ImageResponse } from "next/og";

export const alt =
  "Gentle Space CRE — Commercial Real Estate Consultants in Bangalore";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Branded social card. Colors mirror the light-theme tokens in globals.css.
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
          padding: "72px 80px",
          background: "#141218",
          color: "#f2eff7",
          fontFamily: "Georgia, serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              background: "#8b6fd1",
            }}
          />
          <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: -0.5 }}>
            Gentle Space CRE
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div
            style={{
              fontSize: 62,
              fontWeight: 700,
              lineHeight: 1.1,
              maxWidth: 900,
            }}
          >
            Commercial space in Bangalore, matched to your brief.
          </div>
          <div style={{ fontSize: 28, color: "#c4bdd4", maxWidth: 820 }}>
            Office, retail and warehouse — verified, negotiated, and handled
            through to signing.
          </div>
        </div>

        <div style={{ fontSize: 24, color: "#9b93ad" }}>
          Commercial Real Estate Consultants · Bengaluru
        </div>
      </div>
    ),
    { ...size },
  );
}
