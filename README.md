# @datachonk/cli

AI-powered dbt expert CLI - analyze, generate, and optimize your dbt projects with Chonk, your data-sniffing corgi.

## Installation

```bash
npm install -g @datachonk/cli
# or
npx @datachonk/cli
```

## Quick Start

```bash
# Login to DataChonk
datachonk auth login

# Initialize DataChonk in your dbt project
cd your-dbt-project
datachonk init

# Chat with Chonk AI
datachonk chat

# Analyze your project for issues
datachonk analyze

# Generate a new staging model
datachonk generate staging --name customers --source raw.stripe.customers
```

## Commands

### Authentication

```bash
datachonk auth login              # Login via browser or API key
datachonk auth logout             # Logout and clear credentials
datachonk auth whoami             # Show current user info
datachonk auth token              # Display current API token
datachonk auth token --create     # Create a new API token
datachonk auth token --revoke     # Revoke current token
```

### Project Management

```bash
datachonk projects list           # List all your projects
datachonk projects create         # Create a new project (interactive)
datachonk projects show <id>      # Show project details
datachonk projects delete <id>    # Delete a project
datachonk projects export <id>    # Export project as ZIP
datachonk projects export <id> --extract ./output  # Extract to folder
datachonk projects clone <id>     # Clone to local dbt project
```

### Sync & Pull

```bash
datachonk sync                    # Sync local dbt project to DataChonk
datachonk sync --project <id>     # Sync to specific project
datachonk sync --watch            # Watch for changes and auto-sync
datachonk pull                    # Pull changes from DataChonk
datachonk pull --project <id>     # Pull from specific project
```

### Status & Dashboard

```bash
datachonk status                  # Show dashboard with usage stats
datachonk open                    # Open web dashboard in browser
datachonk open projects           # Open projects page
datachonk open settings           # Open settings page
datachonk version                 # Show version and check for updates
```

### AI Chat (Chonk)

Interactive AI assistant for dbt help and code generation.

```bash
datachonk chat                    # Start interactive chat
datachonk chat -c ./models        # Include directory as context
datachonk chat -p <project-id>    # Use project context
datachonk chat --no-stream        # Disable streaming responses
```

**Chat Slash Commands:**
- `/help` - Show available commands
- `/clear` - Clear conversation history
- `/context <path>` - Load a file or directory as context
- `/save <file>` - Save the last code block to a file
- `/export` - Export conversation to markdown
- `/exit` - Exit chat

### `datachonk init`

Initialize DataChonk in your dbt project. Creates a `.datachonk.yml` configuration file.

```bash
datachonk init
datachonk init --warehouse snowflake
```

### `datachonk analyze`

Analyze your dbt project for anti-patterns, issues, and optimization opportunities.

```bash
datachonk analyze                    # Analyze entire project
datachonk analyze --model stg_users  # Analyze specific model
datachonk analyze --fix              # Auto-fix issues where possible
datachonk analyze --json             # Output as JSON
datachonk analyze --verbose          # Show all details
```

### `datachonk generate`

Generate dbt models, tests, and documentation.

```bash
datachonk generate staging --name customers --source raw.stripe.customers
datachonk generate intermediate --name customer_orders --source stg_orders
datachonk generate mart --name customer_360 --source int_customer_orders
datachonk generate dim --name customers --source int_customers
datachonk generate fct --name orders --source int_orders
datachonk generate snapshot --name customers --source raw.crm.customers
datachonk generate source --name stripe --source raw.stripe
datachonk generate test --name validate_orders --source fct_orders
datachonk generate docs --name fct_orders
```

Options:
- `--name, -n`: Name for the generated model
- `--source, -s`: Source table or model
- `--output, -o`: Custom output path
- `--dry-run`: Preview without writing files

### `datachonk review`

Get AI-powered code review of your dbt models.

```bash
datachonk review                     # Review staged git changes
datachonk review models/staging/*.sql # Review specific files
datachonk review --strict            # Enable strict mode
datachonk review --json              # Output as JSON
```

### `datachonk scan`

Discover and analyze your data warehouse schema.

```bash
datachonk scan                       # Interactive warehouse scan
datachonk scan --connection <name>   # Use saved connection
datachonk scan --output schema.json  # Export schema to file
```

### `datachonk lineage`

Analyze and visualize model lineage.

```bash
datachonk lineage                    # Show project overview
datachonk lineage fct_orders         # Show lineage for specific model
datachonk lineage fct_orders --upstream    # Show only upstream
datachonk lineage fct_orders --downstream  # Show only downstream
datachonk lineage fct_orders --depth 5     # Limit depth
datachonk lineage --json             # Output as JSON
```

### `datachonk docs`

Generate or enhance dbt documentation.

```bash
datachonk docs                       # Document all models
datachonk docs stg_customers         # Document specific model
datachonk docs --missing-only        # Only document undocumented models
datachonk docs --enhance             # Use AI to improve descriptions
```

### `datachonk test`

Run and manage dbt tests.

```bash
datachonk test                       # Run all tests
datachonk test --model stg_users     # Test specific model
datachonk test --generate            # Generate missing tests
```

### `datachonk migrate`

Convert raw SQL to dbt models.

```bash
datachonk migrate query.sql          # Convert SQL file to dbt
datachonk migrate --interactive      # Interactive migration wizard
```

### `datachonk config`

Manage DataChonk configuration.

```bash
datachonk config list                # Show all configuration
datachonk config get warehouse       # Get specific value
datachonk config set warehouse bigquery  # Set value
datachonk config set apiKey <key>    # Set API key
datachonk config reset               # Reset to defaults
```

## Configuration

DataChonk stores configuration in `.datachonk.yml`:

```yaml
version: 1
warehouse: snowflake
modeling:
  approach: kimball
  conventions:
    - stg_prefix
    - int_prefix
    - fct_prefix
    - dim_prefix
    - snake_case
ai:
  enabled: true
  apiKey: your-api-key
analysis:
  ignorePaths:
    - target/**
    - dbt_packages/**
  ignoreRules: []
generation:
  defaultMaterialization: view
  addDescriptions: true
  addTests: true
```

## CI/CD Integration

### GitHub Actions

```yaml
name: dbt CI

on: [pull_request]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm install -g @datachonk/cli
      - run: datachonk analyze --json > analysis.json
      - run: datachonk review --strict
```

### Pre-commit Hook

Add to `.pre-commit-config.yaml`:

```yaml
repos:
  - repo: local
    hooks:
      - id: datachonk-lint
        name: DataChonk Lint
        entry: datachonk analyze
        language: system
        types: [sql]
        pass_filenames: false
```

## Exit Codes

- `0`: Success / No critical issues
- `1`: Critical issues found / Command failed

## Environment Variables

- `DATACHONK_API_KEY`: API key for AI features (alternative to config file)
- `DATACHONK_API_URL`: Custom API URL (default: https://datachonk.dev)

## License

MIT
