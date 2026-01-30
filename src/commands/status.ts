import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import yaml from "js-yaml";
import { loadConfig, getApiUrl, getApiKey } from "../utils/config.js";

interface DashboardData {
  user: {
    email: string;
    name?: string;
    subscription_tier: string;
  };
  usage: {
    projects: number;
    projectLimit: number;
    aiRequestsThisMonth: number;
    aiRequestLimit: number;
  };
  projects: Array<{
    id: string;
    name: string;
    warehouse: string;
    modelsCount: number;
    lastActivity?: string;
  }>;
  recentActivity: Array<{
    action: string;
    details: string;
    timestamp: string;
  }>;
}

export const statusCommand = new Command("status")
  .description("Show DataChonk account status and usage")
  .option("--json", "Output as JSON")
  .action(async (options) => {
    const apiKey = getApiKey();
    
    if (!apiKey) {
      // Show local status only
      console.log(chalk.hex("#E8A54B").bold("\n  DataChonk Status\n"));
      console.log(chalk.gray("  ─".repeat(20)));
      console.log(chalk.yellow("  Not logged in"));
      console.log(chalk.gray("\n  Run: datachonk auth login\n"));
      
      // Check for local dbt project
      if (existsSync("dbt_project.yml")) {
        const dbtProject = yaml.load(readFileSync("dbt_project.yml", "utf-8")) as { name: string };
        console.log(chalk.gray("  Local dbt project detected:"));
        console.log(chalk.cyan(`    ${dbtProject.name}`));
      }
      
      // Check for .datachonk.yml
      if (existsSync(".datachonk.yml")) {
        const datachonkConfig = yaml.load(readFileSync(".datachonk.yml", "utf-8")) as { 
          project_id?: string;
          warehouse?: string;
        };
        if (datachonkConfig.project_id) {
          console.log(chalk.gray("\n  Linked to DataChonk project:"));
          console.log(chalk.cyan(`    ${datachonkConfig.project_id}`));
        }
      }
      
      return;
    }

    const spinner = ora("Fetching status...").start();

    try {
      const apiUrl = getApiUrl();
      const response = await fetch(`${apiUrl}/api/cli/dashboard`, {
        headers: { "Authorization": `Bearer ${apiKey}` },
      });

      if (!response.ok) {
        throw new Error("Failed to fetch status");
      }

      const data = await response.json() as DashboardData;
      spinner.stop();

      if (options.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      // Display dashboard
      console.log(chalk.hex("#E8A54B").bold("\n  DataChonk Dashboard\n"));
      console.log(chalk.gray("  ─".repeat(25)));

      // Account info
      console.log(chalk.bold("\n  Account"));
      console.log(`  ${chalk.gray("Email:")}  ${data.user.email}`);
      console.log(`  ${chalk.gray("Plan:")}   ${chalk.cyan(data.user.subscription_tier)}`);

      // Usage
      console.log(chalk.bold("\n  Usage This Month"));
      const projectPercent = data.usage.projectLimit === -1 
        ? "unlimited" 
        : `${data.usage.projects}/${data.usage.projectLimit}`;
      const aiPercent = data.usage.aiRequestLimit === -1
        ? "unlimited"
        : `${data.usage.aiRequestsThisMonth}/${data.usage.aiRequestLimit}`;
      
      console.log(`  ${chalk.gray("Projects:")}     ${projectPercent}`);
      console.log(`  ${chalk.gray("AI Requests:")}  ${aiPercent}`);

      // Progress bars for limits
      if (data.usage.projectLimit > 0) {
        const pct = Math.min(100, (data.usage.projects / data.usage.projectLimit) * 100);
        console.log(`  ${renderProgressBar(pct)}`);
      }

      // Projects
      if (data.projects.length > 0) {
        console.log(chalk.bold("\n  Your Projects"));
        for (const project of data.projects.slice(0, 5)) {
          const activity = project.lastActivity 
            ? chalk.gray(` (${timeAgo(new Date(project.lastActivity))})`)
            : "";
          console.log(`  ${chalk.cyan(project.name)} - ${project.warehouse}, ${project.modelsCount} models${activity}`);
        }
        if (data.projects.length > 5) {
          console.log(chalk.gray(`  ... +${data.projects.length - 5} more`));
        }
      }

      // Recent activity
      if (data.recentActivity.length > 0) {
        console.log(chalk.bold("\n  Recent Activity"));
        for (const activity of data.recentActivity.slice(0, 5)) {
          const time = timeAgo(new Date(activity.timestamp));
          console.log(`  ${chalk.gray(time)} - ${activity.details}`);
        }
      }

      console.log();

    } catch (error) {
      spinner.fail("Failed to fetch status");
      console.error(chalk.red(error instanceof Error ? error.message : "Unknown error"));
      process.exit(1);
    }
  });

function renderProgressBar(percent: number): string {
  const width = 20;
  const filled = Math.round((percent / 100) * width);
  const empty = width - filled;
  
  const color = percent >= 90 ? chalk.red : percent >= 70 ? chalk.yellow : chalk.green;
  return color("█".repeat(filled)) + chalk.gray("░".repeat(empty)) + ` ${Math.round(percent)}%`;
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);
  
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return date.toLocaleDateString();
}

// Open web dashboard
export const openCommand = new Command("open")
  .description("Open DataChonk web dashboard in browser")
  .argument("[page]", "Page to open: dashboard, projects, settings, docs")
  .action(async (page = "dashboard") => {
    const { default: open } = await import("open");
    const apiUrl = getApiUrl();
    
    const pages: Record<string, string> = {
      dashboard: "/app",
      projects: "/app",
      settings: "/app/settings",
      docs: "/docs",
      pricing: "/pricing",
      help: "/docs",
    };
    
    const path = pages[page] || "/app";
    const url = `${apiUrl}${path}`;
    
    console.log(chalk.gray(`Opening ${url}...`));
    await open(url);
  });

// Version command with update check
export const versionCommand = new Command("version")
  .description("Show version and check for updates")
  .action(async () => {
    const currentVersion = "0.1.0";
    
    console.log(chalk.hex("#E8A54B").bold("\n  DataChonk CLI"));
    console.log(chalk.gray("  ─".repeat(15)));
    console.log(`  ${chalk.gray("Version:")}  ${currentVersion}`);
    
    // Check for updates
    const spinner = ora("Checking for updates...").start();
    
    try {
      const response = await fetch("https://registry.npmjs.org/datachonk-cli/latest", {
        headers: { "Accept": "application/json" },
      });
      
      if (response.ok) {
        const data = await response.json() as { version: string };
        spinner.stop();
        
        if (data.version !== currentVersion) {
          console.log(`  ${chalk.gray("Latest:")}   ${chalk.green(data.version)} ${chalk.yellow("(update available)")}`);
          console.log(chalk.gray("\n  Run: npm update -g datachonk-cli"));
        } else {
          console.log(chalk.green("  You're up to date!"));
        }
      } else {
        spinner.stop();
      }
    } catch {
      spinner.stop();
      // Silently ignore update check failures
    }
    
    console.log();
  });
