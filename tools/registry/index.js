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
let toolPaths = null;

/**
 * Discovery all tools in the registry directory
 * @returns {Map<string, string>} Map of tool name to file path
 */
function discoverTools() {
    if (toolPaths) {
        return toolPaths;
    }

    toolPaths = new Map();
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
                // We'll peek at the name without requiring the whole module if possible, 
                // but since it's exports, we do a light require once to map names
                const tool = require(toolPath);

                if (tool.name) {
                    toolPaths.set(tool.name, toolPath);
                }
            } catch (err) {
                console.error(`Failed to discover tool ${file}:`, err.message);
            }
        }
    } catch (err) {
        console.error('Failed to read registry directory:', err.message);
    }

    return toolPaths;
}

/**
 * Get all loaded tools as an array
 * @returns {Array<Object>} Array of tool modules
 */
function getAllTools() {
    const paths = discoverTools();
    const tools = [];
    
    for (const name of paths.keys()) {
        const tool = getToolByName(name);
        if (tool) tools.push(tool);
    }
    
    return tools;
}

/**
 * Get a tool by name (Lazy loaded)
 * @param {string} name - Tool name
 * @returns {Object|null} Tool module or null if not found
 */
function getToolByName(name) {
    if (!toolsCache) toolsCache = new Map();
    
    if (toolsCache.has(name)) {
        return toolsCache.get(name);
    }

    const paths = discoverTools();
    const toolPath = paths.get(name);

    if (toolPath) {
        try {
            const tool = require(toolPath);
            toolsCache.set(name, tool);
            return tool;
        } catch (err) {
            console.error(`Failed to lazy load tool ${name}:`, err.message);
        }
    }

    return null;
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
function getToolDefinitions(allowedTools = null) {
    let tools = getAllTools();
    if (Array.isArray(allowedTools)) {
        tools = tools.filter(tool => allowedTools.includes(tool.name));
    }
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
function getToolDefinitionsForLLM(allowedTools = null) {
    let tools = getAllTools();
    if (Array.isArray(allowedTools)) {
        tools = tools.filter(tool => allowedTools.includes(tool.name));
    }
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
function getToolNames(allowedTools = null) {
    const paths = discoverTools();
    const names = Array.from(paths.keys());
    if (!Array.isArray(allowedTools)) {
        return names;
    }
    return names.filter(name => allowedTools.includes(name));
}

/**
 * Clear the tools cache (for reloading)
 */
function clearCache() {
    toolsCache = null;
    toolPaths = null;
}

module.exports = {
    discoverTools,
    loadTools: discoverTools, // Alias for backward compatibility
    getAllTools,
    getToolByName,
    executeTool,
    getToolDefinitions,
    getToolDefinitionsForLLM,
    getToolNames,
    clearCache
};
