import chalk from "chalk";
import ora from "ora";
import { glob } from "glob";
import { readFileSync } from "fs";
import { join, basename } from "path";
import { loadConfig } from "../utils/config.js";

interface LineageOptions {
  upstream?: boolean;
  downstream?: boolean;
  depth?: string;
  json?: boolean;
}

interface LineageNode {
  name: string;
  type: "model" | "source" | "seed" | "snapshot";
  upstream: string[];
  downstream: string[];
  path?: string;
}

export async function lineageCommand(
  model: string | undefined,
  options: LineageOptions
): Promise<void> {
  const spinner = ora("Building lineage graph...").start();
  
  try {
    const config = loadConfig(".");
    const maxDepth = parseInt(options.depth || "10", 10);
    
    // Build lineage graph from all SQL files
    const files = await glob("**/*.sql", {
      cwd: ".",
      ignore: ["**/target/**", "**/dbt_packages/**", "**/node_modules/**"],
    });

    const nodes = new Map<string, LineageNode>();

    // First pass: extract all refs and sources
    for (const file of files) {
      const content = readFileSync(file, "utf-8");
      const name = basename(file, ".sql");
      
      // Determine type
      let type: LineageNode["type"] = "model";
      if (file.includes("snapshot")) type = "snapshot";
      if (file.includes("seed")) type = "seed";
      
      // Extract refs
      const refs: string[] = [];
      const refMatches = content.matchAll(/\{\{\s*ref\(['"]([^'"]+)['"]\)\s*\}\}/g);
      for (const match of refMatches) {
        refs.push(match[1]);
      }
      
      // Extract sources
      const sources: string[] = [];
      const sourceMatches = content.matchAll(/\{\{\s*source\(['"]([^'"]+)['"],\s*['"]([^'"]+)['"]\)\s*\}\}/g);
      for (const match of sourceMatches) {
        sources.push(`source:${match[1]}.${match[2]}`);
      }
      
      nodes.set(name, {
        name,
        type,
        upstream: [...refs, ...sources],
        downstream: [],
        path: file,
      });
    }

    // Second pass: build downstream relationships
    for (const [name, node] of nodes) {
      for (const upstream of node.upstream) {
        if (upstream.startsWith("source:")) continue;
        const upstreamNode = nodes.get(upstream);
        if (upstreamNode) {
          upstreamNode.downstream.push(name);
        }
      }
    }

    spinner.succeed("Lineage graph built");

    // If no model specified, show overview
    if (!model) {
      if (options.json) {
        console.log(JSON.stringify(Object.fromEntries(nodes), null, 2));
        return;
      }

      console.log(chalk.bold("\nLineage Overview"));
      console.log(chalk.gray("─".repeat(50)));

      // Find root models (no upstream except sources)
      const roots = Array.from(nodes.values()).filter(
        n => n.upstream.every(u => u.startsWith("source:"))
      );
      
      // Find leaf models (no downstream)
      const leaves = Array.from(nodes.values()).filter(
        n => n.downstream.length === 0
      );
      
      // Find most connected models
      const byConnections = Array.from(nodes.values())
        .map(n => ({ name: n.name, connections: n.upstream.length + n.downstream.length }))
        .sort((a, b) => b.connections - a.connections)
        .slice(0, 5);

      console.log(`\nTotal models: ${nodes.size}`);
      console.log(`Root models (source-only): ${roots.length}`);
      console.log(`Leaf models (endpoints): ${leaves.length}`);
      
      console.log(chalk.bold("\nMost connected models:"));
      for (const m of byConnections) {
        console.log(`  ${m.name}: ${m.connections} connections`);
      }

      console.log(chalk.gray("\nTip: Run 'datachonk lineage <model>' to see specific model lineage"));
      return;
    }

    // Show lineage for specific model
    const targetNode = nodes.get(model);
    if (!targetNode) {
      console.log(chalk.red(`Model '${model}' not found`));
      process.exit(1);
    }

    if (options.json) {
      const result = {
        model: targetNode.name,
        upstream: options.downstream ? [] : collectLineage(nodes, model, "upstream", maxDepth),
        downstream: options.upstream ? [] : collectLineage(nodes, model, "downstream", maxDepth),
      };
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    // Print tree visualization
    console.log(chalk.bold(`\nLineage for ${chalk.cyan(model)}`));
    console.log(chalk.gray("─".repeat(50)));

    if (!options.downstream) {
      console.log(chalk.bold("\n⬆ Upstream:"));
      printLineageTree(nodes, model, "upstream", maxDepth);
    }

    console.log(chalk.cyan.bold(`\n● ${model}`));

    if (!options.upstream) {
      console.log(chalk.bold("\n⬇ Downstream:"));
      printLineageTree(nodes, model, "downstream", maxDepth);
    }

    // Impact assessment
    const downstreamCount = collectLineage(nodes, model, "downstream", maxDepth).length;
    console.log(chalk.bold("\nImpact Assessment:"));
    if (downstreamCount === 0) {
      console.log(chalk.green("  ✓ No downstream dependencies - safe to modify"));
    } else if (downstreamCount <= 3) {
      console.log(chalk.green(`  ✓ Low impact - ${downstreamCount} downstream model(s)`));
    } else if (downstreamCount <= 10) {
      console.log(chalk.yellow(`  ⚠ Medium impact - ${downstreamCount} downstream models`));
    } else {
      console.log(chalk.red(`  ⚠ High impact - ${downstreamCount} downstream models`));
      console.log(chalk.gray("    Consider using model versions for breaking changes"));
    }

  } catch (error) {
    spinner.fail("Lineage analysis failed");
    console.error(chalk.red(error instanceof Error ? error.message : "Unknown error"));
    process.exit(1);
  }
}

function collectLineage(
  nodes: Map<string, LineageNode>,
  model: string,
  direction: "upstream" | "downstream",
  maxDepth: number,
  visited = new Set<string>()
): string[] {
  if (maxDepth === 0 || visited.has(model)) return [];
  visited.add(model);
  
  const node = nodes.get(model);
  if (!node) return [];
  
  const deps = direction === "upstream" ? node.upstream : node.downstream;
  const result: string[] = [];
  
  for (const dep of deps) {
    if (dep.startsWith("source:")) {
      result.push(dep);
    } else {
      result.push(dep);
      result.push(...collectLineage(nodes, dep, direction, maxDepth - 1, visited));
    }
  }
  
  return [...new Set(result)];
}

function printLineageTree(
  nodes: Map<string, LineageNode>,
  model: string,
  direction: "upstream" | "downstream",
  maxDepth: number,
  prefix = "",
  visited = new Set<string>()
): void {
  if (maxDepth === 0 || visited.has(model)) return;
  visited.add(model);
  
  const node = nodes.get(model);
  if (!node) return;
  
  const deps = direction === "upstream" ? node.upstream : node.downstream;
  
  for (let i = 0; i < deps.length; i++) {
    const dep = deps[i];
    const isLast = i === deps.length - 1;
    const connector = isLast ? "└─" : "├─";
    const childPrefix = isLast ? "  " : "│ ";
    
    if (dep.startsWith("source:")) {
      console.log(chalk.gray(`${prefix}${connector} ${dep}`));
    } else {
      const depNode = nodes.get(dep);
      const typeColor = 
        dep.startsWith("stg_") ? chalk.cyan :
        dep.startsWith("int_") ? chalk.blue :
        dep.startsWith("fct_") || dep.startsWith("dim_") ? chalk.green :
        chalk.white;
      
      console.log(`${prefix}${connector} ${typeColor(dep)}`);
      
      if (depNode && !visited.has(dep)) {
        printLineageTree(nodes, dep, direction, maxDepth - 1, prefix + childPrefix, visited);
      }
    }
  }
}
