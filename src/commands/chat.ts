import { Command } from "commander";
import chalk from "chalk";
import ora from "ora";
import * as readline from "readline";
import { readdirSync, readFileSync, statSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { loadConfig, getApiUrl } from "../utils/config.js";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface SlashCommand {
  name: string;
  description: string;
  handler: (args: string, context: ChatContext) => Promise<string | null>;
}

interface ChatContext {
  messages: Message[];
  projectPath?: string;
  projectId?: string;
  currentFile?: string;
  warehouse?: string;
}

// Slash commands for enhanced functionality
const slashCommands: SlashCommand[] = [
  {
    name: "help",
    description: "Show available commands",
    handler: async () => {
      return `
${chalk.bold("Available Commands:")}
  ${chalk.cyan("/help")}              Show this help message
  ${chalk.cyan("/clear")}             Clear conversation history
  ${chalk.cyan("/context <path>")}    Load a file or directory as context
  ${chalk.cyan("/generate <type>")}   Generate dbt code (staging, intermediate, mart, test)
  ${chalk.cyan("/review <file>")}     Get a code review of a file
  ${chalk.cyan("/explain <file>")}    Explain what a model does
  ${chalk.cyan("/optimize <file>")}   Get optimization suggestions
  ${chalk.cyan("/test <model>")}      Generate tests for a model
  ${chalk.cyan("/docs <model>")}      Generate documentation
  ${chalk.cyan("/save <file>")}       Save the last code block to a file
  ${chalk.cyan("/export")}            Export conversation to markdown
  ${chalk.cyan("/exit")}              Exit chat
`;
    },
  },
  {
    name: "clear",
    description: "Clear conversation history",
    handler: async (_, ctx) => {
      ctx.messages.length = 0;
      return chalk.green("Conversation cleared.");
    },
  },
  {
    name: "context",
    description: "Load context from a file or directory",
    handler: async (args, ctx) => {
      const path = args.trim() || ".";
      try {
        const stat = statSync(path);
        let content = "";
        
        if (stat.isDirectory()) {
          const files = readdirSync(path).filter(f => 
            f.endsWith(".sql") || f.endsWith(".yml") || f.endsWith(".yaml")
          );
          for (const file of files.slice(0, 10)) {
            const fileContent = readFileSync(join(path, file), "utf-8");
            content += `\n--- ${file} ---\n${fileContent}\n`;
          }
          ctx.projectPath = path;
        } else {
          content = readFileSync(path, "utf-8");
          ctx.currentFile = path;
        }
        
        ctx.messages.push({
          role: "user",
          content: `Here is context from ${path}:\n\n${content}\n\nPlease keep this in mind.`,
        });
        ctx.messages.push({
          role: "assistant",
          content: "I've loaded the context. How can I help?",
        });
        
        return chalk.green(`Loaded context from ${path}`);
      } catch (error) {
        return chalk.red(`Failed to load context: ${error instanceof Error ? error.message : "Unknown error"}`);
      }
    },
  },
  {
    name: "save",
    description: "Save the last code block to a file",
    handler: async (args, ctx) => {
      const filePath = args.trim();
      if (!filePath) {
        return chalk.red("Usage: /save <file-path>");
      }
      
      // Find last code block in assistant messages
      for (let i = ctx.messages.length - 1; i >= 0; i--) {
        const msg = ctx.messages[i];
        if (msg.role === "assistant") {
          const codeMatch = msg.content.match(/```(?:\w+)?\n([\s\S]*?)```/);
          if (codeMatch) {
            const code = codeMatch[1];
            const dir = dirname(filePath);
            if (!existsSync(dir)) {
              mkdirSync(dir, { recursive: true });
            }
            writeFileSync(filePath, code);
            return chalk.green(`Saved to ${filePath}`);
          }
        }
      }
      return chalk.yellow("No code block found in recent messages.");
    },
  },
  {
    name: "export",
    description: "Export conversation to markdown",
    handler: async (args, ctx) => {
      const filePath = args.trim() || `datachonk-chat-${Date.now()}.md`;
      let markdown = "# DataChonk Chat Export\n\n";
      markdown += `_Exported: ${new Date().toISOString()}_\n\n---\n\n`;
      
      for (const msg of ctx.messages) {
        if (msg.role === "user") {
          markdown += `## You\n\n${msg.content}\n\n`;
        } else {
          markdown += `## Chonk\n\n${msg.content}\n\n`;
        }
      }
      
      writeFileSync(filePath, markdown);
      return chalk.green(`Exported to ${filePath}`);
    },
  },
];

export const chatCommand = new Command("chat")
  .description("Interactive AI chat with Chonk - your dbt expert")
  .option("-c, --context <path>", "Include a file or directory as context")
  .option("-p, --project <id>", "Use a specific DataChonk project for context")
  .option("-s, --stream", "Enable streaming responses", true)
  .option("--no-stream", "Disable streaming responses")
  .action(async (options) => {
    const config = loadConfig();
    const apiKey = config.ai?.apiKey || process.env.DATACHONK_API_KEY;

    if (!apiKey) {
      console.log(chalk.red("No API key found."));
      console.log(chalk.yellow("Run: datachonk auth login"));
      console.log(chalk.yellow("Or: datachonk config set apiKey <your-key>"));
      process.exit(1);
    }

    console.log(chalk.hex("#E8A54B").bold("\n  DataChonk AI Chat"));
    console.log(chalk.gray("  Your expert dbt companion. Type /help for commands.\n"));

    const context: ChatContext = {
      messages: [],
      projectPath: options.context,
      projectId: options.project,
      warehouse: config.warehouse,
    };
    
    // Load context if provided
    if (options.context) {
      const spinner = ora("Loading context...").start();
      try {
        const contextPath = options.context;
        const stat = statSync(contextPath);
        
        let contextContent = "";
        if (stat.isDirectory()) {
          const files = readdirSync(contextPath).filter((f: string) => 
            f.endsWith(".sql") || f.endsWith(".yml") || f.endsWith(".yaml")
          );
          for (const file of files.slice(0, 10)) {
            const content = readFileSync(join(contextPath, file), "utf-8");
            contextContent += `\n--- ${file} ---\n${content}\n`;
          }
        } else {
          contextContent = readFileSync(contextPath, "utf-8");
          context.currentFile = contextPath;
        }
        
        context.messages.push({
          role: "user",
          content: `Here is my dbt project context:\n\n${contextContent}\n\nPlease keep this in mind for our conversation.`
        });
        context.messages.push({
          role: "assistant", 
          content: "I've loaded your dbt project context. I can see your models and configuration. How can I help you today?"
        });
        
        spinner.succeed(`Loaded context from ${options.context}`);
      } catch {
        spinner.fail("Failed to load context");
      }
    }

    // Load project context if provided
    if (options.project) {
      const spinner = ora("Loading project...").start();
      try {
        const apiUrl = getApiUrl();
        const response = await fetch(`${apiUrl}/api/cli/projects/${options.project}`, {
          headers: { "Authorization": `Bearer ${apiKey}` },
        });
        
        if (response.ok) {
          const data = await response.json() as { project: { name: string; warehouse: string }; chonks: Array<{ name: string; type: string }> };
          context.warehouse = data.project.warehouse;
          
          context.messages.push({
            role: "user",
            content: `I'm working on the "${data.project.name}" project (${data.project.warehouse}). It has ${data.chonks?.length || 0} chonks defined.`,
          });
          context.messages.push({
            role: "assistant",
            content: `Great! I'm familiar with your "${data.project.name}" project. How can I help you today?`,
          });
          
          spinner.succeed(`Loaded project: ${data.project.name}`);
        } else {
          spinner.fail("Project not found");
        }
      } catch {
        spinner.fail("Failed to load project");
      }
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    const prompt = () => {
      rl.question(chalk.green("\nYou: "), async (input) => {
        const trimmed = input.trim();
        
        if (trimmed.toLowerCase() === "exit" || trimmed.toLowerCase() === "quit" || trimmed === "/exit") {
          console.log(chalk.hex("#E8A54B")("\nHappy modeling!\n"));
          rl.close();
          return;
        }

        if (!trimmed) {
          prompt();
          return;
        }

        // Handle slash commands
        if (trimmed.startsWith("/")) {
          const [cmd, ...args] = trimmed.slice(1).split(" ");
          const command = slashCommands.find(c => c.name === cmd.toLowerCase());
          
          if (command) {
            const result = await command.handler(args.join(" "), context);
            if (result) {
              console.log(result);
            }
            prompt();
            return;
          } else {
            console.log(chalk.yellow(`Unknown command: /${cmd}. Type /help for available commands.`));
            prompt();
            return;
          }
        }

        context.messages.push({ role: "user", content: trimmed });

        const baseUrl = getApiUrl();

        if (options.stream) {
          // Streaming response
          process.stdout.write(chalk.cyan("\nChonk: "));
          
          try {
            const response = await fetch(`${baseUrl}/api/cli/chat`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`,
              },
              body: JSON.stringify({
                messages: context.messages,
                stream: true,
                context: {
                  projectPath: context.projectPath,
                  projectId: context.projectId,
                  warehouse: context.warehouse,
                  currentFile: context.currentFile,
                },
              }),
            });

            if (!response.ok) {
              throw new Error(`API error: ${response.status}`);
            }

            const reader = response.body?.getReader();
            const decoder = new TextDecoder();
            let fullResponse = "";

            if (reader) {
              while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                
                const chunk = decoder.decode(value, { stream: true });
                fullResponse += chunk;
                process.stdout.write(chunk);
              }
            }

            context.messages.push({ role: "assistant", content: fullResponse });
            console.log(); // New line after streaming
          } catch (error) {
            console.log(chalk.red(`\nError: ${error instanceof Error ? error.message : "Unknown error"}`));
          }
        } else {
          // Non-streaming response
          const spinner = ora("Thinking...").start();

          try {
            const response = await fetch(`${baseUrl}/api/cli/chat`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`,
              },
              body: JSON.stringify({
                messages: context.messages,
                stream: false,
                context: {
                  projectPath: context.projectPath,
                  projectId: context.projectId,
                  warehouse: context.warehouse,
                  currentFile: context.currentFile,
                },
              }),
            });

            if (!response.ok) {
              throw new Error(`API error: ${response.status}`);
            }

            const data = await response.json() as { content?: string; message?: string };
            const assistantMessage = data.content || data.message || "I couldn't generate a response.";
            
            context.messages.push({ role: "assistant", content: assistantMessage });
            
            spinner.stop();
            console.log(chalk.cyan("\nChonk: ") + formatResponse(assistantMessage));
          } catch (error) {
            spinner.fail("Failed to get response");
            console.log(chalk.red(`Error: ${error instanceof Error ? error.message : "Unknown error"}`));
          }
        }

        prompt();
      });
    };

    prompt();
  });

function formatResponse(text: string): string {
  // Format code blocks
  let formatted = text.replace(/```(\w+)?\n([\s\S]*?)```/g, (_, lang, code) => {
    return chalk.gray(`\n--- ${lang || "code"} ---\n`) + 
           chalk.white(code.trim()) + 
           chalk.gray("\n---\n");
  });
  
  // Format inline code
  formatted = formatted.replace(/`([^`]+)`/g, chalk.yellow("$1"));
  
  // Format bold
  formatted = formatted.replace(/\*\*([^*]+)\*\*/g, chalk.bold("$1"));
  
  return formatted;
}
