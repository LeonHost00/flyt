/**
 * Tool Registry
 * 
 * Central registry for all agent tools. Handles:
 * - Tool registration and discovery
 * - Tool execution with validation
 * - Schema generation for LLM
 * - Documentation generation for system prompt
 */

const { ToolResult } = require('./base');

class ToolRegistry {
  constructor() {
    this.tools = new Map();
    this.categories = new Map();
    this.executionHistory = [];
    this.maxHistorySize = 100;
  }

  /**
   * Register a tool
   * @param {BaseTool} tool - Tool instance to register
   */
  register(tool) {
    if (this.tools.has(tool.name)) {
      console.warn(`Tool "${tool.name}" is already registered. Overwriting.`);
    }

    this.tools.set(tool.name, tool);

    // Add to category
    if (!this.categories.has(tool.category)) {
      this.categories.set(tool.category, []);
    }
    const categoryTools = this.categories.get(tool.category);
    if (!categoryTools.includes(tool.name)) {
      categoryTools.push(tool.name);
    }

    console.log(`Registered tool: ${tool.name} (${tool.category})`);
  }

  /**
   * Register multiple tools at once
   * @param {BaseTool[]} tools - Array of tools to register
   */
  registerAll(tools) {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  /**
   * Get a tool by name
   * @param {string} name - Tool name
   * @returns {BaseTool|null}
   */
  get(name) {
    return this.tools.get(name) || null;
  }

  /**
   * Check if a tool exists
   * @param {string} name - Tool name
   * @returns {boolean}
   */
  has(name) {
    return this.tools.has(name);
  }

  /**
   * Get all registered tools
   * @returns {BaseTool[]}
   */
  getAll() {
    return Array.from(this.tools.values());
  }

  /**
   * Get all enabled tools
   * @returns {BaseTool[]}
   */
  getEnabled() {
    return this.getAll().filter(tool => tool.enabled);
  }

  /**
   * Get tools by category
   * @param {string} category - Category name
   * @returns {BaseTool[]}
   */
  getByCategory(category) {
    const toolNames = this.categories.get(category) || [];
    return toolNames.map(name => this.tools.get(name)).filter(Boolean);
  }

  /**
   * Get all categories
   * @returns {string[]}
   */
  getCategories() {
    return Array.from(this.categories.keys());
  }

  /**
   * Execute a tool by name with given parameters
   * @param {string} toolName - Name of the tool to execute
   * @param {Object} params - Parameters for the tool
   * @param {Object} context - Execution context
   * @returns {Promise<ToolResult>}
   */
  async execute(toolName, params, context = {}) {
    const tool = this.get(toolName);
    
    if (!tool) {
      return ToolResult.failure(`Unknown tool: "${toolName}". Available tools: ${this.getToolNames().join(', ')}`);
    }

    if (!tool.enabled) {
      return ToolResult.failure(`Tool "${toolName}" is currently disabled.`);
    }

    // Validate parameters
    const validation = tool.validate(params);
    if (!validation.valid) {
      return ToolResult.failure(`Invalid parameters: ${validation.errors.join(', ')}`);
    }

    // Execute with timeout
    const startTime = Date.now();
    let result;

    try {
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error(`Tool execution timed out after ${tool.timeout}ms`)), tool.timeout);
      });

      result = await Promise.race([
        tool.execute(params, context),
        timeoutPromise
      ]);

      // Ensure result is a ToolResult
      if (!(result instanceof ToolResult)) {
        result = ToolResult.success(
          typeof result === 'string' ? result : JSON.stringify(result),
          result
        );
      }

    } catch (error) {
      result = ToolResult.failure(error.message);
    }

    // Record execution
    const execution = {
      toolName,
      params,
      result,
      duration: Date.now() - startTime,
      timestamp: startTime
    };

    this.executionHistory.push(execution);
    if (this.executionHistory.length > this.maxHistorySize) {
      this.executionHistory.shift();
    }

    console.log(`Tool "${toolName}" executed in ${execution.duration}ms - ${result.success ? 'SUCCESS' : 'FAILED'}`);

    return result;
  }

  /**
   * Get tool names
   * @returns {string[]}
   */
  getToolNames() {
    return Array.from(this.tools.keys());
  }

  /**
   * Get schemas for all enabled tools (for LLM function calling)
   * @returns {Object[]}
   */
  getSchemas() {
    return this.getEnabled().map(tool => tool.getSchema());
  }

  /**
   * Generate comprehensive documentation for the system prompt (LEGACY - verbose)
   * @returns {string}
   */
  generateDocumentation() {
    const categories = this.getCategories();
    let doc = `## Available Tools\n\n`;
    doc += `You have access to the following tools. Use them by outputting a JSON block in this format:\n\n`;
    doc += '```tool_call\n{"tool": "tool_name", "param1": "value1", ...}\n```\n\n';
    doc += `**Important Guidelines:**\n`;
    doc += `- Only call ONE tool per response\n`;
    doc += `- Wait for the tool result before proceeding\n`;
    doc += `- Analyze the output and decide if more actions are needed\n`;
    doc += `- If no tool is needed, respond directly to the user\n\n`;

    for (const category of categories.sort()) {
      const tools = this.getByCategory(category).filter(t => t.enabled);
      if (tools.length === 0) continue;

      // Format category name
      const categoryName = category.charAt(0).toUpperCase() + category.slice(1).replace(/_/g, ' ');
      doc += `---\n\n## ${categoryName} Tools\n\n`;

      for (const tool of tools) {
        doc += tool.getDocumentation();
        doc += '\n';
      }
    }

    return doc;
  }

  /**
   * Generate enhanced tool documentation (balanced: informative but not bloated)
   * Includes parameter descriptions and one example per tool
   * @returns {string}
   */
  generateCompactDocumentation() {
    let doc = `## Tools

To use a tool, output a JSON block:

\`\`\`tool_call
{"tool": "tool_name", "param": "value"}
\`\`\`

Call ONE tool at a time. Wait for the result before proceeding.

### Quick Reference
| Tool | Purpose |
|------|---------|
`;
    
    // Build quick reference table
    const allTools = this.getEnabled();
    for (const tool of allTools) {
      const shortDesc = tool.description.split('.')[0];
      doc += `| \`${tool.name}\` | ${shortDesc} |\n`;
    }
    
    doc += `\n---\n\n### Tool Details\n\n`;
    
    const categories = this.getCategories();
    
    for (const category of categories.sort()) {
      const tools = this.getByCategory(category).filter(t => t.enabled);
      if (tools.length === 0) continue;

      const categoryName = category.charAt(0).toUpperCase() + category.slice(1).replace(/_/g, ' ');
      doc += `#### ${categoryName}\n\n`;

      for (const tool of tools) {
        const props = tool.parameters.properties || {};
        const required = tool.parameters.required || [];
        
        // Tool name and full description
        doc += `**${tool.name}** - ${tool.description}\n`;
        
        // Parameters with descriptions
        if (Object.keys(props).length > 0) {
          doc += `Parameters:\n`;
          for (const [name, schema] of Object.entries(props)) {
            const req = required.includes(name) ? ' *(required)*' : '';
            const desc = schema.description || schema.type;
            doc += `- \`${name}\`${req}: ${desc}\n`;
          }
        }
        
        // Add one example if available
        if (tool.examples && tool.examples.length > 0) {
          doc += `Example: \`${JSON.stringify(tool.examples[0])}\`\n`;
        }
        
        doc += '\n';
      }
    }

    return doc;
  }

  /**
   * Get a quick reference of available tools (shorter format)
   * @returns {string}
   */
  getQuickReference() {
    let ref = `**Available Tools:** `;
    const toolDescriptions = this.getEnabled().map(t => `\`${t.name}\``);
    ref += toolDescriptions.join(', ');
    return ref;
  }

  /**
   * Get recent execution history
   * @param {number} limit - Max number of executions to return
   * @returns {Object[]}
   */
  getHistory(limit = 10) {
    return this.executionHistory.slice(-limit);
  }

  /**
   * Clear execution history
   */
  clearHistory() {
    this.executionHistory = [];
  }

  /**
   * Enable a tool
   * @param {string} name - Tool name
   */
  enable(name) {
    const tool = this.get(name);
    if (tool) {
      tool.enabled = true;
    }
  }

  /**
   * Disable a tool
   * @param {string} name - Tool name
   */
  disable(name) {
    const tool = this.get(name);
    if (tool) {
      tool.enabled = false;
    }
  }
}

// Singleton instance
const registry = new ToolRegistry();

module.exports = { ToolRegistry, registry };
