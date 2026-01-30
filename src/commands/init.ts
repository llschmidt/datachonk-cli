import chalk from "chalk";
import inquirer from "inquirer";
import { writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";

interface InitOptions {
  warehouse?: string;
  apiKey?: string;
}

export async function initCommand(options: InitOptions): Promise<void> {
  console.log(chalk.hex("#E8A54B").bold("\n  Welcome to DataChonk! 🐕\n"));

  // Check if we're in a dbt project
  const dbtProjectPath = join(process.cwd(), "dbt_project.yml");
  const isDbTProject = existsSync(dbtProjectPath);

  if (!isDbTProject) {
    console.log(chalk.yellow("⚠ No dbt_project.yml found. Are you in a dbt project directory?"));
    const { proceed } = await inquirer.prompt([
      {
        type: "confirm",
        name: "proceed",
        message: "Continue anyway?",
        default: false,
      },
    ]);
    if (!proceed) {
      process.exit(0);
    }
  }

  // Read existing dbt_project.yml to detect warehouse
  let detectedWarehouse: string | undefined;
  if (isDbTProject) {
    try {
      const dbtProject = yaml.load(readFileSync(dbtProjectPath, "utf-8")) as Record<string, unknown>;
      const profile = dbtProject.profile as string;
      console.log(chalk.gray(`Detected dbt project: ${dbtProject.name}`));
      console.log(chalk.gray(`Profile: ${profile}`));
    } catch {
      // Ignore
    }
  }

  // Prompt for configuration
  const answers = await inquirer.prompt([
    {
      type: "list",
      name: "warehouse",
      message: "What data warehouse are you using?",
      choices: [
        { name: "Snowflake", value: "snowflake" },
        { name: "BigQuery", value: "bigquery" },
        { name: "Redshift", value: "redshift" },
        { name: "Databricks", value: "databricks" },
        { name: "PostgreSQL", value: "postgres" },
        { name: "DuckDB", value: "duckdb" },
      ],
      when: !options.warehouse,
      default: detectedWarehouse,
    },
    {
      type: "list",
      name: "modelingApproach",
      message: "What data modeling approach do you prefer?",
      choices: [
        { name: "Kimball (facts + dimensions)", value: "kimball" },
        { name: "Data Vault 2.0", value: "data_vault" },
        { name: "One Big Table (OBT)", value: "obt" },
        { name: "Activity Schema", value: "activity_schema" },
        { name: "Mixed / Not sure", value: "mixed" },
      ],
    },
    {
      type: "checkbox",
      name: "conventions",
      message: "Select your naming conventions:",
      choices: [
        { name: "stg_ prefix for staging models", value: "stg_prefix", checked: true },
        { name: "int_ prefix for intermediate models", value: "int_prefix", checked: true },
        { name: "fct_ prefix for fact tables", value: "fct_prefix", checked: true },
        { name: "dim_ prefix for dimension tables", value: "dim_prefix", checked: true },
        { name: "snake_case for all names", value: "snake_case", checked: true },
      ],
    },
    {
      type: "confirm",
      name: "enableAI",
      message: "Enable AI-powered features? (requires API key)",
      default: true,
    },
    {
      type: "input",
      name: "apiKey",
      message: "Enter your DataChonk API key (or leave blank to set later):",
      when: (answers) => answers.enableAI && !options.apiKey,
    },
  ]);

  const config = {
    version: 1,
    warehouse: options.warehouse || answers.warehouse,
    modeling: {
      approach: answers.modelingApproach,
      conventions: answers.conventions,
    },
    ai: {
      enabled: answers.enableAI,
      apiKey: options.apiKey || answers.apiKey || null,
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
  };

  // Write config file
  const configPath = join(process.cwd(), ".datachonk.yml");
  writeFileSync(configPath, yaml.dump(config, { indent: 2 }));
  console.log(chalk.green(`\n✓ Created ${configPath}`));

  // Create .datachonkignore if it doesn't exist
  const ignorePath = join(process.cwd(), ".datachonkignore");
  if (!existsSync(ignorePath)) {
    writeFileSync(ignorePath, `# DataChonk ignore file
# Add patterns for files to exclude from analysis

target/
dbt_packages/
logs/
*.tmp
`);
    console.log(chalk.green(`✓ Created ${ignorePath}`));
  }

  // Add to .gitignore if exists
  const gitignorePath = join(process.cwd(), ".gitignore");
  if (existsSync(gitignorePath)) {
    const gitignore = readFileSync(gitignorePath, "utf-8");
    if (!gitignore.includes(".datachonk.yml")) {
      // Don't add to gitignore - config should be tracked
    }
  }

  console.log(chalk.bold("\n🎉 DataChonk initialized!\n"));
  console.log(chalk.gray("Next steps:"));
  console.log(chalk.gray("  1. Run 'datachonk analyze' to check your project"));
  console.log(chalk.gray("  2. Run 'datachonk generate staging' to create a new model"));
  console.log(chalk.gray("  3. Run 'datachonk review' before committing changes"));
  
  if (!config.ai.apiKey && config.ai.enabled) {
    console.log(chalk.yellow("\n⚠ AI features require an API key."));
    console.log(chalk.gray("  Get one at: https://datachonk.com/api-keys"));
    console.log(chalk.gray("  Then run: datachonk config set ai.apiKey YOUR_KEY"));
  }
}
