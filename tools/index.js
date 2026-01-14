/**
 * Agent Tools Index
 * 
 * Main entry point for the tool system. Exports the registry and all tools.
 * 
 * ADDING NEW TOOLS:
 * 1. Create a new file in /tools (e.g., mytools.js)
 * 2. Extend BaseTool and implement execute()
 * 3. Export your tool class
 * 4. Import and register it in this file
 * 
 * Example:
 *   const { MyNewTool } = require('./mytools');
 *   registry.register(new MyNewTool());
 */

const { BaseTool, ToolResult } = require('./base');
const { ToolRegistry, registry } = require('./registry');

// Import all tool modules
const {
  RunCommandTool,
  BackgroundCommandTool,
  KillProcessTool
} = require('./shell');

const {
  ReadFileTool,
  WriteFileTool,
  EditFileTool,
  ListDirectoryTool,
  SearchFilesTool,
  DeleteTool
} = require('./filesystem');

const {
  initElectronModules,
  OpenUrlTool,
  OpenPathTool,
  ClipboardReadTool,
  ClipboardWriteTool,
  SystemInfoTool,
  EnvVarTool,
  WaitTool
} = require('./system');

const {
  ConvertImageTool
} = require('./image');

/**
 * Initialize and register all tools
 * Call this once when the application starts
 * 
 * @param {Object} options - Initialization options
 * @param {Object} options.electron - Electron modules (clipboard, shell)
 */
function initializeTools(options = {}) {
  // Initialize Electron modules for system tools
  if (options.electron) {
    initElectronModules(
      options.electron.clipboard,
      options.electron.shell
    );
  }

  // ===== SHELL TOOLS =====
  registry.register(new RunCommandTool());
  registry.register(new BackgroundCommandTool());
  registry.register(new KillProcessTool());

  // ===== FILESYSTEM TOOLS =====
  registry.register(new ReadFileTool());
  registry.register(new WriteFileTool());
  registry.register(new EditFileTool());
  registry.register(new ListDirectoryTool());
  registry.register(new SearchFilesTool());
  registry.register(new DeleteTool());

  // ===== SYSTEM TOOLS =====
  registry.register(new OpenUrlTool());
  registry.register(new OpenPathTool());
  registry.register(new ClipboardReadTool());
  registry.register(new ClipboardWriteTool());
  registry.register(new SystemInfoTool());
  registry.register(new EnvVarTool());
  registry.register(new WaitTool());

  // ===== IMAGE TOOLS =====
  registry.register(new ConvertImageTool());

  console.log(`Initialized ${registry.getAll().length} tools across ${registry.getCategories().length} categories`);
  console.log('Categories:', registry.getCategories().join(', '));
  console.log('Tools:', registry.getToolNames().join(', '));

  return registry;
}

/**
 * Quick helper to execute a tool by name
 * @param {string} toolName - Name of the tool
 * @param {Object} params - Tool parameters
 * @param {Object} context - Execution context
 */
async function executeTool(toolName, params, context = {}) {
  return registry.execute(toolName, params, context);
}

/**
 * Get tool documentation for system prompt
 */
function getToolDocumentation() {
  return registry.generateDocumentation();
}

/**
 * Get tool schemas for native function calling
 */
function getToolSchemas() {
  return registry.getSchemas();
}

/**
 * Parse a tool call from the LLM response
 * Supports multiple formats:
 * 1. ```tool_call { ... } ```
 * 2. ```json { "tool": "...", ... } ```
 * 3. Native function call format from OpenRouter
 * 
 * @param {string} message - The LLM response message
 * @returns {Object|null} - Parsed tool call or null
 */
function parseToolCall(message) {
  if (!message || typeof message !== 'string') return null;

  let toolCallData = null;
  let matchIndex = 0;
  let matchLength = 0;

  // Format 1: ```tool_call { ... } ```
  const toolCallBlockMatch = message.match(/```tool_call\s*\n?([\s\S]*?)```/);
  if (toolCallBlockMatch) {
    try {
      toolCallData = JSON.parse(toolCallBlockMatch[1].trim());
      matchIndex = toolCallBlockMatch.index;
      matchLength = toolCallBlockMatch[0].length;
    } catch (e) {
      console.warn('Failed to parse tool_call block:', e.message);
    }
  }

  // Format 2: ```json { "tool": "...", ... } ```
  if (!toolCallData) {
    const jsonBlockMatch = message.match(/```(?:json)?\s*\n?(\{\s*"tool"\s*:[\s\S]*?\})\s*```/);
    if (jsonBlockMatch) {
      try {
        toolCallData = JSON.parse(jsonBlockMatch[1].trim());
        matchIndex = jsonBlockMatch.index;
        matchLength = jsonBlockMatch[0].length;
      } catch (e) {
        console.warn('Failed to parse json block:', e.message);
      }
    }
  }

  // Format 3: Plain JSON object { "tool": "...", "param": "..." }
  if (!toolCallData) {
    const plainJsonMatch = message.match(/\{\s*"tool"\s*:\s*"([^"]+)"[\s\S]*?\}/);
    if (plainJsonMatch) {
      try {
        toolCallData = JSON.parse(plainJsonMatch[0]);
        matchIndex = plainJsonMatch.index;
        matchLength = plainJsonMatch[0].length;
      } catch (e) {
        console.warn('Failed to parse plain JSON:', e.message);
      }
    }
  }

  if (!toolCallData || !toolCallData.tool) {
    return null;
  }

  // Extract the tool name and parameters
  const { tool, ...params } = toolCallData;

  return {
    tool,
    params,
    textBefore: message.substring(0, matchIndex).trim(),
    textAfter: message.substring(matchIndex + matchLength).trim(),
    raw: toolCallData
  };
}

/**
 * Format tool result for LLM conversation (LEGACY - verbose)
 * @param {string} toolName - Name of the tool that was executed
 * @param {ToolResult} result - The tool execution result
 * @returns {string} - Formatted message for the LLM
 */
function formatToolResultVerbose(toolName, result) {
  const statusIcon = result.success ? '✓' : '✗';
  const status = result.success ? 'completed successfully' : 'failed';

  let message = `**Tool Execution Result** (${toolName} ${statusIcon} ${status})\n\n`;

  if (result.success) {
    message += '```\n' + result.output.substring(0, 15000);
    if (result.output.length > 15000) {
      message += '\n... [output truncated]';
    }
    message += '\n```';
  } else {
    message += `**Error:** ${result.error}\n`;
    if (result.output) {
      message += '\n**Output:**\n```\n' + result.output.substring(0, 5000) + '\n```';
    }
  }

  message += '\n\nAnalyze this result and continue assisting the user.';

  return message;
}

/**
 * Format tool result compactly with iteration context
 * - Includes step progress (e.g., "step 3/15")
 * - Aggressive output truncation (2KB default, 500B for errors)
 * - Single error location (no duplication)
 * @param {string} toolName - Name of the tool that was executed
 * @param {ToolResult} result - The tool execution result
 * @param {Object} options - Formatting options
 * @param {number} options.maxOutput - Max output length (default: 2000)
 * @param {number} options.maxError - Max error output length (default: 500)
 * @param {number} options.iteration - Current iteration number (optional)
 * @param {number} options.maxIterations - Max iterations allowed (optional)
 * @returns {string}
 */
function formatToolResult(toolName, result, options = {}) {
  const { maxOutput = 2000, maxError = 500, iteration = 0, maxIterations = 15 } = options;

  // Build header with optional iteration context
  let header = `[${toolName} ${result.success ? '✓' : '✗'}]`;
  if (iteration > 0) {
    header += ` (step ${iteration}/${maxIterations})`;
  }

  if (result.success) {
    // Compact success format
    let output = result.output;
    if (output.length > maxOutput) {
      output = output.substring(0, maxOutput) + `\n[...truncated ${output.length - maxOutput} chars]`;
    }
    return `${header}\n\`\`\`\n${output}\n\`\`\``;
  } else {
    // Compact error format - single location, no duplication
    let msg = `${header} ${result.error}`;

    // Only add output if it contains NEW information not in the error
    if (result.output && !result.error.includes(result.output.substring(0, 50))) {
      const truncatedOutput = result.output.length > maxError
        ? result.output.substring(0, maxError) + '...'
        : result.output;
      msg += `\n\`\`\`\n${truncatedOutput}\n\`\`\``;
    }
    return msg;
  }
}

/**
 * Get compact tool documentation for system prompt (recommended)
 */
function getCompactToolDocumentation() {
  return registry.generateCompactDocumentation();
}

// Export everything
module.exports = {
  // Core classes
  BaseTool,
  ToolResult,
  ToolRegistry,

  // Singleton registry
  registry,

  // Initialization
  initializeTools,

  // Helper functions
  executeTool,
  getToolDocumentation,         // Legacy verbose docs
  getCompactToolDocumentation,  // Recommended compact docs (90% smaller)
  getToolSchemas,
  parseToolCall,
  formatToolResult,             // Now uses compact format by default
  formatToolResultVerbose,      // Legacy verbose format

  // Individual tool classes (for extension or testing)
  tools: {
    shell: { RunCommandTool, BackgroundCommandTool, KillProcessTool },
    filesystem: { ReadFileTool, WriteFileTool, EditFileTool, ListDirectoryTool, SearchFilesTool, DeleteTool },
    system: { OpenUrlTool, OpenPathTool, ClipboardReadTool, ClipboardWriteTool, SystemInfoTool, EnvVarTool, WaitTool },
    image: { ConvertImageTool }
  }
};
