#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import { analyzeCommand } from "./commands/analyze.js";
import { generateCommand } from "./commands/generate.js";
import { reviewCommand } from "./commands/review.js";
import { initCommand } from "./commands/init.js";
import { configCommand } from "./commands/config.js";
import { lineageCommand } from "./commands/lineage.js";
import { docsCommand } from "./commands/docs.js";
import { chatCommand } from "./commands/chat.js";
import { testCommand } from "./commands/test.js";
import { migrateCommand } from "./commands/migrate.js";
import { scanCommand } from "./commands/scan.js";
import { authCommand } from "./commands/auth.js";
import { projectsCommand } from "./commands/projects.js";
import { syncCommand, pullCommand } from "./commands/sync.js";
import { statusCommand, openCommand, versionCommand } from "./commands/status.js";
import { initCache, clearAll, clearExpired, printCacheStatus } from "./utils/cache.js";
import { loadPlugins, getPlugins } from "./utils/plugins.js";
import { initTemplates, listTemplates, printTemplates } from "./utils/templates.js";

// Initialize systems
initCache();
initTemplates();
loadPlugins().catch(() => {/* ignore plugin load errors */});

const program = new Command();

// ASCII art logo
const logo = `
${chalk.hex("#E8A54B")("  ____        _         _____ _                 _    ")}
${chalk.hex("#E8A54B")(" |  _ \\  __ _| |_ __ _ / ____| |__   ___  _ __ | | __")}
${chalk.hex("#E8A54B")(" | | | |/ _\` | __/ _\` | |    | '_ \\ / _ \\| '_ \\| |/ /")}
${chalk.hex("#E8A54B")(" | |_| | (_| | || (_| | |____| | | | (_) | | | |   < ")}
${chalk.hex("#E8A54B")(" |____/ \\__,_|\\__\\__,_|\\_____|_| |_|\\___/|_| |_|_|\\_\\")}
${chalk.gray("                                                        ")}
${chalk.gray(" AI-powered dbt expert • v0.1.0")}
`;

program
  .name("datachonk")
  .description("AI-powered dbt expert - analyze, generate, and optimize your dbt projects")
  .version("0.1.0")
  .addHelpText("beforeAll", logo);

// Initialize a new DataChonk config in a dbt project
program
  .command("init")
  .description("Initialize DataChonk in your dbt project")
  .option("-w, --warehouse <type>", "Data warehouse type (snowflake|bigquery|redshift|databricks|postgres)")
  .option("--api-key <key>", "DataChonk API key for AI features")
  .action(initCommand);

// Analyze the dbt project
program
  .command("analyze")
  .description("Analyze your dbt project for issues, anti-patterns, and optimization opportunities")
  .option("-p, --path <path>", "Path to dbt project", ".")
  .option("-m, --model <model>", "Analyze a specific model")
  .option("--fix", "Automatically fix issues where possible")
  .option("--json", "Output results as JSON")
  .option("-v, --verbose", "Show detailed analysis")
  .action(analyzeCommand);

// Generate dbt code
program
  .command("generate")
  .description("Generate dbt models, tests, and documentation using AI")
  .argument("<type>", "What to generate: staging|intermediate|mart|snapshot|source|test|docs")
  .option("-n, --name <name>", "Name for the generated model")
  .option("-s, --source <source>", "Source table or model to base generation on")
  .option("-o, --output <path>", "Output path for generated files")
  .option("--dry-run", "Preview generated code without writing files")
  .action(generateCommand);

// Review code
program
  .command("review")
  .description("Get an AI-powered code review of your dbt models")
  .argument("[files...]", "Files to review (defaults to staged git changes)")
  .option("--strict", "Enable strict review mode")
  .option("--json", "Output results as JSON")
  .action(reviewCommand);

// Database discovery scan
program
  .command("scan")
  .description("Scan a database to discover tables, columns, and relationships")
  .option("-t, --type <type>", "Database type (postgresql|mysql|snowflake|bigquery|redshift)")
  .option("-h, --host <host>", "Database host")
  .option("-p, --port <port>", "Database port")
  .option("-d, --database <db>", "Database name")
  .option("-u, --user <user>", "Database user")
  .option("--password <pass>", "Database password")
  .option("-w, --warehouse <wh>", "Snowflake warehouse")
  .option("-a, --account <acc>", "Snowflake account")
  .option("--project <proj>", "BigQuery project ID")
  .option("-s, --schemas <schemas>", "Comma-separated schemas to scan")
  .option("-o, --output <file>", "Output results to file")
  .option("--sync", "Sync results to DataChonk web app")
  .option("--json", "Output as JSON")
  .action(scanCommand);

// Lineage analysis
program
  .command("lineage")
  .description("Analyze and visualize model lineage")
  .argument("[model]", "Model to analyze lineage for")
  .option("--upstream", "Show only upstream dependencies")
  .option("--downstream", "Show only downstream dependencies")
  .option("--depth <n>", "Maximum depth to traverse", "10")
  .option("--json", "Output as JSON")
  .action(lineageCommand);

// Generate documentation
program
  .command("docs")
  .description("Generate or enhance dbt documentation")
  .argument("[models...]", "Models to document (defaults to all)")
  .option("--enhance", "Use AI to enhance existing documentation")
  .option("--missing-only", "Only document models without descriptions")
  .action(docsCommand);

// Configuration management
program
  .command("config")
  .description("Manage DataChonk configuration")
  .argument("<action>", "Action: get|set|list|reset")
  .argument("[key]", "Configuration key")
  .argument("[value]", "Configuration value (for set)")
  .action(configCommand);

// Interactive AI chat
program.addCommand(chatCommand);

// Test runner
program.addCommand(testCommand);

// SQL migration tool
program.addCommand(migrateCommand);

// Authentication commands
program.addCommand(authCommand);

// Project management
program.addCommand(projectsCommand);

// Sync commands
program.addCommand(syncCommand);
program.addCommand(pullCommand);

// Status and dashboard
program.addCommand(statusCommand);
program.addCommand(openCommand);
program.addCommand(versionCommand);

// Cache management
program
  .command("cache")
  .description("Manage the DataChonk cache")
  .argument("<action>", "Action: status|clear|clear-expired")
  .action(async (action) => {
    switch (action) {
      case "status":
        printCacheStatus();
        break;
      case "clear":
        const cleared = clearAll();
        console.log(chalk.green(`Cleared ${cleared} cache entries`));
        break;
      case "clear-expired":
        const expired = clearExpired();
        console.log(chalk.green(`Cleared ${expired} expired cache entries`));
        break;
      default:
        console.log(chalk.red(`Unknown action: ${action}`));
        console.log(chalk.gray("Valid actions: status, clear, clear-expired"));
    }
  });

// Plugin management
program
  .command("plugins")
  .description("List loaded plugins")
  .action(() => {
    const plugins = getPlugins();
    if (plugins.length === 0) {
      console.log(chalk.yellow("\nNo plugins loaded"));
      console.log(chalk.gray("Add plugins to .datachonk/plugins/ or install npm packages starting with datachonk-plugin-"));
      return;
    }
    
    console.log(chalk.bold("\nLoaded Plugins"));
    console.log(chalk.gray("─".repeat(40)));
    for (const plugin of plugins) {
      console.log(`  ${chalk.cyan(plugin.name)} (${plugin.type})`);
    }
  });

// Template management
program
  .command("templates")
  .description("List available code templates")
  .option("-c, --category <cat>", "Filter by category")
  .action((options) => {
    if (options.category) {
      const templates = listTemplates(options.category);
      console.log(chalk.bold(`\n${options.category} Templates`));
      for (const t of templates) {
        console.log(`  ${chalk.cyan(t.name)} - ${t.description}`);
      }
    } else {
      printTemplates();
    }
  });

// Quick commands
program
  .command("lint")
  .description("Alias for 'analyze --fix' - lint and fix issues")
  .option("-p, --path <path>", "Path to dbt project", ".")
  .action(async (options) => {
    await analyzeCommand({ ...options, fix: true });
  });

program
  .command("check")
  .description("Alias for 'analyze' - check for issues without fixing")
  .option("-p, --path <path>", "Path to dbt project", ".")
  .action(analyzeCommand);

// Ask a quick question
program
  .command("ask")
  .description("Ask a quick dbt question without entering chat mode")
  .argument("<question...>", "Your question")
  .action(async (question) => {
    const { loadConfig, getApiUrl } = await import("./utils/config.js");
    const config = loadConfig();
    const apiKey = config.ai?.apiKey || process.env.DATACHONK_API_KEY;
    
    if (!apiKey) {
      console.log(chalk.red("No API key. Run: datachonk config set apiKey <key>"));
      process.exit(1);
    }

    const ora = (await import("ora")).default;
    const spinner = ora("Thinking...").start();
    
    try {
      const apiUrl = getApiUrl();
      const response = await fetch(`${apiUrl}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: question.join(" ") }],
          stream: false,
        }),
      });

      const data = await response.json() as { content?: string; message?: string };
      spinner.stop();
      console.log(chalk.cyan("\n" + (data.content || data.message || "No response") + "\n"));
    } catch (error) {
      spinner.fail("Failed");
      console.error(error);
    }
  });

// Parse and run
program.parse();
