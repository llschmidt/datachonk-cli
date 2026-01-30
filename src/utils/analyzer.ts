export interface Issue {
  pattern: string;
  severity: "critical" | "high" | "medium" | "low";
  location: string;
  fix: string;
  explanation: string;
  line?: number;
}

export interface ParsedModel {
  name: string;
  type: "staging" | "intermediate" | "fact" | "dimension" | "snapshot" | "unknown";
  materialization: string | null;
  config: Record<string, unknown>;
  refs: string[];
  sources: Array<{ schema: string; table: string }>;
  columns: string[];
  hasTests: boolean;
  cteCount: number;
  lineCount: number;
}

export function parseModel(content: string, fileName: string): ParsedModel {
  const sqlLower = content.toLowerCase();
  
  // Determine type from file name
  let type: ParsedModel["type"] = "unknown";
  if (fileName.startsWith("stg_")) type = "staging";
  else if (fileName.startsWith("int_")) type = "intermediate";
  else if (fileName.startsWith("fct_")) type = "fact";
  else if (fileName.startsWith("dim_")) type = "dimension";
  else if (fileName.includes("snapshot")) type = "snapshot";

  // Extract config
  const configMatch = content.match(/\{\{\s*config\s*\(([\s\S]*?)\)\s*\}\}/);
  let config: Record<string, unknown> = {};
  let materialization: string | null = null;
  
  if (configMatch) {
    const configStr = configMatch[1];
    const matMatch = configStr.match(/materialized\s*=\s*['"](\w+)['"]/);
    if (matMatch) materialization = matMatch[1];
    
    // Parse other config options
    const kvPairs = configStr.matchAll(/(\w+)\s*=\s*(['"]([^'"]+)['"]|(\w+))/g);
    for (const match of kvPairs) {
      config[match[1]] = match[3] || match[4];
    }
  }

  // Extract refs
  const refs: string[] = [];
  const refMatches = content.matchAll(/\{\{\s*ref\(['"]([^'"]+)['"]\)\s*\}\}/g);
  for (const match of refMatches) {
    refs.push(match[1]);
  }

  // Extract sources
  const sources: Array<{ schema: string; table: string }> = [];
  const sourceMatches = content.matchAll(/\{\{\s*source\(['"]([^'"]+)['"],\s*['"]([^'"]+)['"]\)\s*\}\}/g);
  for (const match of sourceMatches) {
    sources.push({ schema: match[1], table: match[2] });
  }

  // Count CTEs
  const cteCount = (content.match(/\bwith\b/gi) || []).length + 
                   (content.match(/\),\s*\w+\s+as\s*\(/gi) || []).length;

  // Extract columns from final SELECT
  const columns: string[] = [];
  const selectMatch = content.match(/select\s+([\s\S]+?)\s+from/i);
  if (selectMatch && !selectMatch[1].includes("*")) {
    const columnPatterns = selectMatch[1].split(/,(?![^(]*\))/);
    for (const pattern of columnPatterns) {
      const aliasMatch = pattern.trim().match(/(?:as\s+)?(\w+)\s*$/i);
      if (aliasMatch) columns.push(aliasMatch[1]);
    }
  }

  return {
    name: fileName,
    type,
    materialization,
    config,
    refs,
    sources,
    columns,
    hasTests: false, // Determined externally
    cteCount,
    lineCount: content.split("\n").length,
  };
}

export function detectAntiPatterns(model: ParsedModel, warehouse: string): Issue[] {
  const issues: Issue[] = [];
  
  // This would analyze based on the model structure
  // For now, we'll use simple pattern matching on the original content
  // In a real implementation, we'd pass the content as well
  
  return issues;
}

export function detectAntiPatternsFromContent(
  content: string,
  model: ParsedModel,
  warehouse: string
): Issue[] {
  const issues: Issue[] = [];
  const sqlLower = content.toLowerCase();
  const lines = content.split("\n");

  // SELECT *
  if (sqlLower.includes("select *") && !sqlLower.includes("select * from (")) {
    const lineNum = lines.findIndex(l => l.toLowerCase().includes("select *")) + 1;
    issues.push({
      pattern: "SELECT * in production",
      severity: "high",
      location: `Line ${lineNum}`,
      fix: "List specific columns needed",
      explanation: "SELECT * is fragile (breaks when source adds columns), expensive (transfers unnecessary data), and hides dependencies.",
      line: lineNum,
    });
  }

  // Business logic in staging
  if (model.type === "staging") {
    if (sqlLower.includes(" join ") && !sqlLower.includes("deduplication")) {
      const lineNum = lines.findIndex(l => l.toLowerCase().includes(" join ")) + 1;
      issues.push({
        pattern: "Join in staging model",
        severity: "medium",
        location: `Line ${lineNum}`,
        fix: "Move joins to intermediate or mart layer",
        explanation: "Staging should be 1:1 with source. Joins belong in intermediate models where business logic lives.",
        line: lineNum,
      });
    }
    
    if (model.refs.length > 0) {
      issues.push({
        pattern: "ref() in staging model",
        severity: "high",
        location: "Model references",
        fix: "Use source() instead of ref() in staging models",
        explanation: "Staging models should only reference sources, not other models.",
      });
    }
  }

  // Missing incremental config
  if (sqlLower.includes("is_incremental()") && !model.config.unique_key) {
    issues.push({
      pattern: "Incremental without unique_key",
      severity: "critical",
      location: "Config block",
      fix: "Add unique_key to config for merge/delete+insert strategies",
      explanation: "Without unique_key, merge strategy won't work correctly and you'll accumulate duplicates.",
    });
  }

  // Unbounded incremental
  if (sqlLower.includes("is_incremental()")) {
    const hasUpperBound = sqlLower.includes("< current") || 
                          sqlLower.includes("< getdate") || 
                          sqlLower.includes("< now()") ||
                          sqlLower.includes("< sysdate");
    if (!hasUpperBound) {
      issues.push({
        pattern: "Unbounded incremental filter",
        severity: "medium",
        location: "Incremental WHERE clause",
        fix: "Add upper bound: AND updated_at < current_timestamp()",
        explanation: "Future-dated rows will be processed repeatedly without an upper bound.",
      });
    }
  }

  // Hardcoded dates
  const hardcodedDateMatch = content.match(/'(20\d{2}-\d{2}-\d{2})'/);
  if (hardcodedDateMatch) {
    const lineNum = lines.findIndex(l => l.includes(hardcodedDateMatch[0])) + 1;
    issues.push({
      pattern: "Hardcoded date literal",
      severity: "medium",
      location: `Line ${lineNum}: ${hardcodedDateMatch[0]}`,
      fix: "Use var() or dbt_date macros",
      explanation: "Hardcoded dates require manual updates and differ between environments.",
      line: lineNum,
    });
  }

  // DISTINCT after JOIN
  if (sqlLower.includes("select distinct") && sqlLower.includes(" join ")) {
    issues.push({
      pattern: "DISTINCT after JOIN (possible fan-out fix)",
      severity: "high",
      location: "SELECT DISTINCT with JOIN",
      fix: "Fix the join condition or deduplicate upstream",
      explanation: "DISTINCT after JOIN often masks a fan-out problem. Fix the root cause instead.",
    });
  }

  // Cross join or Cartesian product
  if (sqlLower.includes("cross join")) {
    const lineNum = lines.findIndex(l => l.toLowerCase().includes("cross join")) + 1;
    issues.push({
      pattern: "CROSS JOIN detected",
      severity: "critical",
      location: `Line ${lineNum}`,
      fix: "Ensure CROSS JOIN is intentional; consider alternatives",
      explanation: "CROSS JOINs create Cartesian products. Even small tables (1K x 1K = 1M rows) can explode.",
      line: lineNum,
    });
  }

  // Function on filter columns
  const funcOnFilterMatch = sqlLower.match(/where\s+(\w+)\(.*?\)\s*=/i) ||
                            sqlLower.match(/on\s+(\w+)\(.*?\)\s*=/i);
  if (funcOnFilterMatch) {
    issues.push({
      pattern: "Function on filter/join column",
      severity: "high",
      location: "WHERE/ON clause",
      fix: "Move transformation to other side of comparison or materialize",
      explanation: "Functions on filter columns prevent partition pruning and index usage.",
    });
  }

  // Warehouse-specific checks
  if (warehouse === "snowflake") {
    // Check for non-deterministic functions without proper handling
    if (sqlLower.includes("uuid_string()") && model.materialization === "view") {
      issues.push({
        pattern: "Non-deterministic function in view",
        severity: "medium",
        location: "UUID generation",
        fix: "Materialize as table or use consistent key generation",
        explanation: "UUID_STRING() in views generates new values on each query.",
      });
    }
  }

  if (warehouse === "bigquery") {
    // Check for LIMIT without ORDER BY
    if (sqlLower.includes("limit") && !sqlLower.includes("order by")) {
      issues.push({
        pattern: "LIMIT without ORDER BY",
        severity: "medium",
        location: "LIMIT clause",
        fix: "Add ORDER BY for deterministic results",
        explanation: "BigQuery doesn't guarantee row order without ORDER BY.",
      });
    }
  }

  // Large CTE count
  if (model.cteCount > 7) {
    issues.push({
      pattern: "High CTE count",
      severity: "low",
      location: `${model.cteCount} CTEs detected`,
      fix: "Consider breaking into separate intermediate models",
      explanation: "Many CTEs can be hard to maintain and debug. Consider refactoring.",
    });
  }

  return issues;
}

export function reviewCode(
  model: ParsedModel,
  content: string,
  warehouse: string,
  strict = false
): {
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
} {
  const strengths: string[] = [];
  const issues: Array<{
    severity: string;
    title: string;
    description: string;
    suggestion: string;
    line?: number;
  }> = [];
  
  let score = 100;
  const sqlLower = content.toLowerCase();

  // Check for good patterns (add points)
  if (content.includes("config(")) {
    strengths.push("Uses config block for model configuration");
  }
  
  if (content.includes("-- ") || content.includes("/*")) {
    strengths.push("Code includes comments");
  }
  
  if (sqlLower.includes("coalesce") || sqlLower.includes("ifnull") || sqlLower.includes("nvl")) {
    strengths.push("Handles null values appropriately");
  }
  
  if (model.materialization === "incremental") {
    strengths.push("Uses incremental materialization for efficiency");
  }

  if (model.cteCount > 0 && model.cteCount <= 5) {
    strengths.push("Uses CTEs for readable organization");
  }

  // Detect anti-patterns
  const antiPatterns = detectAntiPatternsFromContent(content, model, warehouse);
  
  for (const ap of antiPatterns) {
    issues.push({
      severity: ap.severity,
      title: ap.pattern,
      description: ap.explanation,
      suggestion: ap.fix,
      line: ap.line,
    });

    // Deduct points based on severity
    switch (ap.severity) {
      case "critical": score -= 25; break;
      case "high": score -= 15; break;
      case "medium": score -= 10; break;
      case "low": score -= 5; break;
    }
  }

  // Additional strict checks
  if (strict) {
    // Check for missing descriptions
    if (!content.includes("description")) {
      issues.push({
        severity: "low",
        title: "Missing model description",
        description: "Model has no description in config or YAML",
        suggestion: "Add a description explaining the model's purpose",
      });
      score -= 5;
    }

    // Check for consistent naming
    if (model.type !== "unknown" && !model.name.startsWith(model.type.slice(0, 3) + "_")) {
      issues.push({
        severity: "low",
        title: "Inconsistent naming convention",
        description: `Model type appears to be ${model.type} but name doesn't follow convention`,
        suggestion: `Rename to ${model.type.slice(0, 3)}_${model.name}`,
      });
      score -= 5;
    }
  }

  // Ensure score is within bounds
  score = Math.max(0, Math.min(100, score));

  // Determine overall verdict
  let overall: "approve" | "request_changes" | "comment" = "approve";
  if (issues.some(i => i.severity === "critical")) {
    overall = "request_changes";
  } else if (issues.some(i => i.severity === "high")) {
    overall = strict ? "request_changes" : "comment";
  } else if (issues.length > 0) {
    overall = "comment";
  }

  return { score, overall, strengths, issues };
}
