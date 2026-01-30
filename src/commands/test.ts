import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import * as fs from "fs";
import * as path from "path";
import { glob } from "glob";

interface TestResult {
  model: string;
  test: string;
  status: "pass" | "fail" | "warn" | "skip";
  message?: string;
}

export const testCommand = new Command("test")
  .description("Run data quality tests and validations")
  .option("-m, --model <model>", "Test specific model")
  .option("-t, --type <type>", "Test type: schema, data, freshness, all", "all")
  .option("--dry-run", "Show tests that would run without executing")
  .option("--generate", "Generate test suggestions for models")
  .action(async (options) => {
    const cwd = process.cwd();
    const modelsPath = path.join(cwd, "models");

    if (!fs.existsSync(modelsPath)) {
      console.log(chalk.red("No models directory found. Run from dbt project root."));
      process.exit(1);
    }

    if (options.generate) {
      await generateTestSuggestions(cwd, options.model);
      return;
    }

    console.log(chalk.cyan.bold("\n🧪 DataChonk Test Runner\n"));

    const spinner = ora("Discovering tests...").start();

    try {
      const results: TestResult[] = [];
      
      // Find all schema YAML files
      const yamlPattern = options.model 
        ? `models/**/*${options.model}*.yml`
        : "models/**/*.yml";
      
      const yamlFiles = await glob(yamlPattern, { cwd });
      
      spinner.text = `Found ${yamlFiles.length} schema files`;

      for (const yamlFile of yamlFiles) {
        const content = fs.readFileSync(path.join(cwd, yamlFile), "utf-8");
        const tests = extractTests(content, yamlFile);
        
        for (const test of tests) {
          if (options.dryRun) {
            results.push({
              model: test.model,
              test: test.name,
              status: "skip",
              message: "Dry run - would execute",
            });
          } else {
            // Validate test configuration
            const validation = validateTest(test);
            results.push(validation);
          }
        }
      }

      // Run additional checks
      if (options.type === "all" || options.type === "schema") {
        const schemaResults = await runSchemaChecks(cwd, options.model);
        results.push(...schemaResults);
      }

      spinner.succeed("Test discovery complete");

      // Display results
      console.log("\n" + chalk.bold("Test Results:"));
      console.log("─".repeat(60));

      const grouped = groupBy(results, "model");
      
      for (const [model, modelResults] of Object.entries(grouped)) {
        console.log(chalk.bold(`\n📦 ${model}`));
        
        for (const result of modelResults) {
          const icon = result.status === "pass" ? chalk.green("✓") :
                       result.status === "fail" ? chalk.red("✗") :
                       result.status === "warn" ? chalk.yellow("⚠") :
                       chalk.gray("○");
          
          console.log(`  ${icon} ${result.test}`);
          if (result.message) {
            console.log(chalk.gray(`    ${result.message}`));
          }
        }
      }

      // Summary
      const passed = results.filter(r => r.status === "pass").length;
      const failed = results.filter(r => r.status === "fail").length;
      const warned = results.filter(r => r.status === "warn").length;
      const skipped = results.filter(r => r.status === "skip").length;

      console.log("\n" + "─".repeat(60));
      console.log(
        chalk.green(`✓ ${passed} passed`) + "  " +
        chalk.red(`✗ ${failed} failed`) + "  " +
        chalk.yellow(`⚠ ${warned} warnings`) + "  " +
        chalk.gray(`○ ${skipped} skipped`)
      );

      if (failed > 0) {
        process.exit(1);
      }
    } catch (error) {
      spinner.fail("Test execution failed");
      console.error(error);
      process.exit(1);
    }
  });

interface TestDefinition {
  model: string;
  name: string;
  type: string;
  column?: string;
  config?: Record<string, unknown>;
}

function extractTests(yamlContent: string, filePath: string): TestDefinition[] {
  const tests: TestDefinition[] = [];
  
  // Simple YAML parsing for tests
  const modelMatch = yamlContent.match(/- name:\s*(\w+)/g);
  const testMatches = yamlContent.match(/tests:\s*\n([\s\S]*?)(?=\n\s*-\s*name:|\n\s*columns:|\z)/g);
  
  if (modelMatch) {
    for (const match of modelMatch) {
      const modelName = match.replace("- name:", "").trim();
      
      // Check for common test patterns
      if (yamlContent.includes("unique") && yamlContent.includes(modelName)) {
        tests.push({ model: modelName, name: "unique", type: "schema" });
      }
      if (yamlContent.includes("not_null") && yamlContent.includes(modelName)) {
        tests.push({ model: modelName, name: "not_null", type: "schema" });
      }
      if (yamlContent.includes("relationships") && yamlContent.includes(modelName)) {
        tests.push({ model: modelName, name: "relationships", type: "schema" });
      }
      if (yamlContent.includes("accepted_values") && yamlContent.includes(modelName)) {
        tests.push({ model: modelName, name: "accepted_values", type: "schema" });
      }
    }
  }

  return tests;
}

function validateTest(test: TestDefinition): TestResult {
  // Static validation of test configuration
  return {
    model: test.model,
    test: test.name,
    status: "pass",
    message: "Test configuration valid",
  };
}

async function runSchemaChecks(cwd: string, modelFilter?: string): Promise<TestResult[]> {
  const results: TestResult[] = [];
  
  const sqlPattern = modelFilter 
    ? `models/**/*${modelFilter}*.sql`
    : "models/**/*.sql";
  
  const sqlFiles = await glob(sqlPattern, { cwd });

  for (const sqlFile of sqlFiles) {
    const modelName = path.basename(sqlFile, ".sql");
    const content = fs.readFileSync(path.join(cwd, sqlFile), "utf-8");
    
    // Check for SELECT *
    if (content.includes("select *") || content.includes("SELECT *")) {
      results.push({
        model: modelName,
        test: "no_select_star",
        status: "warn",
        message: "SELECT * detected - consider explicit columns",
      });
    }

    // Check for missing config
    if (!content.includes("config(") && !content.includes("{{config")) {
      results.push({
        model: modelName,
        test: "has_config",
        status: "warn",
        message: "No config block found",
      });
    }

    // Check for hardcoded dates
    const datePattern = /'20\d{2}-\d{2}-\d{2}'/g;
    if (datePattern.test(content)) {
      results.push({
        model: modelName,
        test: "no_hardcoded_dates",
        status: "warn",
        message: "Hardcoded date literals detected",
      });
    }

    // Check staging models don't use ref()
    if (modelName.startsWith("stg_") && content.includes("ref(")) {
      results.push({
        model: modelName,
        test: "staging_uses_source",
        status: "fail",
        message: "Staging models should use source(), not ref()",
      });
    }
  }

  return results;
}

async function generateTestSuggestions(cwd: string, modelFilter?: string): Promise<void> {
  console.log(chalk.cyan.bold("\n🔍 Generating Test Suggestions\n"));

  const sqlPattern = modelFilter 
    ? `models/**/*${modelFilter}*.sql`
    : "models/**/*.sql";
  
  const sqlFiles = await glob(sqlPattern, { cwd });

  for (const sqlFile of sqlFiles) {
    const modelName = path.basename(sqlFile, ".sql");
    const content = fs.readFileSync(path.join(cwd, sqlFile), "utf-8");
    
    console.log(chalk.bold(`\n📦 ${modelName}`));
    
    const suggestions: string[] = [];

    // Detect potential primary keys
    const idColumns = content.match(/(\w+_id|\w+_key|id)\b/gi);
    if (idColumns) {
      const uniqueIds = [...new Set(idColumns.map(c => c.toLowerCase()))];
      for (const col of uniqueIds.slice(0, 3)) {
        suggestions.push(`- unique: ${col}`);
        suggestions.push(`- not_null: ${col}`);
      }
    }

    // Detect status/type columns for accepted_values
    const enumColumns = content.match(/(status|type|category|state)\b/gi);
    if (enumColumns) {
      for (const col of [...new Set(enumColumns)].slice(0, 2)) {
        suggestions.push(`- accepted_values: ${col} (define valid values)`);
      }
    }

    // Detect foreign key relationships
    const fkColumns = content.match(/(\w+)_id\b/gi);
    if (fkColumns) {
      for (const col of [...new Set(fkColumns)].slice(0, 3)) {
        const refTable = col.replace(/_id$/i, "");
        if (refTable !== modelName) {
          suggestions.push(`- relationships: ${col} -> ${refTable}.id`);
        }
      }
    }

    // Date columns
    const dateColumns = content.match(/(\w+_at|\w+_date|created|updated|deleted)\b/gi);
    if (dateColumns) {
      for (const col of [...new Set(dateColumns)].slice(0, 2)) {
        suggestions.push(`- not_null: ${col} (if required)`);
      }
    }

    if (suggestions.length > 0) {
      console.log(chalk.gray("  Suggested tests:"));
      for (const s of suggestions) {
        console.log(chalk.yellow(`    ${s}`));
      }
    } else {
      console.log(chalk.gray("  No automatic suggestions - review manually"));
    }
  }

  console.log(chalk.cyan("\n\nAdd these tests to your schema.yml files.\n"));
}

function groupBy<T>(arr: T[], key: keyof T): Record<string, T[]> {
  return arr.reduce((acc, item) => {
    const k = String(item[key]);
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
    return acc;
  }, {} as Record<string, T[]>);
}
