import chalk from "chalk";
import ora from "ora";
import inquirer from "inquirer";
import { writeFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { format } from "sql-formatter";
import { loadConfig } from "../utils/config.js";
import { generateStagingModel, generateIntermediateModel, generateMartModel, generateSnapshot, generateSourceYaml, generateTests, generateDocs } from "../utils/generators.js";

interface GenerateOptions {
  name?: string;
  source?: string;
  output?: string;
  dryRun?: boolean;
}

export async function generateCommand(
  type: string,
  options: GenerateOptions
): Promise<void> {
  const spinner = ora("Preparing generator...").start();
  
  try {
    const config = loadConfig(".");
    spinner.stop();

    // Prompt for missing required options
    const answers = await inquirer.prompt([
      {
        type: "input",
        name: "name",
        message: "Model name:",
        when: !options.name,
        validate: (input: string) => input.length > 0 || "Name is required",
      },
      {
        type: "input",
        name: "source",
        message: "Source table/model (e.g., raw.stripe.payments):",
        when: !options.source && ["staging", "intermediate", "snapshot"].includes(type),
        validate: (input: string) => input.length > 0 || "Source is required",
      },
    ]);

    const name = options.name || answers.name;
    const source = options.source || answers.source;

    spinner.start("Generating code...");

    let code: string;
    let filePath: string;
    let schemaYaml: string | null = null;

    switch (type) {
      case "staging":
      case "stg":
        code = generateStagingModel(name, source, config.warehouse);
        filePath = options.output || `models/staging/stg_${name}.sql`;
        schemaYaml = generateDocs(`stg_${name}`, "staging", source);
        break;

      case "intermediate":
      case "int":
        code = generateIntermediateModel(name, source, config.warehouse);
        filePath = options.output || `models/intermediate/int_${name}.sql`;
        schemaYaml = generateDocs(`int_${name}`, "intermediate", source);
        break;

      case "mart":
      case "fct":
      case "dim":
        const martType = type === "dim" ? "dimension" : "fact";
        code = generateMartModel(name, source, martType, config.warehouse);
        filePath = options.output || `models/marts/${type}_${name}.sql`;
        schemaYaml = generateDocs(`${type}_${name}`, "mart", source);
        break;

      case "snapshot":
        code = generateSnapshot(name, source, config.warehouse);
        filePath = options.output || `snapshots/${name}_snapshot.sql`;
        break;

      case "source":
        code = generateSourceYaml(name, source);
        filePath = options.output || `models/staging/_${name}__sources.yml`;
        break;

      case "test":
        code = generateTests(name, source);
        filePath = options.output || `tests/${name}_test.sql`;
        break;

      case "docs":
        code = generateDocs(name, "unknown", source);
        filePath = options.output || `models/${name}.yml`;
        break;

      default:
        spinner.fail(`Unknown type: ${type}`);
        console.log(chalk.gray("Valid types: staging, intermediate, mart, fct, dim, snapshot, source, test, docs"));
        process.exit(1);
    }

    // Format SQL
    if (filePath.endsWith(".sql")) {
      try {
        code = format(code, {
          language: config.warehouse === "bigquery" ? "bigquery" : "sql",
          keywordCase: "lower",
          identifierCase: "preserve",
          dataTypeCase: "lower",
          functionCase: "lower",
        });
      } catch {
        // Keep unformatted if formatter fails
      }
    }

    spinner.succeed("Code generated");

    if (options.dryRun) {
      console.log(chalk.bold(`\n📄 ${filePath}`));
      console.log(chalk.gray("─".repeat(50)));
      console.log(code);
      
      if (schemaYaml) {
        const yamlPath = filePath.replace(".sql", ".yml");
        console.log(chalk.bold(`\n📄 ${yamlPath}`));
        console.log(chalk.gray("─".repeat(50)));
        console.log(schemaYaml);
      }
      return;
    }

    // Write files
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    writeFileSync(filePath, code);
    console.log(chalk.green(`✓ Created ${filePath}`));

    if (schemaYaml) {
      const yamlPath = filePath.replace(".sql", ".yml");
      writeFileSync(yamlPath, schemaYaml);
      console.log(chalk.green(`✓ Created ${yamlPath}`));
    }

    console.log(chalk.gray("\nNext steps:"));
    console.log(chalk.gray("  1. Review and customize the generated code"));
    console.log(chalk.gray("  2. Run: dbt run --select " + name));
    console.log(chalk.gray("  3. Run: dbt test --select " + name));

  } catch (error) {
    spinner.fail("Generation failed");
    console.error(chalk.red(error instanceof Error ? error.message : "Unknown error"));
    process.exit(1);
  }
}
