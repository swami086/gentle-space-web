import { describe, expect, it } from "vitest";
import { safeReturnTo } from "./safe-redirect";

describe("safeReturnTo", () => {
  it("falls back to / when value is missing", () => {
    expect(safeReturnTo(null, "https://auth.gentlespacesolutions.com", "gentlespacesolutions.com")).toBe(
      "https://auth.gentlespacesolutions.com/",
    );
  });

  it("falls back to / when value is not a valid URL", () => {
    expect(
      safeReturnTo("not a url", "https://auth.gentlespacesolutions.com", "gentlespacesolutions.com"),
    ).toBe("https://auth.gentlespacesolutions.com/");
  });

  it("allows a URL on the exact cookie-domain host", () => {
    const value = "https://gentlespacesolutions.com/foo";
    expect(safeReturnTo(value, "https://auth.gentlespacesolutions.com", "gentlespacesolutions.com")).toBe(
      value,
    );
  });

  it("allows a URL on a subdomain of the cookie domain", () => {
    const value = "https://ads.gentlespacesolutions.com/campaigns";
    expect(safeReturnTo(value, "https://auth.gentlespacesolutions.com", "gentlespacesolutions.com")).toBe(
      value,
    );
  });

  it("rejects an unrelated external host", () => {
    expect(
      safeReturnTo(
        "https://evil.example.com/phish",
        "https://auth.gentlespacesolutions.com",
        "gentlespacesolutions.com",
      ),
    ).toBe("https://auth.gentlespacesolutions.com/");
  });

  it("allows localhost for local dev regardless of cookieDomain", () => {
    const value = "http://localhost:3030/campaigns";
    expect(safeReturnTo(value, "http://localhost:3040", "localhost")).toBe(value);
  });
});
