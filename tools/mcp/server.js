/**
 * MCP Server - Model Context Protocol Tool Server
 * 
 * Exposes tools from the registry in MCP format.
 * Can run as a standalone MCP server for stdio transport.
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
    CallToolRequestSchema,
    ListToolsRequestSchema
} = require('@modelcontextprotocol/sdk/types.js');

const registry = require('../registry');

/**
 * Create and configure the MCP server
 */
function createServer() {
    const server = new Server(
        {
            name: 'flyt-tools-server',
            version: '1.0.0'
        },
        {
            capabilities: {
                tools: {}
            }
        }
    );

    // Handle list tools request
    server.setRequestHandler(ListToolsRequestSchema, async () => {
        const tools = registry.getToolDefinitions();
        return { tools };
    });

    // Handle call tool request
    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;

        try {
            const result = await registry.executeTool(name, args || {});

            return {
                content: [
                    {
                        type: 'text',
                        text: result.output || ''
                    }
                ],
                isError: !result.success
            };
        } catch (error) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Error: ${error.message}`
                    }
                ],
                isError: true
            };
        }
    });

    return server;
}

/**
 * Run the server with stdio transport (for MCP client connections)
 */
async function runStdioServer() {
    const server = createServer();
    const transport = new StdioServerTransport();

    await server.connect(transport);
    console.error('Flyt MCP server running on stdio');
}

// Legacy exports for backward compatibility
const { executeTool, getToolDefinitions, getToolNames, getToolDefinitionsForLLM } = registry;

/**
 * Get tool definitions (legacy format for agent.js)
 */
function getLegacyToolDefinitions() {
    return getToolDefinitionsForLLM();
}

module.exports = {
    // New MCP server
    createServer,
    runStdioServer,

    // Registry passthrough (for backward compatibility)
    executeTool,
    getToolDefinitions: getLegacyToolDefinitions,
    getToolNames,

    // Direct registry access
    registry
};

// Run as standalone server if executed directly
if (require.main === module) {
    runStdioServer().catch(console.error);
}
