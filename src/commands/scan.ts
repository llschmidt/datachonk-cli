import chalk from "chalk";
import ora from "ora";
import inquirer from "inquirer";
import { readFileSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";
import { table } from "table";
import { loadConfig, getApiKey } from "../utils/config.js";

interface ScanOptions {
  type?: string;
  host?: string;
  port?: string;
  database?: string;
  user?: string;
  password?: string;
  warehouse?: string;
  account?: string;
  project?: string;
  schemas?: string;
  output?: string;
  sync?: boolean;
  json?: boolean;
}

interface ScannedTable {
  schemaName: string;
  tableName: string;
  tableType: string;
  rowCount?: number;
}

interface ScannedColumn {
  schemaName: string;
  tableName: string;
  columnName: string;
  dataType: string;
  isPrimaryKey: boolean;
  isNullable: boolean;
}

interface ScannedForeignKey {
  fromSchema: string;
  fromTable: string;
  fromColumn: string;
  toSchema: string;
  toTable: string;
  toColumn: string;
}

interface ScanResult {
  tables: ScannedTable[];
  columns: ScannedColumn[];
  foreignKeys: ScannedForeignKey[];
  inferredRelationships: Array<{
    fromSchema: string;
    fromTable: string;
    fromColumn: string;
    toSchema: string;
    toTable: string;
    toColumn: string;
    confidence: number;
    detectedVia: string;
  }>;
  errors: string[];
}

export async function scanCommand(options: ScanOptions): Promise<void> {
  console.log(chalk.hex("#E8A54B").bold("\n  DataChonk Discovery Engine\n"));

  // Try to load connection from config or prompt
  let connectionConfig: Record<string, unknown> = {};
  let sourceType = options.type;

  // Check for existing .datachonk.yml with connection info
  const configPath = join(process.cwd(), ".datachonk.yml");
  if (existsSync(configPath)) {
    try {
      const config = yaml.load(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
      if (config.connections && typeof config.connections === "object") {
        const connections = config.connections as Record<string, unknown>;
        const names = Object.keys(connections);
        if (names.length > 0) {
          const { useExisting } = await inquirer.prompt([
            {
              type: "confirm",
              name: "useExisting",
              message: `Found ${names.length} saved connection(s). Use existing?`,
              default: true,
            },
          ]);

          if (useExisting) {
            const { connectionName } = await inquirer.prompt([
              {
                type: "list",
                name: "connectionName",
                message: "Select connection:",
                choices: names,
              },
            ]);
            const savedConn = connections[connectionName] as Record<string, unknown>;
            sourceType = savedConn.type as string;
            connectionConfig = savedConn;
          }
        }
      }
    } catch {
      // Ignore config errors
    }
  }

  // If no connection from config, prompt for details
  if (!sourceType) {
    const answers = await inquirer.prompt([
      {
        type: "list",
        name: "type",
        message: "Select database type:",
        choices: [
          { name: "PostgreSQL", value: "postgresql" },
          { name: "MySQL", value: "mysql" },
          { name: "Snowflake", value: "snowflake" },
          { name: "BigQuery", value: "bigquery" },
          { name: "Redshift", value: "redshift" },
        ],
      },
    ]);
    sourceType = answers.type;
  }

  // Gather connection details based on type
  if (Object.keys(connectionConfig).length === 0) {
    switch (sourceType) {
      case "postgresql":
      case "mysql":
      case "redshift":
        const relationalAnswers = await inquirer.prompt([
          {
            type: "input",
            name: "host",
            message: "Host:",
            default: options.host || "localhost",
          },
          {
            type: "input",
            name: "port",
            message: "Port:",
            default: options.port || (sourceType === "mysql" ? "3306" : sourceType === "redshift" ? "5439" : "5432"),
          },
          {
            type: "input",
            name: "database",
            message: "Database:",
            default: options.database,
          },
          {
            type: "input",
            name: "username",
            message: "Username:",
            default: options.user,
          },
          {
            type: "password",
            name: "password",
            message: "Password:",
            mask: "*",
          },
        ]);
        connectionConfig = { ...relationalAnswers, type: sourceType };
        break;

      case "snowflake":
        const snowflakeAnswers = await inquirer.prompt([
          {
            type: "input",
            name: "account",
            message: "Account (e.g., abc123.us-east-1):",
            default: options.account,
          },
          {
            type: "input",
            name: "username",
            message: "Username:",
            default: options.user,
          },
          {
            type: "password",
            name: "password",
            message: "Password:",
            mask: "*",
          },
          {
            type: "input",
            name: "warehouse",
            message: "Warehouse:",
            default: options.warehouse,
          },
          {
            type: "input",
            name: "database",
            message: "Database:",
            default: options.database,
          },
        ]);
        connectionConfig = { ...snowflakeAnswers, type: sourceType };
        break;

      case "bigquery":
        const bqAnswers = await inquirer.prompt([
          {
            type: "input",
            name: "project",
            message: "GCP Project ID:",
            default: options.project,
          },
          {
            type: "input",
            name: "keyFile",
            message: "Service account key file path (optional):",
          },
        ]);
        connectionConfig = { ...bqAnswers, type: sourceType };
        break;
    }
  }

  // Ask about schemas to scan
  const schemasToScan = options.schemas?.split(",") || [];
  if (schemasToScan.length === 0) {
    const { schemas } = await inquirer.prompt([
      {
        type: "input",
        name: "schemas",
        message: "Schemas to scan (comma-separated, or blank for all):",
        default: "",
      },
    ]);
    if (schemas) {
      schemasToScan.push(...schemas.split(",").map((s: string) => s.trim()));
    }
  }

  // Ask to save connection
  const { saveConnection } = await inquirer.prompt([
    {
      type: "confirm",
      name: "saveConnection",
      message: "Save this connection for future scans?",
      default: true,
    },
  ]);

  if (saveConnection) {
    const { connectionName } = await inquirer.prompt([
      {
        type: "input",
        name: "connectionName",
        message: "Connection name:",
        default: connectionConfig.database || sourceType,
      },
    ]);

    // Save to .datachonk.yml
    let config: Record<string, unknown> = {};
    if (existsSync(configPath)) {
      config = yaml.load(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
    }
    if (!config.connections) {
      config.connections = {};
    }
    // Don't save password in plain text - note this
    const connToSave = { ...connectionConfig };
    delete connToSave.password;
    (config.connections as Record<string, unknown>)[connectionName] = connToSave;
    writeFileSync(configPath, yaml.dump(config, { indent: 2 }));
    console.log(chalk.green(`\nConnection saved to .datachonk.yml (password not stored)`));
  }

  // Start scanning
  const spinner = ora("Connecting to database...").start();

  try {
    // Call the scan API
    const apiKey = getApiKey();
    const { getApiUrl } = await import("../utils/config.js");
    const scanEndpoint = getApiUrl();

    const response = await fetch(`${scanEndpoint}/api/scan/cli`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        sourceType,
        connectionConfig: {
          ...connectionConfig,
          password: connectionConfig.password, // Pass password for this request only
        },
        options: {
          schemas: schemasToScan.length > 0 ? schemasToScan : undefined,
          includeRowCounts: true,
        },
      }),
    });

    if (!response.ok) {
      const errorData = await response.json() as { error?: string };
      throw new Error(errorData.error || "Scan failed");
    }

    const result = await response.json() as ScanResult;
    spinner.succeed("Scan complete!");

    // Display results
    console.log(chalk.bold("\n📊 Discovery Results\n"));
    console.log(chalk.gray("─".repeat(60)));

    // Tables summary
    console.log(chalk.bold(`\nTables Found: ${result.tables.length}`));
    if (result.tables.length > 0 && !options.json) {
      const tableData = [
        [chalk.bold("Schema"), chalk.bold("Table"), chalk.bold("Type"), chalk.bold("Rows")],
        ...result.tables.slice(0, 20).map((t) => [
          t.schemaName,
          t.tableName,
          t.tableType,
          t.rowCount?.toLocaleString() || "N/A",
        ]),
      ];
      if (result.tables.length > 20) {
        tableData.push(["...", `+${result.tables.length - 20} more`, "", ""]);
      }
      console.log(table(tableData));
    }

    // Columns summary
    console.log(chalk.bold(`Columns Found: ${result.columns.length}`));

    // Relationships
    const totalRels = result.foreignKeys.length + (result.inferredRelationships?.length || 0);
    console.log(chalk.bold(`\nRelationships Discovered: ${totalRels}`));
    console.log(chalk.gray(`  • ${result.foreignKeys.length} foreign keys (database-defined)`));
    console.log(chalk.gray(`  • ${result.inferredRelationships?.length || 0} inferred from naming patterns`));

    if (result.foreignKeys.length > 0 && !options.json) {
      console.log(chalk.bold("\nKey Relationships:"));
      for (const fk of result.foreignKeys.slice(0, 10)) {
        console.log(chalk.cyan(`  ${fk.fromSchema}.${fk.fromTable}.${fk.fromColumn}`));
        console.log(chalk.gray(`    → ${fk.toSchema}.${fk.toTable}.${fk.toColumn}`));
      }
      if (result.foreignKeys.length > 10) {
        console.log(chalk.gray(`  ... +${result.foreignKeys.length - 10} more`));
      }
    }

    // Errors
    if (result.errors.length > 0) {
      console.log(chalk.yellow(`\nWarnings: ${result.errors.length}`));
      for (const err of result.errors.slice(0, 5)) {
        console.log(chalk.yellow(`  ⚠ ${err}`));
      }
    }

    // Output to file
    if (options.output) {
      writeFileSync(options.output, JSON.stringify(result, null, 2));
      console.log(chalk.green(`\nResults saved to ${options.output}`));
    }

    // JSON output
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    }

    // Sync to web app
    if (options.sync) {
      if (!apiKey) {
        console.log(chalk.yellow("\nSync requires an API key. Run: datachonk config set apiKey <key>"));
      } else {
        const syncSpinner = ora("Syncing to DataChonk...").start();
        try {
          const syncResponse = await fetch(`${scanEndpoint}/api/scan/sync`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(result),
          });

          if (syncResponse.ok) {
            syncSpinner.succeed("Synced to DataChonk web app");
            console.log(chalk.gray(`  View your lineage at: ${scanEndpoint}/app`));
          } else {
            syncSpinner.fail("Sync failed");
          }
        } catch (err) {
          syncSpinner.fail("Sync failed");
        }
      }
    }

    // Next steps
    console.log(chalk.bold("\n📋 Next Steps\n"));
    console.log(chalk.gray("  • Run 'datachonk lineage' to explore relationships"));
    console.log(chalk.gray("  • Run 'datachonk generate staging --source <table>' to create dbt models"));
    console.log(chalk.gray("  • Run 'datachonk scan --sync' to push results to the web app"));

  } catch (error) {
    spinner.fail("Scan failed");
    console.error(chalk.red(error instanceof Error ? error.message : "Unknown error"));
    process.exit(1);
  }
}
