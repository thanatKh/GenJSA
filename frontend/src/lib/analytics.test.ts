// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { loadCloudflareAnalytics } from "./analytics";

const beacons = () => document.querySelectorAll("script[data-cf-beacon]");

describe("loadCloudflareAnalytics", () => {
  beforeEach(() => beacons().forEach((s) => s.remove()));

  it("loads the beacon once on the deployed site, with the configured token", () => {
    expect(loadCloudflareAnalytics("abc123", "genjsa.example.com")).toBe(true);
    expect(loadCloudflareAnalytics("abc123", "genjsa.example.com")).toBe(false);
    expect(beacons()).toHaveLength(1);
    expect(JSON.parse(beacons()[0].getAttribute("data-cf-beacon")!)).toEqual({ token: "abc123" });
  });

  it("stays off without a token, and on localhost", () => {
    expect(loadCloudflareAnalytics("", "genjsa.example.com")).toBe(false);
    expect(loadCloudflareAnalytics(undefined, "genjsa.example.com")).toBe(false);
    expect(loadCloudflareAnalytics("abc123", "localhost")).toBe(false);
    expect(loadCloudflareAnalytics("abc123", "127.0.0.1")).toBe(false);
    expect(beacons()).toHaveLength(0);
  });
});
