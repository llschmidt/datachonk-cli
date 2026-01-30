import chalk from "chalk";
import ora from "ora";
import { glob } from "glob";
import { readFileSync, existsSync } from "fs";
import { join, relative, basename } from "path";
import { table } from "table";
import { loadConfig } from "../utils/config.js";
import { parseModel, detectAntiPatterns, type Issue } from "../utils/analyzer.js";

interface AnalyzeOptions {
  path: string;
  model?: string;
  fix?: boolean;
  json?: boolean;
  verbose?: boolean;
}

export async function analyzeCommand(options: AnalyzeOptions): Promise<void> {
  const spinner = ora("Analyzing dbt project...").start();
  
  try {
    const config = loadConfig(options.path);
    const projectPath = options.path;
    
    // Find all SQL files
    const pattern = options.model 
      ? `**/${options.model}.sql`
      : "**/*.sql";
    
    const files = await glob(pattern, {
      cwd: projectPath,
      ignore: ["**/target/**", "**/dbt_packages/**", "**/node_modules/**"],
    });

    if (files.length === 0) {
      spinner.fail("No SQL files found");
      return;
    }

    spinner.text = `Found ${files.length} SQL files. Analyzing...`;

    const allIssues: Array<Issue & { file: string }> = [];
    const modelStats = {
      total: files.length,
      staging: 0,
      intermediate: 0,
      mart: 0,
      other: 0,
      withTests: 0,
      withDocs: 0,
    };

    for (const file of files) {
      const filePath = join(projectPath, file);
      const content = readFileSync(filePath, "utf-8");
      const fileName = basename(file, ".sql");
      
      // Categorize model
      if (fileName.startsWith("stg_")) modelStats.staging++;
      else if (fileName.startsWith("int_")) modelStats.intermediate++;
      else if (fileName.startsWith("fct_") || fileName.startsWith("dim_")) modelStats.mart++;
      else modelStats.other++;

      // Parse and analyze
      const model = parseModel(content, fileName);
      const issues = detectAntiPatterns(model, config.warehouse);
      
      for (const issue of issues) {
        allIssues.push({ ...issue, file });
      }

      // Check for tests
      const schemaPath = join(projectPath, file.replace(".sql", ".yml"));
      const schemaPath2 = join(projectPath, "models", "schema.yml");
      if (existsSync(schemaPath) || existsSync(schemaPath2)) {
        modelStats.withTests++;
      }
    }

    spinner.succeed(`Analyzed ${files.length} models`);

    // Group issues by severity
    const critical = allIssues.filter(i => i.severity === "critical");
    const high = allIssues.filter(i => i.severity === "high");
    const medium = allIssues.filter(i => i.severity === "medium");
    const low = allIssues.filter(i => i.severity === "low");

    if (options.json) {
      console.log(JSON.stringify({
        summary: {
          totalModels: modelStats.total,
          issues: {
            critical: critical.length,
            high: high.length,
            medium: medium.length,
            low: low.length,
          },
          modelTypes: modelStats,
        },
        issues: allIssues,
      }, null, 2));
      return;
    }

    // Print summary
    console.log("\n" + chalk.bold("Project Summary"));
    console.log(chalk.gray("─".repeat(50)));
    
    const summaryData = [
      ["Total Models", modelStats.total.toString()],
      ["Staging (stg_)", chalk.cyan(modelStats.staging.toString())],
      ["Intermediate (int_)", chalk.blue(modelStats.intermediate.toString())],
      ["Marts (fct_/dim_)", chalk.green(modelStats.mart.toString())],
      ["Other", chalk.gray(modelStats.other.toString())],
    ];
    
    console.log(table(summaryData, {
      border: {
        topBody: "", topJoin: "", topLeft: "", topRight: "",
        bottomBody: "", bottomJoin: "", bottomLeft: "", bottomRight: "",
        bodyLeft: "", bodyRight: "", bodyJoin: chalk.gray("│"),
        joinBody: "", joinLeft: "", joinRight: "", joinJoin: "",
      },
    }));

    // Print issues
    console.log(chalk.bold("\nIssues Found"));
    console.log(chalk.gray("─".repeat(50)));
    
    const issuesSummary = [
      [chalk.red("Critical"), critical.length.toString()],
      [chalk.hex("#FFA500")("High"), high.length.toString()],
      [chalk.yellow("Medium"), medium.length.toString()],
      [chalk.gray("Low"), low.length.toString()],
    ];
    
    console.log(table(issuesSummary, {
      border: {
        topBody: "", topJoin: "", topLeft: "", topRight: "",
        bottomBody: "", bottomJoin: "", bottomLeft: "", bottomRight: "",
        bodyLeft: "", bodyRight: "", bodyJoin: chalk.gray("│"),
        joinBody: "", joinLeft: "", joinRight: "", joinJoin: "",
      },
    }));

    if (allIssues.length > 0) {
      console.log(chalk.bold("\nDetailed Issues"));
      console.log(chalk.gray("─".repeat(50)));
      
      // Show critical and high issues
      const importantIssues = [...critical, ...high];
      
      for (const issue of importantIssues.slice(0, options.verbose ? undefined : 10)) {
        const severityColor = issue.severity === "critical" ? chalk.red : chalk.hex("#FFA500");
        console.log(`\n${severityColor(`[${issue.severity.toUpperCase()}]`)} ${chalk.bold(issue.pattern)}`);
        console.log(chalk.gray(`  File: ${issue.file}`));
        console.log(chalk.gray(`  ${issue.explanation}`));
        console.log(chalk.cyan(`  Fix: ${issue.fix}`));
      }

      if (!options.verbose && importantIssues.length > 10) {
        console.log(chalk.gray(`\n  ... and ${importantIssues.length - 10} more issues. Use --verbose to see all.`));
      }
    }

    // Exit code based on issues
    if (critical.length > 0) {
      console.log(chalk.red("\n✖ Analysis failed with critical issues"));
      process.exit(1);
    } else if (high.length > 0) {
      console.log(chalk.yellow("\n⚠ Analysis completed with warnings"));
      process.exit(0);
    } else {
      console.log(chalk.green("\n✓ Analysis passed"));
      process.exit(0);
    }

  } catch (error) {
    spinner.fail("Analysis failed");
    console.error(chalk.red(error instanceof Error ? error.message : "Unknown error"));
    process.exit(1);
  }
}
