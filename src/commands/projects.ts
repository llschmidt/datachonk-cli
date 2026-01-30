import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import inquirer from "inquirer";
import { table } from "table";
import { writeFileSync, mkdirSync, existsSync } from "fs";
import { join } from "path";
import AdmZip from "adm-zip";
import { loadConfig, getApiUrl, getApiKey } from "../utils/config.js";

interface Project {
  id: string;
  name: string;
  description?: string;
  warehouse: string;
  dbt_version?: string;
  created_at: string;
  updated_at: string;
}

interface Chonk {
  id: string;
  name: string;
  type: string;
  source_table?: string;
}

interface Artifact {
  id: string;
  path: string;
  content: string;
  type: string;
}

export const projectsCommand = new Command("projects")
  .description("Manage DataChonk projects");

// List projects
projectsCommand
  .command("list")
  .alias("ls")
  .description("List all your projects")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      console.log(chalk.yellow("Login required. Run: datachonk auth login"));
      process.exit(1);
    }

    const spinner = ora("Fetching projects...").start();

    try {
      const apiUrl = getApiUrl();
      const response = await fetch(`${apiUrl}/api/cli/projects`, {
        headers: { "Authorization": `Bearer ${apiKey}` },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch projects");
      }

      const data = await response.json() as { projects: Project[] };
      spinner.stop();

      if (options.json) {
        console.log(JSON.stringify(data.projects, null, 2));
        return;
      }

      if (data.projects.length === 0) {
        console.log(chalk.yellow("\nNo projects found."));
        console.log(chalk.gray("Create one with: datachonk projects create"));
        return;
      }

      console.log(chalk.bold("\n  Your Projects\n"));
      
      const tableData = [
        [chalk.bold("Name"), chalk.bold("Warehouse"), chalk.bold("Created"), chalk.bold("ID")],
        ...data.projects.map((p) => [
          p.name,
          p.warehouse,
          new Date(p.created_at).toLocaleDateString(),
          chalk.gray(p.id.substring(0, 8)),
        ]),
      ];

      console.log(table(tableData, {
        border: {
          topBody: "",
          topJoin: "",
          topLeft: "",
          topRight: "",
          bottomBody: "",
          bottomJoin: "",
          bottomLeft: "",
          bottomRight: "",
          bodyLeft: "  ",
          bodyRight: "",
          bodyJoin: "  ",
          joinBody: "",
          joinLeft: "",
          joinRight: "",
          joinJoin: "",
        },
      }));

    } catch (error) {
      spinner.fail("Failed to fetch projects");
      console.error(chalk.red(error instanceof Error ? error.message : "Unknown error"));
      process.exit(1);
    }
  });

// Create project
projectsCommand
  .command("create")
  .description("Create a new project")
  .option("-n, --name <name>", "Project name")
  .option("-w, --warehouse <type>", "Warehouse type (snowflake|bigquery|redshift|databricks)")
  .option("-d, --description <desc>", "Project description")
  .action(async (options) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      console.log(chalk.yellow("Login required. Run: datachonk auth login"));
      process.exit(1);
    }

    // Prompt for missing options
    const answers = await inquirer.prompt([
      {
        type: "input",
        name: "name",
        message: "Project name:",
        when: !options.name,
        validate: (input: string) => input.length > 0 || "Name is required",
      },
      {
        type: "list",
        name: "warehouse",
        message: "Data warehouse:",
        when: !options.warehouse,
        choices: [
          { name: "Snowflake", value: "snowflake" },
          { name: "BigQuery", value: "bigquery" },
          { name: "Redshift", value: "redshift" },
          { name: "Databricks", value: "databricks" },
          { name: "PostgreSQL", value: "postgres" },
        ],
      },
      {
        type: "input",
        name: "description",
        message: "Description (optional):",
        when: !options.description,
      },
    ]);

    const name = options.name || answers.name;
    const warehouse = options.warehouse || answers.warehouse;
    const description = options.description || answers.description;

    const spinner = ora("Creating project...").start();

    try {
      const apiUrl = getApiUrl();
      const response = await fetch(`${apiUrl}/api/cli/projects`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ name, warehouse, description }),
      });

      if (!response.ok) {
        const errorData = await response.json() as { error?: string };
        throw new Error(errorData.error || "Failed to create project");
      }

      const data = await response.json() as { project: Project };
      spinner.succeed("Project created!");

      console.log(chalk.gray(`\n  ID: ${data.project.id}`));
      console.log(chalk.gray(`  Name: ${data.project.name}`));
      console.log(chalk.gray(`  Warehouse: ${data.project.warehouse}`));
      
      console.log(chalk.bold("\n  Next steps:"));
      console.log(chalk.gray(`  • datachonk scan --sync  # Scan your database and sync`));
      console.log(chalk.gray(`  • datachonk chat -p ${data.project.id}  # Chat with Chonk about this project`));
      console.log();

    } catch (error) {
      spinner.fail("Failed to create project");
      console.error(chalk.red(error instanceof Error ? error.message : "Unknown error"));
      process.exit(1);
    }
  });

// Get project details
projectsCommand
  .command("show")
  .description("Show project details")
  .argument("<projectId>", "Project ID or name")
  .option("--json", "Output as JSON")
  .action(async (projectId, options) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      console.log(chalk.yellow("Login required. Run: datachonk auth login"));
      process.exit(1);
    }

    const spinner = ora("Fetching project...").start();

    try {
      const apiUrl = getApiUrl();
      const response = await fetch(`${apiUrl}/api/cli/projects/${projectId}`, {
        headers: { "Authorization": `Bearer ${apiKey}` },
      });

      if (!response.ok) {
        throw new Error("Project not found");
      }

      const data = await response.json() as { 
        project: Project; 
        chonks: Chonk[]; 
        artifacts: Artifact[];
        stats: { tables: number; models: number; tests: number };
      };
      spinner.stop();

      if (options.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      console.log(chalk.bold(`\n  ${data.project.name}\n`));
      console.log(chalk.gray("  ─".repeat(20)));
      console.log(`  ${chalk.gray("ID:")}          ${data.project.id}`);
      console.log(`  ${chalk.gray("Warehouse:")}   ${data.project.warehouse}`);
      console.log(`  ${chalk.gray("dbt Version:")} ${data.project.dbt_version || "1.8+"}`);
      console.log(`  ${chalk.gray("Created:")}     ${new Date(data.project.created_at).toLocaleDateString()}`);
      
      if (data.project.description) {
        console.log(`  ${chalk.gray("Description:")} ${data.project.description}`);
      }

      console.log(chalk.bold("\n  Stats"));
      console.log(chalk.gray("  ─".repeat(20)));
      console.log(`  ${chalk.gray("Tables:")}  ${data.stats.tables}`);
      console.log(`  ${chalk.gray("Models:")}  ${data.stats.models}`);
      console.log(`  ${chalk.gray("Tests:")}   ${data.stats.tests}`);

      if (data.chonks.length > 0) {
        console.log(chalk.bold("\n  Chonks"));
        console.log(chalk.gray("  ─".repeat(20)));
        for (const chonk of data.chonks.slice(0, 10)) {
          console.log(`  ${chalk.cyan(chonk.type)} ${chonk.name}`);
        }
        if (data.chonks.length > 10) {
          console.log(chalk.gray(`  ... +${data.chonks.length - 10} more`));
        }
      }

      console.log();

    } catch (error) {
      spinner.fail("Failed to fetch project");
      console.error(chalk.red(error instanceof Error ? error.message : "Unknown error"));
      process.exit(1);
    }
  });

// Delete project
projectsCommand
  .command("delete")
  .description("Delete a project")
  .argument("<projectId>", "Project ID")
  .option("-f, --force", "Skip confirmation")
  .action(async (projectId, options) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      console.log(chalk.yellow("Login required. Run: datachonk auth login"));
      process.exit(1);
    }

    if (!options.force) {
      const { confirm } = await inquirer.prompt([
        {
          type: "confirm",
          name: "confirm",
          message: chalk.red(`Are you sure you want to delete project ${projectId}? This cannot be undone.`),
          default: false,
        },
      ]);

      if (!confirm) {
        console.log(chalk.gray("Cancelled."));
        return;
      }
    }

    const spinner = ora("Deleting project...").start();

    try {
      const apiUrl = getApiUrl();
      const response = await fetch(`${apiUrl}/api/cli/projects/${projectId}`, {
        method: "DELETE",
        headers: { "Authorization": `Bearer ${apiKey}` },
      });

      if (!response.ok) {
        throw new Error("Failed to delete project");
      }

      spinner.succeed("Project deleted.");

    } catch (error) {
      spinner.fail("Failed to delete project");
      console.error(chalk.red(error instanceof Error ? error.message : "Unknown error"));
      process.exit(1);
    }
  });

// Export/download project
projectsCommand
  .command("export")
  .alias("download")
  .description("Export project as a dbt project ZIP")
  .argument("<projectId>", "Project ID")
  .option("-o, --output <path>", "Output directory", ".")
  .option("--extract", "Extract ZIP contents instead of creating archive")
  .action(async (projectId, options) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      console.log(chalk.yellow("Login required. Run: datachonk auth login"));
      process.exit(1);
    }

    const spinner = ora("Exporting project...").start();

    try {
      const apiUrl = getApiUrl();
      const response = await fetch(`${apiUrl}/api/cli/projects/${projectId}/export`, {
        headers: { "Authorization": `Bearer ${apiKey}` },
      });

      if (!response.ok) {
        throw new Error("Failed to export project");
      }

      const data = await response.json() as { 
        project: Project;
        files: Array<{ path: string; content: string }>;
      };

      spinner.text = "Creating files...";

      if (options.extract) {
        // Extract directly to output directory
        const baseDir = join(options.output, data.project.name.toLowerCase().replace(/\s+/g, "_"));
        
        for (const file of data.files) {
          const filePath = join(baseDir, file.path);
          const dir = join(filePath, "..");
          
          if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
          }
          
          writeFileSync(filePath, file.content);
        }

        spinner.succeed(`Exported to ${baseDir}`);
        console.log(chalk.gray(`\n  ${data.files.length} files created.`));
        console.log(chalk.bold("\n  Next steps:"));
        console.log(chalk.gray(`  cd ${baseDir}`));
        console.log(chalk.gray("  dbt deps"));
        console.log(chalk.gray("  dbt run"));
      } else {
        // Create ZIP file
        const zip = new AdmZip();
        const projectName = data.project.name.toLowerCase().replace(/\s+/g, "_");

        for (const file of data.files) {
          zip.addFile(`${projectName}/${file.path}`, Buffer.from(file.content, "utf-8"));
        }

        const zipPath = join(options.output, `${projectName}.zip`);
        zip.writeZip(zipPath);

        spinner.succeed(`Exported to ${zipPath}`);
        console.log(chalk.gray(`\n  ${data.files.length} files in archive.`));
      }

      console.log();

    } catch (error) {
      spinner.fail("Failed to export project");
      console.error(chalk.red(error instanceof Error ? error.message : "Unknown error"));
      process.exit(1);
    }
  });

// Clone project to local dbt project
projectsCommand
  .command("clone")
  .description("Clone a DataChonk project to a local dbt project")
  .argument("<projectId>", "Project ID")
  .option("-o, --output <path>", "Output directory", ".")
  .action(async (projectId, options) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      console.log(chalk.yellow("Login required. Run: datachonk auth login"));
      process.exit(1);
    }

    const spinner = ora("Cloning project...").start();

    try {
      const apiUrl = getApiUrl();
      const response = await fetch(`${apiUrl}/api/cli/projects/${projectId}/export`, {
        headers: { "Authorization": `Bearer ${apiKey}` },
      });

      if (!response.ok) {
        throw new Error("Failed to clone project");
      }

      const data = await response.json() as { 
        project: Project;
        files: Array<{ path: string; content: string }>;
      };

      const baseDir = join(options.output, data.project.name.toLowerCase().replace(/\s+/g, "_"));
      
      // Create dbt_project.yml if not included
      const hasDbtProject = data.files.some(f => f.path === "dbt_project.yml");
      
      if (!hasDbtProject) {
        data.files.unshift({
          path: "dbt_project.yml",
          content: `name: '${data.project.name.toLowerCase().replace(/\s+/g, "_")}'
version: '1.0.0'

config-version: 2

profile: 'default'

model-paths: ["models"]
analysis-paths: ["analyses"]
test-paths: ["tests"]
seed-paths: ["seeds"]
macro-paths: ["macros"]
snapshot-paths: ["snapshots"]

clean-targets:
  - "target"
  - "dbt_packages"
`,
        });
      }

      spinner.text = "Writing files...";

      for (const file of data.files) {
        const filePath = join(baseDir, file.path);
        const dir = join(filePath, "..");
        
        if (!existsSync(dir)) {
          mkdirSync(dir, { recursive: true });
        }
        
        writeFileSync(filePath, file.content);
      }

      // Also create .datachonk.yml for future syncing
      const config = loadConfig();
      config.warehouse = data.project.warehouse as typeof config.warehouse;
      
      writeFileSync(join(baseDir, ".datachonk.yml"), `# DataChonk configuration
version: 1
project_id: ${projectId}
warehouse: ${data.project.warehouse}

modeling:
  approach: kimball
  conventions:
    - stg_prefix
    - int_prefix
    - fct_prefix
    - dim_prefix
    - snake_case

ai:
  enabled: true
`);

      spinner.succeed(`Cloned to ${baseDir}`);
      
      console.log(chalk.gray(`\n  ${data.files.length} files created.`));
      console.log(chalk.bold("\n  Get started:"));
      console.log(chalk.cyan(`  cd ${baseDir}`));
      console.log(chalk.cyan("  dbt deps"));
      console.log(chalk.cyan("  dbt debug  # Configure your profiles.yml"));
      console.log(chalk.cyan("  dbt run"));
      console.log();

    } catch (error) {
      spinner.fail("Failed to clone project");
      console.error(chalk.red(error instanceof Error ? error.message : "Unknown error"));
      process.exit(1);
    }
  });
