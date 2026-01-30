import { describe, it, expect, beforeEach } from "vitest";
import {
  initTemplates,
  getTemplate,
  listTemplates,
  renderTemplate,
} from "../utils/templates.js";

describe("Template Utils", () => {
  beforeEach(() => {
    initTemplates();
  });

  describe("listTemplates", () => {
    it("returns staging templates", () => {
      const templates = listTemplates("staging");
      expect(templates.length).toBeGreaterThan(0);
    });

    it("returns mart templates", () => {
      const templates = listTemplates("mart");
      expect(templates.length).toBeGreaterThan(0);
    });

    it("returns test templates", () => {
      const templates = listTemplates("test");
      expect(templates.length).toBeGreaterThan(0);
    });

    it("returns empty array for unknown category", () => {
      const templates = listTemplates("unknown-category");
      expect(templates).toEqual([]);
    });
  });

  describe("getTemplate", () => {
    it("returns template by name", () => {
      const template = getTemplate("staging-model");
      expect(template).toBeDefined();
      expect(template?.name).toBe("staging-model");
    });

    it("returns null for unknown template", () => {
      const template = getTemplate("nonexistent-template");
      expect(template).toBeNull();
    });
  });

  describe("renderTemplate", () => {
    it("renders staging template with variables", () => {
      const rendered = renderTemplate("staging-model", {
        source_name: "raw_data",
        source_table: "users",
        columns: ["user_id", "email", "created_at"],
      });

      expect(rendered).toContain("raw_data");
      expect(rendered).toContain("users");
    });

    it("throws for unknown template", () => {
      expect(() => renderTemplate("nonexistent", {})).toThrow("Template not found");
    });
  });
});
