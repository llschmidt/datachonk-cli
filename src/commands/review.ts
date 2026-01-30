import chalk from "chalk";
import ora from "ora";
import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { loadConfig } from "../utils/config.js";

interface ReviewOptions {
  strict?: boolean;
  json?: boolean;
  local?: boolean;
}

export async function reviewCommand(
  files: string[],
  options: ReviewOptions
): Promise<void> {
  const spinner = ora("Preparing code review...").start();
  
  try {
    const config = loadConfig(".");
    const apiKey = config.ai?.apiKey || process.env.DATACHONK_API_KEY;
    
    // If no files specified, get staged git files
    if (files.length === 0) {
      try {
        const stagedFiles = execSync("git diff --cached --name-only --diff-filter=ACMR", {
          encoding: "utf-8",
        })
          .split("\n")
          .filter(f => f.endsWith(".sql") || f.endsWith(".yml"));
        
        if (stagedFiles.length === 0) {
          const modifiedFiles = execSync("git diff --name-only --diff-filter=ACMR", {
            encoding: "utf-8",
          })
            .split("\n")
            .filter(f => f.endsWith(".sql") || f.endsWith(".yml"));
          
          files = modifiedFiles;
        } else {
          files = stagedFiles;
        }
      } catch {
        spinner.fail("No files to review. Specify files or run in a git repository.");
        process.exit(1);
      }
    }

    if (files.length === 0) {
      spinner.fail("No SQL files to review");
      process.exit(1);
    }

    spinner.text = `Reviewing ${files.length} file(s)...`;

    // Read file contents and diffs
    const fileData = files
      .filter(f => existsSync(f))
      .map(file => {
        const content = readFileSync(file, "utf-8");
        let diff: string | undefined;
        
        try {
          diff = execSync(`git diff HEAD -- "${file}"`, { encoding: "utf-8" });
        } catch {
          // Not in git or no diff
        }
        
        return { path: file, content, diff };
      });

    // Get PR info if available
    let prTitle: string | undefined;
    let prDescription: string | undefined;
    let baseBranch: string | undefined;
    
    try {
      baseBranch = execSync("git rev-parse --abbrev-ref HEAD", { encoding: "utf-8" }).trim();
    } catch {
      // Ignore
    }

    // Use AI-powered review via API
    if (apiKey && !options.local) {
      spinner.text = "Running AI-powered review...";
      
      const { getApiUrl } = await import("../utils/config.js");
      const baseUrl = getApiUrl();
      const response = await fetch(`${baseUrl}/api/cli/review`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          files: fileData,
          baseBranch,
          prTitle,
          prDescription,
          warehouse: config.warehouse || "snowflake",
        }),
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      interface AIReview {
        verdict: "approve" | "request_changes" | "comment";
        overallScore: number;
        summary: string;
        strengths?: string[];
        comments?: Array<{
          severity: string;
          category: string;
          file: string;
          line?: number;
          message: string;
          suggestion?: string;
          codeExample?: string;
        }>;
        improvements?: string[];
      }
      
      const review = await response.json() as AIReview;
      spinner.succeed("AI review complete");

      if (options.json) {
        console.log(JSON.stringify(review, null, 2));
        return;
      }

      // Print AI review
      console.log("\n" + chalk.bold.cyan("AI Code Review"));
      console.log(chalk.gray("─".repeat(60)));
      
      // Overall verdict
      const verdictColor = review.verdict === "approve" ? chalk.green : 
                          review.verdict === "request_changes" ? chalk.red : chalk.yellow;
      const verdictIcon = review.verdict === "approve" ? "✓" : 
                         review.verdict === "request_changes" ? "✖" : "○";
      
      console.log(`\n${verdictColor(`${verdictIcon} ${review.verdict.replace("_", " ").toUpperCase()}`)}  Score: ${review.overallScore}/100\n`);
      
      // Summary
      console.log(chalk.white(review.summary));

      // Strengths
      if (review.strengths && review.strengths.length > 0) {
        console.log(chalk.green.bold("\nStrengths:"));
        for (const strength of review.strengths) {
          console.log(chalk.green(`  ✓ ${strength}`));
        }
      }

      // Comments/Issues
      if (review.comments && review.comments.length > 0) {
        console.log(chalk.yellow.bold("\nComments:"));
        for (const comment of review.comments) {
          const severityColor = 
            comment.severity === "blocker" || comment.severity === "critical" ? chalk.red :
            comment.severity === "major" ? chalk.hex("#FFA500") :
            comment.severity === "minor" ? chalk.yellow :
            chalk.cyan;
          
          console.log(`\n  ${severityColor(`[${comment.severity.toUpperCase()}]`)} ${chalk.bold(comment.category)}`);
          console.log(chalk.gray(`  File: ${comment.file}${comment.line ? `:${comment.line}` : ""}`));
          console.log(`  ${comment.message}`);
          if (comment.suggestion) {
            console.log(chalk.cyan(`  Suggestion: ${comment.suggestion}`));
          }
          if (comment.codeExample) {
            console.log(chalk.gray("\n  Example:"));
            console.log(chalk.white(`  ${comment.codeExample.replace(/\n/g, "\n  ")}`));
          }
        }
      }

      // Improvements
      if (review.improvements && review.improvements.length > 0) {
        console.log(chalk.blue.bold("\nRecommended Improvements:"));
        for (const improvement of review.improvements) {
          console.log(chalk.blue(`  → ${improvement}`));
        }
      }

      // Exit code based on verdict
      if (review.verdict === "request_changes" && options.strict) {
        process.exit(1);
      }
      return;
    }

    // Fallback to local review if no API key
    spinner.text = "Running local review...";
    const { parseModel, reviewCode } = await import("../utils/analyzer.js");

    const reviews: Array<{
      file: string;
      score: number;
      overall: "approve" | "request_changes" | "comment";
      strengths: string[];
      issues: Array<{
        severity: string;
        title: string;
        description: string;
        suggestion: string;
        line?: number;
      }>;
    }> = [];

    for (const file of fileData) {
      const model = parseModel(file.content, file.path);
      const review = reviewCode(model, file.content, config.warehouse || "snowflake", options.strict);
      
      reviews.push({
        file: file.path,
        ...review,
      });
    }

    spinner.succeed("Review complete");

    if (options.json) {
      console.log(JSON.stringify(reviews, null, 2));
      return;
    }

    // Print local reviews
    for (const review of reviews) {
      console.log("\n" + chalk.bold(`📄 ${review.file}`));
      console.log(chalk.gray("─".repeat(50)));

      const scoreColor = review.score >= 80 ? chalk.green : review.score >= 60 ? chalk.yellow : chalk.red;
      const statusIcon = review.overall === "approve" ? "✓" : review.overall === "request_changes" ? "✖" : "○";
      const statusColor = review.overall === "approve" ? chalk.green : review.overall === "request_changes" ? chalk.red : chalk.yellow;
      
      console.log(`${statusColor(statusIcon)} ${statusColor(review.overall.replace("_", " ").toUpperCase())}  ${scoreColor(`Score: ${review.score}/100`)}`);

      if (review.strengths.length > 0) {
        console.log(chalk.green("\n  Strengths:"));
        for (const strength of review.strengths) {
          console.log(chalk.green(`    ✓ ${strength}`));
        }
      }

      if (review.issues.length > 0) {
        console.log(chalk.red("\n  Issues:"));
        for (const issue of review.issues) {
          const severityColor = 
            issue.severity === "critical" ? chalk.red :
            issue.severity === "high" ? chalk.hex("#FFA500") :
            issue.severity === "medium" ? chalk.yellow :
            chalk.gray;
          
          console.log(`    ${severityColor(`[${issue.severity.toUpperCase()}]`)} ${issue.title}`);
          console.log(chalk.gray(`      ${issue.description}`));
          console.log(chalk.cyan(`      Suggestion: ${issue.suggestion}`));
        }
      }
    }

    // Summary
    const totalIssues = reviews.reduce((acc, r) => acc + r.issues.length, 0);
    const avgScore = Math.round(reviews.reduce((acc, r) => acc + r.score, 0) / reviews.length);
    const hasBlockers = reviews.some(r => r.overall === "request_changes");

    console.log("\n" + chalk.bold("Summary"));
    console.log(chalk.gray("─".repeat(50)));
    console.log(`Files reviewed: ${reviews.length}`);
    console.log(`Average score: ${avgScore}/100`);
    console.log(`Total issues: ${totalIssues}`);

    if (hasBlockers) {
      console.log(chalk.red("\n✖ Review found blocking issues"));
      if (options.strict) process.exit(1);
    } else if (totalIssues > 0) {
      console.log(chalk.yellow("\n⚠ Review passed with suggestions"));
    } else {
      console.log(chalk.green("\n✓ Review passed"));
    }

  } catch (error) {
    spinner.fail("Review failed");
    console.error(chalk.red(error instanceof Error ? error.message : "Unknown error"));
    process.exit(1);
  }
}
