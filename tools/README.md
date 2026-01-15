# Flyt Agent Tools

This directory contains the AI agent's tool system built on **MCP (Model Context Protocol)** and **LangGraph.js**.

## Architecture

```
tools/
├── index.js              # Main entry point
├── registry/             # Modular tool definitions
│   ├── index.js          # Dynamic tool loader
│   ├── run_command.js    # Shell command execution
│   ├── read_file.js      # Read file contents
│   ├── write_file.js     # Write/create files
│   ├── list_directory.js # List directory contents
│   ├── search_files.js   # Search files by pattern
│   ├── brave_search.js   # Web search via Brave API
│   └── fetch_url.js      # Fetch URL content to Markdown
├── mcp/
│   ├── server.js         # MCP server (exposes tools via MCP protocol)
│   └── client.js         # MCP client (connects to MCP servers)
└── graph/
    └── agent.js          # LangGraph StateGraph agent
```

## Built-in Tools

### File System Tools

#### `read_file`
Read file contents with optional line range.
- **Input**: `path` (string), `startLine` (number, optional), `endLine` (number, optional)
- **Output**: File contents with line numbers

#### `write_file`
Create or overwrite files.
- **Input**: `path` (string), `content` (string), `createDirectories` (boolean, optional)
- **Output**: Success confirmation with file size

#### `list_directory`
List directory contents with metadata.
- **Input**: `path` (string), `recursive` (boolean, optional), `maxDepth` (number, optional)
- **Output**: Files and folders with types and sizes

#### `search_files`
Search for files matching a glob pattern.
- **Input**: `directory` (string), `pattern` (string, e.g. `*.js`), `maxResults` (number, optional)
- **Output**: List of matching file paths

### Web Tools

#### `brave_search`
Search the web using Brave Search API.
- **Input**: `query` (string), `count` (number, optional, default 5)
- **Output**: Search results with titles, URLs, and snippets
- **Requires**: `BRAVE_SEARCH_API_KEY` environment variable

#### `fetch_url`
Fetch a URL and convert HTML to Markdown.
- **Input**: `url` (string), `timeout` (number, optional)
- **Output**: Page content as readable Markdown

### System Tools

#### `run_command`
Executes shell commands on the host system.
- **Input**: `command` (string), `cwd` (string, optional), `timeout` (number, optional)
- **Behavior**: Uses PowerShell on Windows, bash on Unix
- **Security**: Runs with the same permissions as the host application

## Components

### Tool Registry (`registry/`)
Modular tool system with dynamic loading:
- Each tool is a self-contained module with `name`, `description`, `inputSchema`, and `execute`
- Tools are auto-discovered from the `registry/` folder
- Add new tools by creating a new `.js` file

### MCP Server (`mcp/server.js`)
Exposes registry tools via the MCP protocol:
- Uses `@modelcontextprotocol/sdk` for protocol compliance
- Can run as standalone stdio server
- Handles `tools/list` and `tools/call` requests

### MCP Client (`mcp/client.js`)
Connects to MCP servers (local or remote):
- `connectStdio()` - Connect via stdio transport
- `connectLocalServer()` - Connect to internal tools server
- `callTool()` - Execute tools on connected servers
- Supports multiple concurrent server connections

### LangGraph Agent (`graph/agent.js`)
Manages the agentic loop using a StateGraph:
- `callModel` node - Invokes the LLM
- `executeTools` node - Runs requested tools via registry
- Conditional edges for loop control (max 15 iterations)

## Usage

```javascript
const { runAgent } = require('./tools');

const result = await runAgent({
  messages: [...], // Conversation history
  apiKey: '...',   // OpenRouter API key
  model: '...',    // Model identifier
  context: { cwd: '/path' },
  onToolProgress: (progress) => { /* handle updates */ }
});
```

## Adding New Tools

Create a new file in `registry/` (e.g., `my_tool.js`):

```javascript
const name = 'my_tool';
const description = 'What this tool does';

const inputSchema = {
    type: 'object',
    properties: {
        param1: { type: 'string', description: 'First parameter' }
    },
    required: ['param1']
};

async function execute(params, context) {
    // Tool logic here
    return { success: true, output: 'Result' };
}

module.exports = { name, description, inputSchema, execute };
```

The tool will be automatically loaded on next startup.

## Connecting to External MCP Servers

```javascript
const { MCPClient } = require('./tools');

const client = new MCPClient();

// Connect to an external MCP server
await client.connectStdio('database', {
    command: 'node',
    args: ['path/to/database-mcp-server.js']
});

// Use tools from the connected server
const result = await client.callTool('query_database', { sql: 'SELECT * FROM users' });
```
