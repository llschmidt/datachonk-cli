import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";

export type DatabaseType = "snowflake" | "bigquery" | "redshift" | "databricks" | "postgres" | "mysql" | "duckdb";
export type ModelingApproach = "kimball" | "data_vault" | "obt" | "activity_schema" | "mixed";

export interface DatabaseConnection {
  type: DatabaseType;
  name: string;
  // Common fields
  host?: string;
  port?: string | number;
  database?: string;
  username?: string;
  // Snowflake specific
  account?: string;
  warehouse?: string;
  role?: string;
  // BigQuery specific
  project?: string;
  keyFile?: string;
  dataset?: string;
  // Connection metadata
  lastUsed?: string;
}

export interface DataChonkConfig {
  version: number;
  warehouse: DatabaseType;
  // API configuration
  apiUrl?: string;
  modeling: {
    approach: ModelingApproach;
    conventions: string[];
  };
  ai: {
    enabled: boolean;
    apiKey: string | null;
  };
  analysis: {
    ignorePaths: string[];
    ignoreRules: string[];
  };
  generation: {
    defaultMaterialization: "view" | "table" | "incremental" | "ephemeral";
    addDescriptions: boolean;
    addTests: boolean;
  };
  // Database connections for discovery
  connections?: Record<string, DatabaseConnection>;
}

// Default API URL - can be overridden via config or environment variable
export const DEFAULT_API_URL = "https://datachonk.dev";

export function getApiUrl(): string {
  const config = loadConfig(".");
  return config.apiUrl || process.env.DATACHONK_API_URL || DEFAULT_API_URL;
}

const DEFAULT_CONFIG: DataChonkConfig = {
  version: 1,
  warehouse: "snowflake",
  modeling: {
    approach: "kimball",
    conventions: ["stg_prefix", "int_prefix", "fct_prefix", "dim_prefix", "snake_case"],
  },
  ai: {
    enabled: false,
    apiKey: null,
  },
  analysis: {
    ignorePaths: ["target/**", "dbt_packages/**", "logs/**"],
    ignoreRules: [],
  },
  generation: {
    defaultMaterialization: "view",
    addDescriptions: true,
    addTests: true,
  },
  connections: {},
};

export function getConfigPath(projectPath: string = "."): string {
  return join(projectPath, ".datachonk.yml");
}

export function loadConfig(projectPath: string = "."): DataChonkConfig {
  const configPath = getConfigPath(projectPath);
  
  if (!existsSync(configPath)) {
    return DEFAULT_CONFIG;
  }
  
  try {
    const content = readFileSync(configPath, "utf-8");
    const config = yaml.load(content) as Partial<DataChonkConfig>;
    
    // Deep merge with defaults
    return {
      ...DEFAULT_CONFIG,
      ...config,
      modeling: { ...DEFAULT_CONFIG.modeling, ...config.modeling },
      ai: { ...DEFAULT_CONFIG.ai, ...config.ai },
      analysis: { ...DEFAULT_CONFIG.analysis, ...config.analysis },
      generation: { ...DEFAULT_CONFIG.generation, ...config.generation },
      connections: { ...DEFAULT_CONFIG.connections, ...config.connections },
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(config: DataChonkConfig, projectPath: string = "."): void {
  const configPath = getConfigPath(projectPath);
  writeFileSync(configPath, yaml.dump(config, { indent: 2 }));
}

export function getApiKey(): string | null {
  const config = loadConfig(".");
  return config.ai.apiKey || process.env.DATACHONK_API_KEY || null;
}

export function setApiKey(apiKey: string): void {
  const config = loadConfig(".");
  config.ai.apiKey = apiKey;
  config.ai.enabled = true;
  saveConfig(config);
}

// Connection management
export function getConnections(): Record<string, DatabaseConnection> {
  const config = loadConfig(".");
  return config.connections || {};
}

export function getConnection(name: string): DatabaseConnection | null {
  const connections = getConnections();
  return connections[name] || null;
}

export function saveConnection(name: string, connection: DatabaseConnection): void {
  const config = loadConfig(".");
  if (!config.connections) {
    config.connections = {};
  }
  config.connections[name] = {
    ...connection,
    lastUsed: new Date().toISOString(),
  };
  saveConfig(config);
}

export function deleteConnection(name: string): boolean {
  const config = loadConfig(".");
  if (config.connections && config.connections[name]) {
    delete config.connections[name];
    saveConfig(config);
    return true;
  }
  return false;
}

export function listConnections(): Array<{ name: string; connection: DatabaseConnection }> {
  const connections = getConnections();
  return Object.entries(connections).map(([name, connection]) => ({
    name,
    connection,
  }));
}
