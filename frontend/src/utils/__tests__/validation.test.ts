import { describe, it, expect } from "vitest";
import { isValidEmail } from "../validation";

describe("isValidEmail", () => {
  // --- Happy path ---

  it("returns true for a standard email address", () => {
    expect(isValidEmail("user@example.com")).toBe(true);
  });

  it("returns true for an email with a subdomain", () => {
    expect(isValidEmail("user@mail.example.com")).toBe(true);
  });

  it("returns true for an email with a + in the local part", () => {
    expect(isValidEmail("user+tag@example.com")).toBe(true);
  });

  it("returns true for an email with dots in the local part", () => {
    expect(isValidEmail("first.last@example.org")).toBe(true);
  });

  it("returns true for an email with leading/trailing whitespace (trimmed)", () => {
    expect(isValidEmail("  user@example.com  ")).toBe(true);
  });

  // --- Input validation ---

  it("returns false for a string with no @ symbol", () => {
    expect(isValidEmail("notanemail")).toBe(false);
  });

  it("returns false for a string missing the domain", () => {
    expect(isValidEmail("user@")).toBe(false);
  });

  it("returns false for a string missing the TLD separator (no dot after @)", () => {
    expect(isValidEmail("user@domain")).toBe(false);
  });

  it("returns false for an empty string", () => {
    expect(isValidEmail("")).toBe(false);
  });

  it("returns false for a string with only whitespace", () => {
    expect(isValidEmail("   ")).toBe(false);
  });

  // --- Boundary values ---

  it("returns false for a string with whitespace in the local part", () => {
    expect(isValidEmail("user name@example.com")).toBe(false);
  });

  it("returns false for a string with whitespace in the domain part", () => {
    expect(isValidEmail("user@exam ple.com")).toBe(false);
  });

  it("returns true for a single-character local part", () => {
    expect(isValidEmail("a@b.co")).toBe(true);
  });

  // --- Edge cases ---

  it("returns false for a string with only @", () => {
    expect(isValidEmail("@")).toBe(false);
  });

  it("returns false for a string with @ at the start", () => {
    expect(isValidEmail("@example.com")).toBe(false);
  });

  it("returns false for multiple @ symbols", () => {
    expect(isValidEmail("a@@b.com")).toBe(false);
  });
});
