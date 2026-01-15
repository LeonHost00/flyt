/**
 * Tool Registry - Dynamic Tool Loader
 * 
 * Automatically discovers and loads tool modules from this directory.
 * Each tool module should export: name, description, inputSchema, execute
 */

const fs = require('fs');
const path = require('path');

// Cache for loaded tools
let toolsCache = null;

/**
 * Load all tools from the registry directory
 * @returns {Map<string, Object>} Map of tool name to tool module
 */
function loadTools() {
    if (toolsCache) {
        return toolsCache;
    }

    toolsCache = new Map();
    const registryDir = __dirname;

    try {
        const files = fs.readdirSync(registryDir);

        for (const file of files) {
            // Skip non-JS files and index.js
            if (!file.endsWith('.js') || file === 'index.js') {
                continue;
            }

            try {
                const toolPath = path.join(registryDir, file);
                const tool = require(toolPath);

                // Validate tool module structure
                if (!tool.name || !tool.execute) {
                    console.warn(`Tool ${file} missing required exports (name, execute)`);
                    continue;
                }

                toolsCache.set(tool.name, tool);
                console.log(`Loaded tool: ${tool.name}`);
            } catch (err) {
                console.error(`Failed to load tool ${file}:`, err.message);
            }
        }
    } catch (err) {
        console.error('Failed to read registry directory:', err.message);
    }

    return toolsCache;
}

/**
 * Get all loaded tools as an array
 * @returns {Array<Object>} Array of tool modules
 */
function getAllTools() {
    const tools = loadTools();
    return Array.from(tools.values());
}

/**
 * Get a tool by name
 * @param {string} name - Tool name
 * @returns {Object|null} Tool module or null if not found
 */
function getToolByName(name) {
    const tools = loadTools();
    return tools.get(name) || null;
}

/**
 * Execute a tool by name
 * @param {string} name - Tool name
 * @param {Object} params - Tool parameters
 * @param {Object} context - Execution context
 * @returns {Promise<{success: boolean, output: string, error?: string}>}
 */
async function executeTool(name, params, context = {}) {
    const tool = getToolByName(name);

    if (!tool) {
        return {
            success: false,
            output: '',
            error: `Unknown tool: ${name}`
        };
    }

    try {
        return await tool.execute(params, context);
    } catch (error) {
        return {
            success: false,
            output: '',
            error: `Tool execution failed: ${error.message}`
        };
    }
}

/**
 * Get tool definitions in MCP format
 * @returns {Array<Object>} Array of MCP tool definitions
 */
function getToolDefinitions() {
    const tools = getAllTools();
    return tools.map(tool => ({
        name: tool.name,
        description: tool.description || '',
        inputSchema: tool.inputSchema || { type: 'object', properties: {} }
    }));
}

/**
 * Get tool definitions in OpenAI function format (for LLM)
 * @returns {Array<Object>} Array of OpenAI function definitions
 */
function getToolDefinitionsForLLM() {
    const tools = getAllTools();
    return tools.map(tool => ({
        type: 'function',
        function: {
            name: tool.name,
            description: tool.description || '',
            parameters: tool.inputSchema || { type: 'object', properties: {} }
        }
    }));
}

/**
 * Get list of tool names
 * @returns {Array<string>} Array of tool names
 */
function getToolNames() {
    const tools = loadTools();
    return Array.from(tools.keys());
}

/**
 * Clear the tools cache (for reloading)
 */
function clearCache() {
    toolsCache = null;
}

module.exports = {
    loadTools,
    getAllTools,
    getToolByName,
    executeTool,
    getToolDefinitions,
    getToolDefinitionsForLLM,
    getToolNames,
    clearCache
};
