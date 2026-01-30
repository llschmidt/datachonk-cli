import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import * as fs from "fs";
import * as path from "path";
import { glob } from "glob";

type Warehouse = "snowflake" | "bigquery" | "redshift" | "databricks" | "postgres";

const SQL_MAPPINGS: Record<string, Record<Warehouse, string>> = {
  // Date functions
  "GETDATE()": {
    snowflake: "CURRENT_TIMESTAMP()",
    bigquery: "CURRENT_TIMESTAMP()",
    redshift: "GETDATE()",
    databricks: "CURRENT_TIMESTAMP()",
    postgres: "NOW()",
  },
  "DATEADD": {
    snowflake: "DATEADD",
    bigquery: "DATE_ADD",
    redshift: "DATEADD",
    databricks: "DATE_ADD",
    postgres: "DATE + INTERVAL",
  },
  "DATEDIFF": {
    snowflake: "DATEDIFF",
    bigquery: "DATE_DIFF",
    redshift: "DATEDIFF",
    databricks: "DATEDIFF",
    postgres: "DATE_PART",
  },
  "NVL": {
    snowflake: "NVL",
    bigquery: "IFNULL",
    redshift: "NVL",
    databricks: "NVL",
    postgres: "COALESCE",
  },
  "DECODE": {
    snowflake: "DECODE",
    bigquery: "CASE",
    redshift: "DECODE",
    databricks: "CASE",
    postgres: "CASE",
  },
  "TO_DATE": {
    snowflake: "TO_DATE",
    bigquery: "PARSE_DATE",
    redshift: "TO_DATE",
    databricks: "TO_DATE",
    postgres: "TO_DATE",
  },
  "LISTAGG": {
    snowflake: "LISTAGG",
    bigquery: "STRING_AGG",
    redshift: "LISTAGG",
    databricks: "COLLECT_LIST",
    postgres: "STRING_AGG",
  },
  "ROWNUM": {
    snowflake: "ROW_NUMBER() OVER ()",
    bigquery: "ROW_NUMBER() OVER ()",
    redshift: "ROW_NUMBER() OVER ()",
    databricks: "ROW_NUMBER() OVER ()",
    postgres: "ROW_NUMBER() OVER ()",
  },
};

export const migrateCommand = new Command("migrate")
  .description("Migrate SQL syntax between warehouse platforms")
  .option("-f, --from <warehouse>", "Source warehouse", "redshift")
  .option("-t, --to <warehouse>", "Target warehouse", "snowflake")
  .option("-p, --path <path>", "Path to migrate (file or directory)", ".")
  .option("--dry-run", "Show changes without applying")
  .option("-o, --output <path>", "Output directory for migrated files")
  .action(async (options) => {
    const from = options.from.toLowerCase() as Warehouse;
    const to = options.to.toLowerCase() as Warehouse;
    
    console.log(chalk.cyan.bold("\n🔄 DataChonk SQL Migration Tool\n"));
    console.log(chalk.gray(`Migrating from ${chalk.bold(from)} to ${chalk.bold(to)}\n`));

    const spinner = ora("Discovering files...").start();

    try {
      const targetPath = path.resolve(options.path);
      const stat = fs.statSync(targetPath);
      
      let files: string[] = [];
      if (stat.isDirectory()) {
        files = await glob("**/*.sql", { cwd: targetPath });
        files = files.map(f => path.join(targetPath, f));
      } else {
        files = [targetPath];
      }

      spinner.succeed(`Found ${files.length} SQL file(s)`);

      let totalChanges = 0;
      const changedFiles: string[] = [];

      for (const file of files) {
        const originalContent = fs.readFileSync(file, "utf-8");
        const { content: migratedContent, changes } = migrateSql(originalContent, from, to);
        
        if (changes.length > 0) {
          totalChanges += changes.length;
          changedFiles.push(file);
          
          console.log(chalk.bold(`\n📄 ${path.relative(process.cwd(), file)}`));
          for (const change of changes) {
            console.log(chalk.gray(`  Line ${change.line}: `) + 
                       chalk.red(change.from) + 
                       chalk.gray(" → ") + 
                       chalk.green(change.to));
          }

          if (!options.dryRun) {
            const outputPath = options.output 
              ? path.join(options.output, path.relative(targetPath, file))
              : file;
            
            if (options.output) {
              fs.mkdirSync(path.dirname(outputPath), { recursive: true });
            }
            
            fs.writeFileSync(outputPath, migratedContent);
            console.log(chalk.green(`  ✓ Written to ${path.relative(process.cwd(), outputPath)}`));
          }
        }
      }

      // Summary
      console.log("\n" + "─".repeat(60));
      console.log(chalk.bold("Migration Summary:"));
      console.log(`  Files scanned: ${files.length}`);
      console.log(`  Files changed: ${changedFiles.length}`);
      console.log(`  Total changes: ${totalChanges}`);
      
      if (options.dryRun) {
        console.log(chalk.yellow("\n  Dry run - no files were modified"));
      }

      // Provide additional guidance
      console.log(chalk.cyan("\n\n📝 Post-Migration Checklist:"));
      console.log(chalk.gray(`  1. Review data type mappings (especially VARIANT, ARRAY, STRUCT)`));
      console.log(chalk.gray(`  2. Update warehouse-specific functions not covered`));
      console.log(chalk.gray(`  3. Test incremental logic and merge strategies`));
      console.log(chalk.gray(`  4. Validate partition/cluster key syntax`));
      console.log(chalk.gray(`  5. Run dbt compile to catch syntax errors\n`));

    } catch (error) {
      spinner.fail("Migration failed");
      console.error(error);
      process.exit(1);
    }
  });

interface Change {
  line: number;
  from: string;
  to: string;
}

function migrateSql(content: string, from: Warehouse, to: Warehouse): { content: string; changes: Change[] } {
  const changes: Change[] = [];
  const lines = content.split("\n");
  
  const migratedLines = lines.map((line, index) => {
    let newLine = line;
    
    // Apply mappings
    for (const [pattern, mapping] of Object.entries(SQL_MAPPINGS)) {
      const regex = new RegExp(pattern.replace(/[()]/g, "\\$&"), "gi");
      if (regex.test(line)) {
        const fromSyntax = mapping[from] || pattern;
        const toSyntax = mapping[to];
        
        if (fromSyntax !== toSyntax) {
          const fromRegex = new RegExp(fromSyntax.replace(/[()]/g, "\\$&"), "gi");
          if (fromRegex.test(line)) {
            newLine = line.replace(fromRegex, toSyntax);
            changes.push({
              line: index + 1,
              from: fromSyntax,
              to: toSyntax,
            });
          }
        }
      }
    }

    // Warehouse-specific transformations
    newLine = applyWarehouseSpecificMigrations(newLine, from, to, index + 1, changes);
    
    return newLine;
  });

  return { content: migratedLines.join("\n"), changes };
}

function applyWarehouseSpecificMigrations(
  line: string, 
  from: Warehouse, 
  to: Warehouse,
  lineNum: number,
  changes: Change[]
): string {
  let newLine = line;

  // Redshift to Snowflake specific
  if (from === "redshift" && to === "snowflake") {
    // IDENTITY columns
    if (/IDENTITY\s*\(\s*\d+\s*,\s*\d+\s*\)/i.test(line)) {
      newLine = line.replace(/IDENTITY\s*\(\s*\d+\s*,\s*\d+\s*\)/gi, "AUTOINCREMENT");
      changes.push({ line: lineNum, from: "IDENTITY(x,x)", to: "AUTOINCREMENT" });
    }
    
    // DISTKEY/SORTKEY (Snowflake doesn't use these)
    if (/DISTKEY\s*\([^)]+\)/i.test(line)) {
      newLine = line.replace(/DISTKEY\s*\([^)]+\)/gi, "/* DISTKEY removed */");
      changes.push({ line: lineNum, from: "DISTKEY", to: "/* removed */" });
    }
    if (/SORTKEY\s*\([^)]+\)/i.test(line)) {
      newLine = line.replace(/SORTKEY\s*\([^)]+\)/gi, "/* SORTKEY removed */");
      changes.push({ line: lineNum, from: "SORTKEY", to: "/* removed */" });
    }
  }

  // BigQuery specific
  if (to === "bigquery") {
    // SAFE_DIVIDE instead of /
    if (/\/\s*0/.test(line) || /divide.*by.*zero/i.test(line)) {
      // Add comment suggesting SAFE_DIVIDE
      changes.push({ line: lineNum, from: "division", to: "consider SAFE_DIVIDE()" });
    }
    
    // STRUCT syntax
    if (/ROW\s*\(/i.test(line)) {
      newLine = line.replace(/ROW\s*\(/gi, "STRUCT(");
      changes.push({ line: lineNum, from: "ROW(", to: "STRUCT(" });
    }
  }

  // Databricks specific  
  if (to === "databricks") {
    // Delta Lake table format
    if (/CREATE\s+TABLE/i.test(line) && !line.includes("USING DELTA")) {
      newLine = line.replace(/(CREATE\s+TABLE)/i, "$1 /* Consider USING DELTA */");
      changes.push({ line: lineNum, from: "CREATE TABLE", to: "USING DELTA suggested" });
    }
  }

  return newLine;
}
