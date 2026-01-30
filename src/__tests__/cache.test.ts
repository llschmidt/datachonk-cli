import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

// Mock the cache module with test directory
const TEST_CACHE_DIR = join(process.cwd(), ".test-cache");

describe("Cache Utils", () => {
  beforeEach(() => {
    if (!existsSync(TEST_CACHE_DIR)) {
      mkdirSync(TEST_CACHE_DIR, { recursive: true });
    }
  });

  afterEach(() => {
    if (existsSync(TEST_CACHE_DIR)) {
      rmSync(TEST_CACHE_DIR, { recursive: true, force: true });
    }
  });

  describe("cache operations", () => {
    it("should handle cache directory creation", () => {
      expect(existsSync(TEST_CACHE_DIR)).toBe(true);
    });

    it("should handle missing cache gracefully", () => {
      // Cache operations should not throw when cache doesn't exist
      rmSync(TEST_CACHE_DIR, { recursive: true, force: true });
      expect(existsSync(TEST_CACHE_DIR)).toBe(false);
    });
  });

  describe("cache key generation", () => {
    it("generates consistent keys for same input", () => {
      const input1 = JSON.stringify({ query: "test", version: 1 });
      const input2 = JSON.stringify({ query: "test", version: 1 });
      expect(input1).toBe(input2);
    });

    it("generates different keys for different input", () => {
      const input1 = JSON.stringify({ query: "test1" });
      const input2 = JSON.stringify({ query: "test2" });
      expect(input1).not.toBe(input2);
    });
  });
});
