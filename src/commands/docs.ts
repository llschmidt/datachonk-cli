import chalk from "chalk";
import ora from "ora";
import { glob } from "glob";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname, basename } from "path";
import yaml from "js-yaml";
import { loadConfig } from "../utils/config.js";
import { parseModel } from "../utils/analyzer.js";

interface DocsOptions {
  enhance?: boolean;
  missingOnly?: boolean;
}

export async function docsCommand(
  models: string[],
  options: DocsOptions
): Promise<void> {
  const spinner = ora("Scanning models...").start();
  
  try {
    const config = loadConfig(".");
    
    // Find all SQL files
    const pattern = models.length > 0 
      ? models.map(m => `**/${m}.sql`)
      : ["**/*.sql"];
    
    const files: string[] = [];
    for (const p of pattern) {
      const matches = await glob(p, {
        cwd: ".",
        ignore: ["**/target/**", "**/dbt_packages/**", "**/node_modules/**"],
      });
      files.push(...matches);
    }

    if (files.length === 0) {
      spinner.fail("No SQL files found");
      return;
    }

    spinner.text = `Found ${files.length} models. Generating documentation...`;

    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      const name = basename(file, ".sql");
      const model = parseModel(content, name);
      
      // Find or create schema file
      const schemaPath = file.replace(".sql", ".yml");
      const dirSchemaPath = join(dirname(file), "_schema.yml");
      
      let existingSchema: Record<string, unknown> | null = null;
      let targetPath = schemaPath;
      
      if (existsSync(schemaPath)) {
        existingSchema = yaml.load(readFileSync(schemaPath, "utf-8")) as Record<string, unknown>;
        targetPath = schemaPath;
      } else if (existsSync(dirSchemaPath)) {
        existingSchema = yaml.load(readFileSync(dirSchemaPath, "utf-8")) as Record<string, unknown>;
        targetPath = dirSchemaPath;
      }

      // Check if model already has description
      if (options.missingOnly && existingSchema) {
        const models = existingSchema.models as Array<Record<string, unknown>> | undefined;
        const modelEntry = models?.find((m: Record<string, unknown>) => m.name === name);
        if (modelEntry?.description) {
          skipped++;
          continue;
        }
      }

      // Generate documentation
      const description = generateDescription(name, model, content);
      const columns = extractColumns(content, model);
      
      const newModelEntry = {
        name,
        description,
        columns: columns.map(col => ({
          name: col.name,
          description: col.description,
          data_tests: col.isPrimaryKey ? [
            { unique: null },
            { not_null: null },
          ] : col.isRequired ? [
            { not_null: null },
          ] : undefined,
        })).filter(c => c.description || c.data_tests),
      };

      if (existingSchema) {
        // Update existing schema
        const models = (existingSchema.models || []) as Array<Record<string, unknown>>;
        const existingIndex = models.findIndex((m: Record<string, unknown>) => m.name === name);
        
        if (existingIndex >= 0) {
          if (options.enhance) {
            // Merge with existing
            const existing = models[existingIndex];
            models[existingIndex] = {
              ...existing,
              description: existing.description || newModelEntry.description,
              columns: mergeColumns(
                existing.columns as Array<Record<string, unknown>> | undefined,
                newModelEntry.columns as Array<Record<string, unknown>>
              ),
            };
          }
          updated++;
        } else {
          models.push(newModelEntry);
          created++;
        }
        
        existingSchema.models = models;
        writeFileSync(targetPath, yaml.dump(existingSchema, { indent: 2, lineWidth: 120 }));
      } else {
        // Create new schema file
        const newSchema = {
          version: 2,
          models: [newModelEntry],
        };
        writeFileSync(targetPath, yaml.dump(newSchema, { indent: 2, lineWidth: 120 }));
        created++;
      }
    }

    spinner.succeed("Documentation complete");
    
    console.log(chalk.bold("\nResults:"));
    console.log(`  Created: ${chalk.green(created.toString())}`);
    console.log(`  Updated: ${chalk.blue(updated.toString())}`);
    console.log(`  Skipped: ${chalk.gray(skipped.toString())}`);
    
    console.log(chalk.gray("\nTip: Run 'dbt docs generate && dbt docs serve' to preview"));

  } catch (error) {
    spinner.fail("Documentation generation failed");
    console.error(chalk.red(error instanceof Error ? error.message : "Unknown error"));
    process.exit(1);
  }
}

function generateDescription(name: string, model: ReturnType<typeof parseModel>, content: string): string {
  // Extract type from name prefix
  const prefix = name.split("_")[0];
  const typeName = name.replace(/^(stg|int|fct|dim|obt)_/, "");
  
  const typeDescriptions: Record<string, string> = {
    stg: `Staging model for ${typeName.replace(/_/g, " ")}. Provides cleaned and typed source data.`,
    int: `Intermediate model for ${typeName.replace(/_/g, " ")}. Applies business logic and transformations.`,
    fct: `Fact table for ${typeName.replace(/_/g, " ")}. Contains measurable, quantitative data.`,
    dim: `Dimension table for ${typeName.replace(/_/g, " ")}. Contains descriptive attributes.`,
    obt: `One Big Table combining ${typeName.replace(/_/g, " ")} data. Denormalized for analytics.`,
  };
  
  // Check for existing comments in SQL
  const headerComment = content.match(/^--\s*(.+)$/m);
  if (headerComment) {
    return headerComment[1].trim();
  }
  
  return typeDescriptions[prefix] || `Model for ${typeName.replace(/_/g, " ")} data.`;
}

interface ColumnInfo {
  name: string;
  description: string;
  isPrimaryKey: boolean;
  isRequired: boolean;
}

function extractColumns(content: string, model: ReturnType<typeof parseModel>): ColumnInfo[] {
  const columns: ColumnInfo[] = [];
  
  // Try to extract from final SELECT
  const selectMatch = content.match(/select\s+([\s\S]+?)\s+from/i);
  if (!selectMatch) return columns;
  
  const selectClause = selectMatch[1];
  
  // Parse column expressions
  const columnPatterns = selectClause.split(/,(?![^(]*\))/);
  
  for (const pattern of columnPatterns) {
    const trimmed = pattern.trim();
    if (!trimmed || trimmed === "*") continue;
    
    // Extract column name (handle aliases)
    const aliasMatch = trimmed.match(/(?:as\s+)?(\w+)\s*$/i);
    if (!aliasMatch) continue;
    
    const name = aliasMatch[1];
    
    // Generate description based on common patterns
    let description = "";
    let isPrimaryKey = false;
    let isRequired = false;
    
    if (name.endsWith("_id")) {
      description = `Unique identifier for ${name.replace(/_id$/, "").replace(/_/g, " ")}`;
      if (name === model.name.replace(/^(stg|int|fct|dim)_/, "") + "_id" || 
          name === model.name.split("_").pop() + "_id") {
        isPrimaryKey = true;
        isRequired = true;
      }
    } else if (name.endsWith("_at") || name.endsWith("_date") || name.endsWith("_timestamp")) {
      description = `Timestamp of when ${name.replace(/_(at|date|timestamp)$/, "").replace(/_/g, " ")} occurred`;
    } else if (name.startsWith("is_") || name.startsWith("has_")) {
      description = `Boolean flag indicating ${name.replace(/^(is_|has_)/, "").replace(/_/g, " ")}`;
    } else if (name.endsWith("_amount") || name.endsWith("_total") || name.endsWith("_count")) {
      description = `Numeric value for ${name.replace(/_(amount|total|count)$/, "").replace(/_/g, " ")}`;
    } else if (name.endsWith("_name")) {
      description = `Name of the ${name.replace(/_name$/, "").replace(/_/g, " ")}`;
    } else if (name.endsWith("_type") || name.endsWith("_status") || name.endsWith("_category")) {
      description = `${name.split("_").pop()?.charAt(0).toUpperCase()}${name.split("_").pop()?.slice(1)} classification`;
    }
    
    // Check for NOT NULL in column definition
    if (trimmed.toLowerCase().includes("not null") || trimmed.toLowerCase().includes("coalesce")) {
      isRequired = true;
    }
    
    columns.push({ name, description, isPrimaryKey, isRequired });
  }
  
  return columns;
}

function mergeColumns(
  existing: Array<Record<string, unknown>> | undefined,
  generated: Array<Record<string, unknown>>
): Array<Record<string, unknown>> {
  if (!existing) return generated;
  
  const merged = [...existing];
  
  for (const col of generated) {
    const existingIndex = merged.findIndex(c => c.name === col.name);
    if (existingIndex < 0) {
      merged.push(col);
    } else if (!merged[existingIndex].description && col.description) {
      merged[existingIndex] = { ...merged[existingIndex], description: col.description };
    }
  }
  
  return merged;
}
