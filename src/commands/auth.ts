import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import inquirer from "inquirer";
import open from "open";
import http from "http";
import { URL } from "url";
import { loadConfig, saveConfig, getApiUrl } from "../utils/config.js";

interface AuthUser {
  id: string;
  email: string;
  name?: string;
  subscription_tier?: string;
}

export const authCommand = new Command("auth")
  .description("Manage authentication with DataChonk");

// Login command
authCommand
  .command("login")
  .description("Authenticate with DataChonk")
  .option("--api-key <key>", "Use an API key directly instead of browser auth")
  .action(async (options) => {
    if (options.apiKey) {
      // Direct API key authentication
      const spinner = ora("Validating API key...").start();
      
      try {
        const apiUrl = getApiUrl();
        const response = await fetch(`${apiUrl}/api/cli/auth/validate`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${options.apiKey}`,
          },
        });

        if (!response.ok) {
          spinner.fail("Invalid API key");
          process.exit(1);
        }

        const data = await response.json() as { user: AuthUser };
        
        // Save API key to config
        const config = loadConfig();
        config.ai.apiKey = options.apiKey;
        config.ai.enabled = true;
        saveConfig(config);

        spinner.succeed("Logged in successfully!");
        console.log(chalk.gray(`\n  Logged in as: ${data.user.email}`));
        console.log(chalk.gray(`  Subscription: ${data.user.subscription_tier || "free"}`));
      } catch (error) {
        spinner.fail("Authentication failed");
        console.error(chalk.red(error instanceof Error ? error.message : "Unknown error"));
        process.exit(1);
      }
      return;
    }

    // Browser-based authentication
    console.log(chalk.cyan.bold("\n  DataChonk Login\n"));
    
    const apiUrl = getApiUrl();
    const callbackPort = 9876;
    const callbackUrl = `http://localhost:${callbackPort}/callback`;
    
    // Create a one-time auth session
    const spinner = ora("Preparing authentication...").start();
    
    try {
      const sessionResponse = await fetch(`${apiUrl}/api/cli/auth/session`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ callbackUrl }),
      });

      if (!sessionResponse.ok) {
        throw new Error("Failed to create auth session");
      }

      const { sessionId, authUrl } = await sessionResponse.json() as { sessionId: string; authUrl: string };
      spinner.stop();

      console.log(chalk.gray("Opening browser for authentication...\n"));
      
      // Start local callback server
      const apiKey = await new Promise<string>((resolve, reject) => {
        const server = http.createServer((req, res) => {
          const url = new URL(req.url || "", `http://localhost:${callbackPort}`);
          
          if (url.pathname === "/callback") {
            const token = url.searchParams.get("token");
            const error = url.searchParams.get("error");

            if (error) {
              res.writeHead(200, { "Content-Type": "text/html" });
              res.end(`
                <html>
                  <body style="font-family: system-ui; text-align: center; padding: 50px;">
                    <h1 style="color: #ef4444;">Authentication Failed</h1>
                    <p>${error}</p>
                    <p>You can close this window.</p>
                  </body>
                </html>
              `);
              server.close();
              reject(new Error(error));
              return;
            }

            if (token) {
              res.writeHead(200, { "Content-Type": "text/html" });
              res.end(`
                <html>
                  <body style="font-family: system-ui; text-align: center; padding: 50px; background: #0a0a0a; color: white;">
                    <h1 style="color: #E8A54B;">Authentication Successful!</h1>
                    <p>You can close this window and return to the CLI.</p>
                  </body>
                </html>
              `);
              server.close();
              resolve(token);
            }
          }
        });

        server.listen(callbackPort, () => {
          // Open browser to auth URL
          open(authUrl).catch(() => {
            console.log(chalk.yellow(`\nCouldn't open browser. Please visit:\n${authUrl}\n`));
          });
        });

        // Timeout after 5 minutes
        setTimeout(() => {
          server.close();
          reject(new Error("Authentication timed out"));
        }, 5 * 60 * 1000);
      });

      // Save API key
      const config = loadConfig();
      config.ai.apiKey = apiKey;
      config.ai.enabled = true;
      saveConfig(config);

      // Fetch user info
      const userResponse = await fetch(`${apiUrl}/api/cli/auth/me`, {
        headers: { "Authorization": `Bearer ${apiKey}` },
      });
      
      if (userResponse.ok) {
        const userData = await userResponse.json() as { user: AuthUser };
        console.log(chalk.green("\nLogged in successfully!"));
        console.log(chalk.gray(`  Email: ${userData.user.email}`));
        console.log(chalk.gray(`  Plan: ${userData.user.subscription_tier || "free"}`));
      } else {
        console.log(chalk.green("\nLogged in successfully!"));
      }

    } catch (error) {
      spinner.fail("Authentication failed");
      console.error(chalk.red(error instanceof Error ? error.message : "Unknown error"));
      process.exit(1);
    }
  });

// Logout command
authCommand
  .command("logout")
  .description("Log out of DataChonk")
  .action(async () => {
    const config = loadConfig();
    
    if (!config.ai.apiKey) {
      console.log(chalk.yellow("You are not logged in."));
      return;
    }

    const { confirm } = await inquirer.prompt([
      {
        type: "confirm",
        name: "confirm",
        message: "Are you sure you want to log out?",
        default: true,
      },
    ]);

    if (!confirm) return;

    // Revoke API key on server
    const apiUrl = getApiUrl();
    try {
      await fetch(`${apiUrl}/api/cli/auth/revoke`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${config.ai.apiKey}`,
        },
      });
    } catch {
      // Ignore server errors during logout
    }

    // Clear local config
    config.ai.apiKey = null;
    config.ai.enabled = false;
    saveConfig(config);

    console.log(chalk.green("Logged out successfully."));
  });

// Who am I command
authCommand
  .command("whoami")
  .description("Show current authenticated user")
  .action(async () => {
    const config = loadConfig();
    
    if (!config.ai.apiKey) {
      console.log(chalk.yellow("Not logged in. Run: datachonk auth login"));
      return;
    }

    const spinner = ora("Fetching user info...").start();
    
    try {
      const apiUrl = getApiUrl();
      const response = await fetch(`${apiUrl}/api/cli/auth/me`, {
        headers: { "Authorization": `Bearer ${config.ai.apiKey}` },
      });

      if (!response.ok) {
        spinner.fail("Session expired or invalid");
        console.log(chalk.yellow("Run: datachonk auth login"));
        return;
      }

      const data = await response.json() as { user: AuthUser; usage?: { projects: number; aiRequests: number } };
      spinner.stop();

      console.log(chalk.bold("\n  DataChonk Account\n"));
      console.log(chalk.gray("  ─".repeat(20)));
      console.log(`  ${chalk.gray("Email:")}      ${data.user.email}`);
      console.log(`  ${chalk.gray("Name:")}       ${data.user.name || "Not set"}`);
      console.log(`  ${chalk.gray("Plan:")}       ${chalk.cyan(data.user.subscription_tier || "free")}`);
      
      if (data.usage) {
        console.log(chalk.gray("\n  Usage This Month:"));
        console.log(`  ${chalk.gray("Projects:")}   ${data.usage.projects}`);
        console.log(`  ${chalk.gray("AI Requests:")} ${data.usage.aiRequests}`);
      }
      console.log();

    } catch (error) {
      spinner.fail("Failed to fetch user info");
      console.error(chalk.red(error instanceof Error ? error.message : "Unknown error"));
    }
  });

// Token/API Key management
authCommand
  .command("token")
  .description("Manage API tokens")
  .argument("<action>", "Action: show | create | revoke")
  .action(async (action) => {
    const config = loadConfig();

    switch (action) {
      case "show": {
        if (!config.ai.apiKey) {
          console.log(chalk.yellow("No API key configured."));
          return;
        }
        // Only show partial key for security
        const key = config.ai.apiKey;
        const masked = key.substring(0, 8) + "..." + key.substring(key.length - 4);
        console.log(chalk.gray(`API Key: ${masked}`));
        break;
      }

      case "create": {
        if (!config.ai.apiKey) {
          console.log(chalk.yellow("Login first: datachonk auth login"));
          return;
        }

        const { name } = await inquirer.prompt([
          {
            type: "input",
            name: "name",
            message: "Token name (for your reference):",
            default: `cli-${new Date().toISOString().split("T")[0]}`,
          },
        ]);

        const spinner = ora("Creating API token...").start();
        
        try {
          const apiUrl = getApiUrl();
          const response = await fetch(`${apiUrl}/api/cli/auth/token`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${config.ai.apiKey}`,
            },
            body: JSON.stringify({ name }),
          });

          if (!response.ok) {
            throw new Error("Failed to create token");
          }

          const data = await response.json() as { token: string };
          spinner.succeed("Token created!");
          
          console.log(chalk.yellow("\nStore this token securely - it won't be shown again:\n"));
          console.log(chalk.cyan(data.token));
          console.log();
        } catch (error) {
          spinner.fail("Failed to create token");
          console.error(chalk.red(error instanceof Error ? error.message : "Unknown error"));
        }
        break;
      }

      case "revoke": {
        console.log(chalk.yellow("To revoke tokens, visit: https://datachonk.dev/app/settings/tokens"));
        break;
      }

      default:
        console.log(chalk.red(`Unknown action: ${action}`));
        console.log(chalk.gray("Valid actions: show, create, revoke"));
    }
  });
