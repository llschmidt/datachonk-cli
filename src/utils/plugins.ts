import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import chalk from "chalk";

/**
 * Plugin Architecture for DataChonk CLI
 * 
 * Plugins can extend DataChonk functionality:
 * - Custom warehouse parsers (Snowflake-specific, BigQuery-specific)
 * - Custom SQL dialects
 * - Business logic extractors
 * - Template generators
 * - Validation hooks
 */

export interface PluginContext {
  config: Record<string, unknown>;
  cwd: string;
  apiKey?: string;
}

export interface ParserPlugin {
  name: string;
  type: "parser";
  supportedWarehouses: string[];
  parse: (sql: string, context: PluginContext) => Promise<ParseResult>;
}

export interface GeneratorPlugin {
  name: string;
  type: "generator";
  templates: string[];
  generate: (templateName: string, context: PluginContext) => Promise<string>;
}

export interface ValidatorPlugin {
  name: string;
  type: "validator";
  validate: (code: string, context: PluginContext) => Promise<ValidationResult[]>;
}

export type Plugin = ParserPlugin | GeneratorPlugin | ValidatorPlugin;

export interface ParseResult {
  tables: Array<{ name: string; alias?: string }>;
  columns: Array<{ name: string; table?: string }>;
  ctes: Array<{ name: string; sql: string }>;
  functions: string[];
  warnings: string[];
}

export interface ValidationResult {
  level: "error" | "warning" | "info";
  message: string;
  line?: number;
  column?: number;
  rule: string;
  fix?: string;
}

// Plugin registry
const plugins: Map<string, Plugin> = new Map();

// Built-in plugin locations
const PLUGIN_DIRS = [
  join(process.cwd(), ".datachonk", "plugins"),
  join(process.env.HOME || "~", ".datachonk", "plugins"),
];

/**
 * Load plugins from plugin directories and npm packages
 */
export async function loadPlugins(): Promise<void> {
  // Load from plugin directories
  for (const dir of PLUGIN_DIRS) {
    if (existsSync(dir)) {
      const files = readdirSync(dir).filter((f) => f.endsWith(".js") || f.endsWith(".mjs"));
      for (const file of files) {
        try {
          const plugin = await import(join(dir, file));
          if (plugin.default && isValidPlugin(plugin.default)) {
            registerPlugin(plugin.default);
          }
        } catch (err) {
          console.warn(chalk.yellow(`Failed to load plugin ${file}: ${err}`));
        }
      }
    }
  }

  // Load npm plugins (packages starting with datachonk-plugin-)
  try {
    const packageJson = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf-8"));
    const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
    
    for (const [name] of Object.entries(deps)) {
      if (name.startsWith("datachonk-plugin-")) {
        try {
          const plugin = await import(name);
          if (plugin.default && isValidPlugin(plugin.default)) {
            registerPlugin(plugin.default);
          }
        } catch (err) {
          console.warn(chalk.yellow(`Failed to load plugin ${name}: ${err}`));
        }
      }
    }
  } catch {
    // No package.json or error reading it
  }
}

/**
 * Validate plugin structure
 */
function isValidPlugin(obj: unknown): obj is Plugin {
  if (!obj || typeof obj !== "object") return false;
  const p = obj as Record<string, unknown>;
  return (
    typeof p.name === "string" &&
    typeof p.type === "string" &&
    ["parser", "generator", "validator"].includes(p.type as string)
  );
}

/**
 * Register a plugin
 */
export function registerPlugin(plugin: Plugin): void {
  plugins.set(plugin.name, plugin);
  console.log(chalk.gray(`Loaded plugin: ${plugin.name} (${plugin.type})`));
}

/**
 * Get all registered plugins
 */
export function getPlugins(): Plugin[] {
  return Array.from(plugins.values());
}

/**
 * Get plugins by type
 */
export function getPluginsByType<T extends Plugin>(type: T["type"]): T[] {
  return Array.from(plugins.values()).filter((p) => p.type === type) as T[];
}

/**
 * Get parser plugins for a specific warehouse
 */
export function getParsersForWarehouse(warehouse: string): ParserPlugin[] {
  return getPluginsByType<ParserPlugin>("parser").filter((p) =>
    p.supportedWarehouses.includes(warehouse) || p.supportedWarehouses.includes("*")
  );
}

/**
 * Get generator plugins with a specific template
 */
export function getGeneratorsForTemplate(template: string): GeneratorPlugin[] {
  return getPluginsByType<GeneratorPlugin>("generator").filter((p) =>
    p.templates.includes(template) || p.templates.includes("*")
  );
}

/**
 * Run all validators on code
 */
export async function runValidators(
  code: string,
  context: PluginContext
): Promise<ValidationResult[]> {
  const validators = getPluginsByType<ValidatorPlugin>("validator");
  const results: ValidationResult[] = [];

  for (const validator of validators) {
    try {
      const validatorResults = await validator.validate(code, context);
      results.push(...validatorResults);
    } catch (err) {
      results.push({
        level: "warning",
        message: `Validator ${validator.name} failed: ${err}`,
        rule: "plugin-error",
      });
    }
  }

  return results;
}

// Built-in plugins

/**
 * Default SQL parser plugin
 */
export const defaultParserPlugin: ParserPlugin = {
  name: "default-parser",
  type: "parser",
  supportedWarehouses: ["*"],
  async parse(sql: string): Promise<ParseResult> {
    const tables: Array<{ name: string; alias?: string }> = [];
    const columns: Array<{ name: string; table?: string }> = [];
    const ctes: Array<{ name: string; sql: string }> = [];
    const functions: string[] = [];
    const warnings: string[] = [];

    // Simple regex-based parsing (plugins can provide more sophisticated parsing)
    
    // Extract CTEs
    const cteRegex = /(\w+)\s+as\s*\(\s*([\s\S]*?)\s*\)(?=\s*,\s*\w+\s+as\s*\(|\s*select)/gi;
    let match;
    while ((match = cteRegex.exec(sql)) !== null) {
      ctes.push({ name: match[1], sql: match[2] });
    }

    // Extract table references
    const fromRegex = /(?:from|join)\s+([`"']?[\w.]+[`"']?)(?:\s+(?:as\s+)?(\w+))?/gi;
    while ((match = fromRegex.exec(sql)) !== null) {
      tables.push({ name: match[1].replace(/[`"']/g, ""), alias: match[2] });
    }

    // Extract function calls
    const funcRegex = /\b(\w+)\s*\(/g;
    const seenFuncs = new Set<string>();
    while ((match = funcRegex.exec(sql)) !== null) {
      const func = match[1].toLowerCase();
      if (!seenFuncs.has(func) && !["select", "from", "where", "and", "or", "case", "when"].includes(func)) {
        seenFuncs.add(func);
        functions.push(func);
      }
    }

    return { tables, columns, ctes, functions, warnings };
  },
};

// Register built-in plugins
registerPlugin(defaultParserPlugin);

/**
 * Create a custom plugin
 */
export function createPlugin<T extends Plugin>(config: T): T {
  return config;
}
