/**
 * Tools Module - Entry Point
 * 
 * Exports the MCP/LangGraph-based tool system with modular registry.
 */

// Registry for local tool definitions
const registry = require('./registry');

// MCP server and client
const { createServer, runStdioServer } = require('./mcp/server');
const { MCPClient, getDefaultClient } = require('./mcp/client');

// LangGraph agent
const { runAgent, createAgent, convertMessages } = require('./graph/agent');

/**
 * Get tool documentation for system prompt
 * Dynamically generates from registry
 */
/**
 * Get documentation for available tools
 * @param {Array<string>} [allowedTools] - Optional list of allowed tool names
 * @returns {string} Markdown documentation
 */
function getToolDocumentation(allowedTools = null) {
    let tools = registry.getAllTools();
    
    if (allowedTools && Array.isArray(allowedTools)) {
        tools = tools.filter(tool => allowedTools.includes(tool.name));
    }

    if (tools.length === 0) return '';

    let doc = `## Available Tools\n\nYou have access to the following tool${tools.length > 1 ? 's' : ''}. Call them using JSON format.\n\n`;

    for (const tool of tools) {
        doc += `### ${tool.name}\n`;
        doc += `${tool.description}\n\n`;

        if (tool.inputSchema && tool.inputSchema.properties) {
            doc += `**Parameters:**\n`;
            const props = tool.inputSchema.properties;
            const required = tool.inputSchema.required || [];

            for (const [name, prop] of Object.entries(props)) {
                const isRequired = required.includes(name);
                doc += `- \`${name}\` (${isRequired ? 'required' : 'optional'}): ${prop.description || ''}\n`;
            }
            doc += '\n';
        }
    }

    return doc;
}

module.exports = {
    // Registry (local tools)
    registry,
    loadTools: registry.loadTools,
    getAllTools: registry.getAllTools,
    getToolByName: registry.getToolByName,

    // Tool execution (via registry)
    executeTool: registry.executeTool,
    getToolDefinitions: registry.getToolDefinitionsForLLM,
    getToolNames: registry.getToolNames,
    getToolDocumentation,

    // MCP Server
    createServer,
    runStdioServer,

    // MCP Client
    MCPClient,
    getDefaultClient,

    // LangGraph Agent
    runAgent,
    createAgent,
    convertMessages
};
