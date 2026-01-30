import chalk from "chalk";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";
import { table } from "table";
import {
  loadConfig,
  saveConfig,
  getConnections,
  saveConnection,
  deleteConnection,
  type DatabaseConnection,
  type DatabaseType,
} from "../utils/config.js";

export async function configCommand(
  action: string,
  key?: string,
  value?: string
): Promise<void> {
  const configPath = join(process.cwd(), ".datachonk.yml");
  
  // Handle connection subcommands
  if (action === "connections" || action === "conn") {
    await handleConnectionsCommand(key, value);
    return;
  }

  if (!existsSync(configPath) && action !== "list") {
    console.log(chalk.yellow("No .datachonk.yml found. Run 'datachonk init' first."));
    process.exit(1);
  }

  switch (action) {
    case "get": {
      if (!key) {
        console.log(chalk.red("Usage: datachonk config get <key>"));
        process.exit(1);
      }
      
      const config = yaml.load(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
      const value = getNestedValue(config, key);
      
      if (value === undefined) {
        console.log(chalk.gray("(not set)"));
      } else {
        console.log(typeof value === "object" ? yaml.dump(value) : value);
      }
      break;
    }

    case "set": {
      if (!key || value === undefined) {
        console.log(chalk.red("Usage: datachonk config set <key> <value>"));
        process.exit(1);
      }
      
      const config = yaml.load(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
      setNestedValue(config, key, value);
      writeFileSync(configPath, yaml.dump(config, { indent: 2 }));
      console.log(chalk.green(`Set ${key} = ${value}`));
      break;
    }

    case "list": {
      if (!existsSync(configPath)) {
        console.log(chalk.yellow("No configuration file found."));
        console.log(chalk.gray("Run 'datachonk init' to create one."));
        return;
      }
      
      const config = yaml.load(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
      console.log(chalk.bold("\nCurrent configuration:"));
      console.log(chalk.gray("-".repeat(50)));
      
      // Show config without sensitive data
      const safeConfig = { ...config };
      if (safeConfig.ai && typeof safeConfig.ai === "object") {
        const ai = safeConfig.ai as Record<string, unknown>;
        if (ai.apiKey) {
          ai.apiKey = "***" + String(ai.apiKey).slice(-4);
        }
      }
      
      console.log(yaml.dump(safeConfig, { indent: 2 }));
      break;
    }

    case "reset": {
      const { default: inquirer } = await import("inquirer");
      const { confirm } = await inquirer.prompt([
        {
          type: "confirm",
          name: "confirm",
          message: "This will reset all configuration to defaults. Continue?",
          default: false,
        },
      ]);
      
      if (confirm) {
        const defaultConfig = {
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
        
        writeFileSync(configPath, yaml.dump(defaultConfig, { indent: 2 }));
        console.log(chalk.green("Configuration reset to defaults"));
      }
      break;
    }

    default:
      console.log(chalk.red(`Unknown action: ${action}`));
      console.log(chalk.gray("Valid actions: get, set, list, reset, connections"));
      process.exit(1);
  }
}

async function handleConnectionsCommand(subAction?: string, name?: string): Promise<void> {
  const { default: inquirer } = await import("inquirer");

  switch (subAction) {
    case "list":
    case undefined: {
      const connections = getConnections();
      const entries = Object.entries(connections);
      
      if (entries.length === 0) {
        console.log(chalk.yellow("\nNo saved connections."));
        console.log(chalk.gray("Run 'datachonk scan' to create one."));
        return;
      }

      console.log(chalk.bold("\nSaved Connections:"));
      console.log(chalk.gray("-".repeat(60)));
      
      const tableData = [
        [chalk.bold("Name"), chalk.bold("Type"), chalk.bold("Host/Account"), chalk.bold("Database")],
        ...entries.map(([connName, conn]) => [
          connName,
          conn.type,
          conn.host || conn.account || conn.project || "-",
          conn.database || conn.dataset || "-",
        ]),
      ];
      console.log(table(tableData));
      break;
    }

    case "add": {
      // Interactive connection creation
      const answers = await inquirer.prompt([
        {
          type: "input",
          name: "name",
          message: "Connection name:",
          default: name,
          validate: (input: string) => input.length > 0 || "Name is required",
        },
        {
          type: "list",
          name: "type",
          message: "Database type:",
          choices: [
            { name: "PostgreSQL", value: "postgres" },
            { name: "MySQL", value: "mysql" },
            { name: "Snowflake", value: "snowflake" },
            { name: "BigQuery", value: "bigquery" },
            { name: "Redshift", value: "redshift" },
          ],
        },
      ]);

      let connection: DatabaseConnection = {
        type: answers.type as DatabaseType,
        name: answers.name,
      };

      // Type-specific prompts
      switch (answers.type) {
        case "postgres":
        case "mysql":
        case "redshift": {
          const dbAnswers = await inquirer.prompt([
            { type: "input", name: "host", message: "Host:", default: "localhost" },
            { type: "input", name: "port", message: "Port:", default: answers.type === "mysql" ? "3306" : answers.type === "redshift" ? "5439" : "5432" },
            { type: "input", name: "database", message: "Database:" },
            { type: "input", name: "username", message: "Username:" },
          ]);
          connection = { ...connection, ...dbAnswers };
          break;
        }

        case "snowflake": {
          const sfAnswers = await inquirer.prompt([
            { type: "input", name: "account", message: "Account (e.g., abc123.us-east-1):" },
            { type: "input", name: "username", message: "Username:" },
            { type: "input", name: "warehouse", message: "Warehouse:" },
            { type: "input", name: "database", message: "Database:" },
            { type: "input", name: "role", message: "Role (optional):" },
          ]);
          connection = { ...connection, ...sfAnswers };
          break;
        }

        case "bigquery": {
          const bqAnswers = await inquirer.prompt([
            { type: "input", name: "project", message: "GCP Project ID:" },
            { type: "input", name: "dataset", message: "Default dataset (optional):" },
            { type: "input", name: "keyFile", message: "Service account key file path (optional):" },
          ]);
          connection = { ...connection, ...bqAnswers };
          break;
        }
      }

      saveConnection(answers.name, connection);
      console.log(chalk.green(`\nConnection '${answers.name}' saved.`));
      console.log(chalk.gray("Note: Passwords are not stored. You'll be prompted during scans."));
      break;
    }

    case "remove":
    case "delete": {
      if (!name) {
        // Show list and prompt for selection
        const connections = getConnections();
        const names = Object.keys(connections);
        
        if (names.length === 0) {
          console.log(chalk.yellow("No connections to remove."));
          return;
        }

        const { selected } = await inquirer.prompt([
          {
            type: "list",
            name: "selected",
            message: "Select connection to remove:",
            choices: names,
          },
        ]);
        name = selected;
      }

      const { confirm } = await inquirer.prompt([
        {
          type: "confirm",
          name: "confirm",
          message: `Remove connection '${name}'?`,
          default: false,
        },
      ]);

      if (confirm && name) {
        if (deleteConnection(name)) {
          console.log(chalk.green(`Connection '${name}' removed.`));
        } else {
          console.log(chalk.red(`Connection '${name}' not found.`));
        }
      }
      break;
    }

    default:
      console.log(chalk.red(`Unknown subcommand: ${subAction}`));
      console.log(chalk.gray("Valid subcommands: list, add, remove"));
  }
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.split(".");
  let current: unknown = obj;
  
  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  
  return current;
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: string): void {
  const keys = path.split(".");
  let current: Record<string, unknown> = obj;
  
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (!(key in current) || typeof current[key] !== "object") {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  
  const lastKey = keys[keys.length - 1];
  
  // Try to parse value as JSON, boolean, or number
  let parsedValue: unknown = value;
  if (value === "true") parsedValue = true;
  else if (value === "false") parsedValue = false;
  else if (value === "null") parsedValue = null;
  else if (!isNaN(Number(value))) parsedValue = Number(value);
  else {
    try {
      parsedValue = JSON.parse(value);
    } catch {
      // Keep as string
    }
  }
  
  current[lastKey] = parsedValue;
}
