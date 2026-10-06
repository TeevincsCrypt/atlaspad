import { afterEach, describe, expect, it } from "vitest";
import { adminConfigured, isAdminAuthorized } from "@/lib/admin-auth";

const basic = (user: string, pass: string) => `Basic ${btoa(`${user}:${pass}`)}`;

afterEach(() => {
  delete process.env.ADMIN_USERNAME;
  delete process.env.ADMIN_PASSWORD;
});

describe("admin basic auth", () => {
  it("is disabled unless both credentials are set", () => {
    expect(adminConfigured()).toBe(false);
    expect(isAdminAuthorized(basic("", ""))).toBe(false);
  });

  it("requires a password of at least 12 characters", () => {
    process.env.ADMIN_USERNAME = "ops";
    process.env.ADMIN_PASSWORD = "short";
    expect(adminConfigured()).toBe(false);
    expect(isAdminAuthorized(basic("ops", "short"))).toBe(false);
  });

  it("accepts only the exact credentials", () => {
    process.env.ADMIN_USERNAME = "ops";
    process.env.ADMIN_PASSWORD = "a-long:password-123";
    expect(isAdminAuthorized(basic("ops", "a-long:password-123"))).toBe(true);
    expect(isAdminAuthorized(basic("ops", "a-long:password-12"))).toBe(false);
    expect(isAdminAuthorized(basic("op", "a-long:password-123"))).toBe(false);
    expect(isAdminAuthorized("Bearer abc")).toBe(false);
    expect(isAdminAuthorized("Basic %%%")).toBe(false);
    expect(isAdminAuthorized(null)).toBe(false);
  });
});
