/**
 * MCP Client - True MCP Client using @modelcontextprotocol/sdk
 * 
 * Provides connection to MCP servers (local or remote) for tool execution.
 * Supports multiple concurrent server connections.
 */

const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');
const path = require('path');

/**
 * MCP Client for connecting to MCP servers
 */
class MCPClient {
    constructor(options = {}) {
        this.name = options.name || 'flyt-mcp-client';
        this.version = options.version || '1.0.0';

        // Active server connections: Map<serverId, { client, transport, tools }>
        this.connections = new Map();

        // Combined tools from all connections
        this.allTools = new Map();
    }

    /**
     * Connect to a local MCP server via stdio
     * @param {string} serverId - Unique identifier for this server
     * @param {Object} config - Server configuration
     * @param {string} config.command - Command to run (e.g., 'node', 'python')
     * @param {Array<string>} config.args - Command arguments (e.g., ['server.js'])
     * @param {Object} config.env - Environment variables (optional)
     * @param {string} config.cwd - Working directory (optional)
     * @returns {Promise<Object>} - Connection info with tools list
     */
    async connectStdio(serverId, config) {
        if (this.connections.has(serverId)) {
            console.log(`Server ${serverId} already connected`);
            return this.connections.get(serverId);
        }

        try {
            const client = new Client({
                name: this.name,
                version: this.version
            });

            const transport = new StdioClientTransport({
                command: config.command,
                args: config.args || [],
                env: config.env,
                cwd: config.cwd
            });

            await client.connect(transport);

            // Get available tools
            const toolsResult = await client.listTools();
            const tools = toolsResult.tools || [];

            // Store connection
            const connection = {
                client,
                transport,
                tools,
                config
            };
            this.connections.set(serverId, connection);

            // Add tools to combined map with server prefix
            for (const tool of tools) {
                this.allTools.set(`${serverId}:${tool.name}`, {
                    serverId,
                    tool
                });
                // Also add without prefix for direct access
                if (!this.allTools.has(tool.name)) {
                    this.allTools.set(tool.name, { serverId, tool });
                }
            }

            console.log(`Connected to MCP server '${serverId}' with tools:`, tools.map(t => t.name));
            return connection;

        } catch (error) {
            console.error(`Failed to connect to MCP server '${serverId}':`, error.message);
            throw error;
        }
    }

    /**
     * Connect to the internal tools server (local registry)
     * @returns {Promise<Object>} - Connection info
     */
    async connectLocalServer() {
        const serverPath = path.join(__dirname, 'server.js');
        return this.connectStdio('local', {
            command: process.execPath,
            args: [serverPath],
            cwd: process.cwd()
        });
    }

    /**
     * Disconnect from a server
     * @param {string} serverId - Server identifier
     */
    async disconnect(serverId) {
        const connection = this.connections.get(serverId);
        if (!connection) {
            return;
        }

        try {
            await connection.client.close();
        } catch (error) {
            console.warn(`Error closing connection to ${serverId}:`, error.message);
        }

        // Remove tools from combined map
        for (const tool of connection.tools) {
            this.allTools.delete(`${serverId}:${tool.name}`);
            // Only remove unprefixed if it belongs to this server
            const entry = this.allTools.get(tool.name);
            if (entry && entry.serverId === serverId) {
                this.allTools.delete(tool.name);
            }
        }

        this.connections.delete(serverId);
        console.log(`Disconnected from MCP server '${serverId}'`);
    }

    /**
     * Disconnect from all servers
     */
    async disconnectAll() {
        const serverIds = Array.from(this.connections.keys());
        for (const serverId of serverIds) {
            await this.disconnect(serverId);
        }
    }

    /**
     * List all available tools from all connected servers
     * @returns {Array<Object>} - Array of tool definitions
     */
    listTools() {
        const tools = [];
        for (const [name, { tool }] of this.allTools) {
            // Skip prefixed duplicates
            if (name.includes(':')) continue;
            tools.push(tool);
        }
        return tools;
    }

    /**
     * Get tool definitions in OpenAI function format
     * @returns {Array<Object>} - Array of function definitions
     */
    getToolDefinitionsForLLM() {
        return this.listTools().map(tool => ({
            type: 'function',
            function: {
                name: tool.name,
                description: tool.description || '',
                parameters: tool.inputSchema || { type: 'object', properties: {} }
            }
        }));
    }

    /**
     * Call a tool on the appropriate server
     * @param {string} name - Tool name (can be 'serverId:toolName' or just 'toolName')
     * @param {Object} args - Tool arguments
     * @returns {Promise<Object>} - Tool result
     */
    async callTool(name, args = {}) {
        const entry = this.allTools.get(name);
        if (!entry) {
            return {
                success: false,
                output: '',
                error: `Unknown tool: ${name}`
            };
        }

        const { serverId } = entry;
        const connection = this.connections.get(serverId);
        if (!connection) {
            return {
                success: false,
                output: '',
                error: `Server ${serverId} not connected`
            };
        }

        try {
            // Extract actual tool name (remove server prefix if present)
            const actualName = name.includes(':') ? name.split(':')[1] : name;

            const result = await connection.client.callTool({
                name: actualName,
                arguments: args
            });

            // Parse MCP result format
            const content = result.content || [];
            let output = '';
            let isError = result.isError || false;

            for (const item of content) {
                if (item.type === 'text') {
                    output += item.text;
                }
            }

            return {
                success: !isError,
                output,
                error: isError ? output : undefined
            };

        } catch (error) {
            return {
                success: false,
                output: '',
                error: `Tool execution failed: ${error.message}`
            };
        }
    }

    /**
     * Get list of connected server IDs
     * @returns {Array<string>}
     */
    getConnectedServers() {
        return Array.from(this.connections.keys());
    }

    /**
     * Check if any servers are connected
     * @returns {boolean}
     */
    isConnected() {
        return this.connections.size > 0;
    }
}

// Singleton instance for convenience
let defaultClient = null;

/**
 * Get or create the default MCP client
 * @returns {MCPClient}
 */
function getDefaultClient() {
    if (!defaultClient) {
        defaultClient = new MCPClient();
    }
    return defaultClient;
}

module.exports = {
    MCPClient,
    getDefaultClient
};
