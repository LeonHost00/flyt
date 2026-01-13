/**
 * Base Tool Class
 * 
 * All tools must extend this base class and implement the required methods.
 * This provides a consistent interface for the agent workflow.
 */

class BaseTool {
  /**
   * @param {Object} config - Tool configuration
   * @param {string} config.name - Unique tool identifier (snake_case)
   * @param {string} config.displayName - Human-readable name
   * @param {string} config.description - Brief description for LLM
   * @param {string} config.category - Tool category for organization
   * @param {Object} config.parameters - JSON Schema for parameters
   * @param {Array<string>} config.examples - Usage examples for the LLM
   * @param {boolean} config.requiresConfirmation - Whether dangerous actions need user confirmation
   * @param {number} config.timeout - Default timeout in ms
   */
  constructor(config) {
    this.name = config.name;
    this.displayName = config.displayName || config.name;
    this.description = config.description;
    this.category = config.category || 'general';
    this.parameters = config.parameters || {};
    this.examples = config.examples || [];
    this.requiresConfirmation = config.requiresConfirmation || false;
    this.timeout = config.timeout || 30000;
    this.enabled = true;
  }

  /**
   * Execute the tool with given parameters
   * @param {Object} params - Tool parameters
   * @param {Object} context - Execution context (user, system info, etc.)
   * @returns {Promise<ToolResult>}
   */
  async execute(params, context = {}) {
    throw new Error(`Tool ${this.name} must implement execute()`);
  }

  /**
   * Validate parameters before execution
   * @param {Object} params - Parameters to validate
   * @returns {{ valid: boolean, errors: string[] }}
   */
  validate(params) {
    const errors = [];
    const required = this.parameters.required || [];
    
    for (const param of required) {
      if (params[param] === undefined || params[param] === null) {
        errors.push(`Missing required parameter: ${param}`);
      }
    }

    // Check parameter types if defined
    const properties = this.parameters.properties || {};
    for (const [key, value] of Object.entries(params)) {
      if (properties[key]) {
        const expectedType = properties[key].type;
        const actualType = typeof value;
        
        if (expectedType === 'array' && !Array.isArray(value)) {
          errors.push(`Parameter "${key}" must be an array`);
        } else if (expectedType === 'number' && actualType !== 'number') {
          errors.push(`Parameter "${key}" must be a number`);
        } else if (expectedType === 'boolean' && actualType !== 'boolean') {
          errors.push(`Parameter "${key}" must be a boolean`);
        } else if (expectedType === 'string' && actualType !== 'string') {
          errors.push(`Parameter "${key}" must be a string`);
        }
      }
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Get the tool schema for the LLM (OpenAI/OpenRouter function calling format)
   * @returns {Object}
   */
  getSchema() {
    return {
      type: 'function',
      function: {
        name: this.name,
        description: this.description,
        parameters: {
          type: 'object',
          properties: this.parameters.properties || {},
          required: this.parameters.required || []
        }
      }
    };
  }

  /**
   * Get documentation for the system prompt
   * @returns {string}
   */
  getDocumentation() {
    let doc = `### ${this.displayName} (\`${this.name}\`)\n`;
    doc += `${this.description}\n\n`;

    // Add parameters documentation
    const props = this.parameters.properties || {};
    if (Object.keys(props).length > 0) {
      doc += '**Parameters:**\n';
      for (const [name, schema] of Object.entries(props)) {
        const required = (this.parameters.required || []).includes(name);
        const reqStr = required ? '(required)' : '(optional)';
        doc += `- \`${name}\` ${reqStr}: ${schema.description || schema.type}\n`;
      }
      doc += '\n';
    }

    // Add examples
    if (this.examples.length > 0) {
      doc += '**Examples:**\n';
      for (const example of this.examples) {
        doc += `\`\`\`json\n${JSON.stringify(example, null, 2)}\n\`\`\`\n`;
      }
    }

    if (this.requiresConfirmation) {
      doc += '\n⚠️ *This tool may perform destructive actions. Always confirm with the user first.*\n';
    }

    return doc;
  }
}

/**
 * Standard result format for all tool executions
 */
class ToolResult {
  /**
   * @param {Object} options
   * @param {boolean} options.success - Whether the tool executed successfully
   * @param {*} options.data - The result data
   * @param {string} options.output - Human-readable output for the LLM
   * @param {string} options.error - Error message if failed
   * @param {Object} options.metadata - Additional metadata
   */
  constructor({ success, data = null, output = '', error = null, metadata = {} }) {
    this.success = success;
    this.data = data;
    this.output = output;
    this.error = error;
    this.metadata = metadata;
    this.timestamp = Date.now();
  }

  /**
   * Format the result for the LLM conversation
   * @returns {string}
   */
  toMessage() {
    if (this.success) {
      return this.output || JSON.stringify(this.data, null, 2);
    } else {
      return `Error: ${this.error}${this.output ? `\nOutput: ${this.output}` : ''}`;
    }
  }

  /**
   * Create a success result
   */
  static success(output, data = null, metadata = {}) {
    return new ToolResult({ success: true, output, data, metadata });
  }

  /**
   * Create a failure result
   */
  static failure(error, output = '', metadata = {}) {
    return new ToolResult({ success: false, error, output, metadata });
  }
}

module.exports = { BaseTool, ToolResult };
