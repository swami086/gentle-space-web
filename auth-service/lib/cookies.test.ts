import { describe, expect, it } from "vitest";
import { authCookieBase } from "./cookies";

describe("authCookieBase", () => {
  it("omits Domain when COOKIE_DOMAIN is localhost", () => {
    process.env.COOKIE_DOMAIN = "localhost";
    const opts = authCookieBase(60, { shareDomain: true });
    expect(opts.domain).toBeUndefined();
    expect(opts.secure).toBe(false);
  });

  it("sets Domain for shared prod cookie", () => {
    process.env.COOKIE_DOMAIN = ".gentlespacesolutions.com";
    const opts = authCookieBase(60, { shareDomain: true });
    expect(opts.domain).toBe(".gentlespacesolutions.com");
    expect(opts.secure).toBe(true);
  });

  it("never sets Domain for host-only refresh cookies", () => {
    process.env.COOKIE_DOMAIN = ".gentlespacesolutions.com";
    const opts = authCookieBase(60, { shareDomain: false });
    expect(opts.domain).toBeUndefined();
  });
});
