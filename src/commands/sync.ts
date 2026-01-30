import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { readdirSync, readFileSync, statSync, existsSync } from "fs";
import { join, relative } from "path";
import yaml from "js-yaml";
import { loadConfig, getApiUrl, getApiKey } from "../utils/config.js";

interface DbtModel {
  path: string;
  name: string;
  content: string;
  type: "staging" | "intermediate" | "mart" | "snapshot" | "seed" | "analysis" | "unknown";
}

interface DbtSource {
  name: string;
  database?: string;
  schema?: string;
  tables: Array<{ name: string; description?: string }>;
}

interface SyncResult {
  models: number;
  sources: number;
  tests: number;
  macros: number;
  errors: string[];
}

export const syncCommand = new Command("sync")
  .description("Sync your local dbt project with DataChonk")
  .option("-p, --path <path>", "Path to dbt project", ".")
  .option("--project <id>", "DataChonk project ID to sync to")
  .option("--dry-run", "Preview what would be synced without making changes")
  .option("--force", "Overwrite existing data in DataChonk")
  .action(async (options) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      console.log(chalk.yellow("Login required. Run: datachonk auth login"));
      process.exit(1);
    }

    const projectPath = options.path;
    
    // Verify this is a dbt project
    const dbtProjectPath = join(projectPath, "dbt_project.yml");
    if (!existsSync(dbtProjectPath)) {
      console.log(chalk.red("No dbt_project.yml found. Is this a dbt project?"));
      process.exit(1);
    }

    console.log(chalk.hex("#E8A54B").bold("\n  DataChonk Sync\n"));

    const spinner = ora("Scanning dbt project...").start();

    try {
      // Parse dbt_project.yml
      const dbtProjectContent = readFileSync(dbtProjectPath, "utf-8");
      const dbtProject = yaml.load(dbtProjectContent) as {
        name: string;
        version: string;
        "model-paths"?: string[];
        "seed-paths"?: string[];
        "snapshot-paths"?: string[];
        "macro-paths"?: string[];
        "analysis-paths"?: string[];
      };

      const modelPaths = dbtProject["model-paths"] || ["models"];
      const seedPaths = dbtProject["seed-paths"] || ["seeds"];
      const snapshotPaths = dbtProject["snapshot-paths"] || ["snapshots"];
      const macroPaths = dbtProject["macro-paths"] || ["macros"];
      const analysisPaths = dbtProject["analysis-paths"] || ["analyses"];

      // Collect all files
      const models: DbtModel[] = [];
      const sources: DbtSource[] = [];
      const macros: Array<{ path: string; content: string }> = [];
      const tests: Array<{ path: string; content: string }> = [];

      // Scan model directories
      for (const modelPath of modelPaths) {
        const fullPath = join(projectPath, modelPath);
        if (existsSync(fullPath)) {
          scanDirectory(fullPath, projectPath, models, sources, tests);
        }
      }

      // Scan snapshot directories
      for (const snapshotPath of snapshotPaths) {
        const fullPath = join(projectPath, snapshotPath);
        if (existsSync(fullPath)) {
          scanDirectory(fullPath, projectPath, models, sources, tests, "snapshot");
        }
      }

      // Scan macro directories
      for (const macroPath of macroPaths) {
        const fullPath = join(projectPath, macroPath);
        if (existsSync(fullPath)) {
          scanMacros(fullPath, projectPath, macros);
        }
      }

      spinner.succeed(`Found ${models.length} models, ${sources.length} sources, ${macros.length} macros`);

      if (options.dryRun) {
        console.log(chalk.bold("\nDry Run - Would sync:"));
        console.log(chalk.gray(`  Models: ${models.length}`));
        for (const model of models.slice(0, 10)) {
          console.log(chalk.gray(`    - ${model.path} (${model.type})`));
        }
        if (models.length > 10) {
          console.log(chalk.gray(`    ... +${models.length - 10} more`));
        }
        
        console.log(chalk.gray(`  Sources: ${sources.length}`));
        for (const source of sources) {
          console.log(chalk.gray(`    - ${source.name} (${source.tables.length} tables)`));
        }
        
        console.log(chalk.gray(`  Macros: ${macros.length}`));
        console.log(chalk.gray(`  Tests: ${tests.length}`));
        return;
      }

      // Determine target project
      let projectId = options.project;
      
      // Check if .datachonk.yml has a project_id
      const datachonkConfigPath = join(projectPath, ".datachonk.yml");
      if (!projectId && existsSync(datachonkConfigPath)) {
        const datachonkConfig = yaml.load(readFileSync(datachonkConfigPath, "utf-8")) as { project_id?: string };
        projectId = datachonkConfig.project_id;
      }

      if (!projectId) {
        console.log(chalk.yellow("\nNo project ID specified."));
        console.log(chalk.gray("Run: datachonk sync --project <project-id>"));
        console.log(chalk.gray("Or add project_id to .datachonk.yml"));
        process.exit(1);
      }

      // Upload to DataChonk
      const uploadSpinner = ora("Uploading to DataChonk...").start();

      const apiUrl = getApiUrl();
      const response = await fetch(`${apiUrl}/api/cli/sync`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          projectId,
          projectName: dbtProject.name,
          models: models.map(m => ({
            path: m.path,
            name: m.name,
            content: m.content,
            type: m.type,
          })),
          sources,
          macros: macros.map(m => ({ path: m.path, content: m.content })),
          tests: tests.map(t => ({ path: t.path, content: t.content })),
          force: options.force,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json() as { error?: string };
        throw new Error(errorData.error || "Sync failed");
      }

      const result = await response.json() as SyncResult;
      uploadSpinner.succeed("Sync complete!");

      console.log(chalk.bold("\nSync Summary:"));
      console.log(chalk.gray(`  Models synced: ${result.models}`));
      console.log(chalk.gray(`  Sources synced: ${result.sources}`));
      console.log(chalk.gray(`  Tests synced: ${result.tests}`));
      console.log(chalk.gray(`  Macros synced: ${result.macros}`));

      if (result.errors.length > 0) {
        console.log(chalk.yellow(`\nWarnings: ${result.errors.length}`));
        for (const err of result.errors.slice(0, 5)) {
          console.log(chalk.yellow(`  - ${err}`));
        }
      }

      console.log(chalk.gray(`\nView your project at: ${apiUrl}/app/projects/${projectId}`));

    } catch (error) {
      spinner.fail("Sync failed");
      console.error(chalk.red(error instanceof Error ? error.message : "Unknown error"));
      process.exit(1);
    }
  });

function scanDirectory(
  dir: string,
  projectPath: string,
  models: DbtModel[],
  sources: DbtSource[],
  tests: Array<{ path: string; content: string }>,
  forceType?: DbtModel["type"]
) {
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relativePath = relative(projectPath, fullPath);

    if (entry.isDirectory()) {
      // Skip common non-model directories
      if (!["__pycache__", "node_modules", "target", "dbt_packages", "logs"].includes(entry.name)) {
        scanDirectory(fullPath, projectPath, models, sources, tests, forceType);
      }
    } else if (entry.name.endsWith(".sql")) {
      const content = readFileSync(fullPath, "utf-8");
      const name = entry.name.replace(".sql", "");
      
      models.push({
        path: relativePath,
        name,
        content,
        type: forceType || inferModelType(relativePath, name),
      });
    } else if (entry.name.endsWith(".yml") || entry.name.endsWith(".yaml")) {
      // Parse YAML for sources and tests
      try {
        const content = readFileSync(fullPath, "utf-8");
        const parsed = yaml.load(content) as {
          sources?: Array<{
            name: string;
            database?: string;
            schema?: string;
            tables?: Array<{ name: string; description?: string }>;
          }>;
          models?: Array<{
            name: string;
            columns?: Array<{
              name: string;
              tests?: string[];
            }>;
          }>;
        };

        if (parsed?.sources) {
          for (const source of parsed.sources) {
            sources.push({
              name: source.name,
              database: source.database,
              schema: source.schema,
              tables: source.tables || [],
            });
          }
        }

        // Check for schema tests
        if (parsed?.models) {
          for (const model of parsed.models) {
            if (model.columns?.some(c => c.tests && c.tests.length > 0)) {
              tests.push({ path: relativePath, content });
            }
          }
        }
      } catch {
        // Ignore YAML parse errors
      }
    }
  }
}

function scanMacros(
  dir: string,
  projectPath: string,
  macros: Array<{ path: string; content: string }>
) {
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    const relativePath = relative(projectPath, fullPath);

    if (entry.isDirectory()) {
      scanMacros(fullPath, projectPath, macros);
    } else if (entry.name.endsWith(".sql")) {
      const content = readFileSync(fullPath, "utf-8");
      macros.push({ path: relativePath, content });
    }
  }
}

function inferModelType(path: string, name: string): DbtModel["type"] {
  const lowerPath = path.toLowerCase();
  const lowerName = name.toLowerCase();

  if (lowerPath.includes("staging") || lowerName.startsWith("stg_")) {
    return "staging";
  }
  if (lowerPath.includes("intermediate") || lowerName.startsWith("int_")) {
    return "intermediate";
  }
  if (lowerPath.includes("mart") || lowerName.startsWith("fct_") || lowerName.startsWith("dim_")) {
    return "mart";
  }
  if (lowerPath.includes("snapshot")) {
    return "snapshot";
  }
  if (lowerPath.includes("seed")) {
    return "seed";
  }
  if (lowerPath.includes("analysis") || lowerPath.includes("analyses")) {
    return "analysis";
  }

  return "unknown";
}

// Pull command - download from DataChonk to local
export const pullCommand = new Command("pull")
  .description("Pull latest changes from DataChonk to local dbt project")
  .option("-p, --path <path>", "Path to dbt project", ".")
  .option("--project <id>", "DataChonk project ID to pull from")
  .option("--force", "Overwrite local files")
  .action(async (options) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      console.log(chalk.yellow("Login required. Run: datachonk auth login"));
      process.exit(1);
    }

    const projectPath = options.path;
    
    // Determine project ID
    let projectId = options.project;
    const datachonkConfigPath = join(projectPath, ".datachonk.yml");
    if (!projectId && existsSync(datachonkConfigPath)) {
      const datachonkConfig = yaml.load(readFileSync(datachonkConfigPath, "utf-8")) as { project_id?: string };
      projectId = datachonkConfig.project_id;
    }

    if (!projectId) {
      console.log(chalk.yellow("No project ID specified."));
      console.log(chalk.gray("Run: datachonk pull --project <project-id>"));
      process.exit(1);
    }

    const spinner = ora("Fetching from DataChonk...").start();

    try {
      const apiUrl = getApiUrl();
      const response = await fetch(`${apiUrl}/api/cli/projects/${projectId}/export`, {
        headers: { "Authorization": `Bearer ${apiKey}` },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch project");
      }

      const data = await response.json() as { files: Array<{ path: string; content: string }> };
      spinner.text = "Writing files...";

      let written = 0;
      let skipped = 0;

      for (const file of data.files) {
        const filePath = join(projectPath, file.path);
        const dir = join(filePath, "..");

        // Check if file exists and we're not forcing
        if (existsSync(filePath) && !options.force) {
          skipped++;
          continue;
        }

        if (!existsSync(dir)) {
          const { mkdirSync } = await import("fs");
          mkdirSync(dir, { recursive: true });
        }

        const { writeFileSync } = await import("fs");
        writeFileSync(filePath, file.content);
        written++;
      }

      spinner.succeed("Pull complete!");
      console.log(chalk.gray(`  Files written: ${written}`));
      if (skipped > 0) {
        console.log(chalk.yellow(`  Files skipped (already exist): ${skipped}`));
        console.log(chalk.gray("  Use --force to overwrite existing files"));
      }

    } catch (error) {
      spinner.fail("Pull failed");
      console.error(chalk.red(error instanceof Error ? error.message : "Unknown error"));
      process.exit(1);
    }
  });
