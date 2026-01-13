# Flyt Agent Tool System

Modular tool system for the Flyt AI assistant. Tools enable the AI to perform actions on the user's system.

---

## Quick Start

```javascript
const { initializeTools, registry, executeTool } = require('./tools');

// Initialize on app start
initializeTools({ electron: { clipboard, shell } });

// Execute a tool
const result = await executeTool('run_command', { command: 'dir' });
```

---

## Architecture

```
tools/
├── index.js       # Main entry, exports everything
├── base.js        # BaseTool class and ToolResult
├── registry.js    # ToolRegistry - manages all tools
├── shell.js       # Shell/command tools
├── filesystem.js  # File operations
├── system.js      # System utilities (clipboard, URLs)
├── image.js       # Image processing
└── README.md      # This file
```

---

## Agent Loop Overview

The Flyt agent uses an iterative tool-calling loop:

```
User Message
    ↓
Build Context (system prompt + tool docs + system info)
    ↓
Send to LLM (OpenRouter API)
    ↓
Parse Response
    ├─► Tool call? → Execute → Format result → Loop back
    └─► No tool? → Return final response
```

### Key Features

| Feature | Description |
|---------|-------------|
| **Enhanced Tool Docs** | Balanced format with parameter descriptions + examples |
| **Iteration Context** | Results show "step 3/15" for progress awareness |
| **Conversation Windowing** | Prevents unbounded context growth |
| **Project Detection** | Auto-detects Node.js, Python, Rust, etc. |
| **Line-Based Editing** | Insert/delete lines in addition to search/replace |

---

## Configuration

All settings in `main.js`:

```javascript
const AGENT_CONFIG = {
  useCompactDocs: true,           // Enhanced tool documentation
  maxConversationMessages: 20,    // Context window size
  maxToolResultSize: 2000,        // Truncate outputs
  maxErrorResultSize: 500,        // Truncate errors
  minimalSystemContext: true,     // Lean system info
  useNativeFunctionCalling: false // Native tools API (experimental)
};
```

---

## Available Tools

### Shell Tools

| Tool | Description |
|------|-------------|
| `run_command` | Execute shell commands (PowerShell on Windows) |
| `run_background` | Start long-running processes (servers, etc.) |
| `kill_process` | Terminate process by PID or name |

### Filesystem Tools

| Tool | Description |
|------|-------------|
| `read_file` | Read file contents (supports line ranges) |
| `write_file` | Create or overwrite files |
| `edit_file` | Search/replace OR line-based editing |
| `list_directory` | List files and folders |
| `search_files` | Find files by name pattern or content |
| `delete` | Delete files or directories |

### System Tools

| Tool | Description |
|------|-------------|
| `open_url` | Open URL in default browser |
| `open_path` | Open file/folder in default app |
| `clipboard_read` | Read clipboard text |
| `clipboard_write` | Write text to clipboard |
| `system_info` | Get OS, memory, CPU info |
| `env_var` | Read environment variables |
| `wait` | Pause for N seconds |

### Image Tools

| Tool | Description |
|------|-------------|
| `convert_image` | Convert between image formats |

---

## Tool Details

### edit_file

Supports three operation modes:

**1. Search/Replace** (find exact text and replace)
```json
{"tool": "edit_file", "path": "config.js", "search": "port: 3000", "replace": "port: 8080"}
```

**2. Insert After Line** (add new content)
```json
{"tool": "edit_file", "path": "app.js", "insert_after_line": 5, "new_text": "const debug = true;"}
```

**3. Delete Lines** (remove line range)
```json
{"tool": "edit_file", "path": "test.js", "delete_lines": "10-15"}
```

### search_files

Automatically skips for performance:
- Hidden files/dirs (`.git`, `.env`, etc.)
- `node_modules`, `__pycache__`, `venv`, `dist`, `build`

Use `include_hidden: true` to search hidden files.

---

## Adding New Tools

### 1. Create Tool Class

```javascript
// tools/mytool.js
const { BaseTool, ToolResult } = require('./base');

class MyTool extends BaseTool {
  constructor() {
    super({
      name: 'my_tool',
      displayName: 'My Tool',
      description: 'What this tool does',
      category: 'mycategory',
      parameters: {
        properties: {
          param1: { type: 'string', description: 'First param' }
        },
        required: ['param1']
      },
      examples: [
        { tool: 'my_tool', param1: 'value' }
      ],
      timeout: 30000
    });
  }

  async execute(params, context = {}) {
    try {
      const result = doSomething(params.param1);
      return ToolResult.success(`Done: ${result}`);
    } catch (error) {
      return ToolResult.failure(error.message);
    }
  }
}

module.exports = { MyTool };
```

### 2. Register in index.js

```javascript
const { MyTool } = require('./mytool');

function initializeTools(options = {}) {
  // ... existing registrations ...
  registry.register(new MyTool());
}
```

### 3. Update Renderer (optional)

```javascript
// renderer.js - TOOL_DISPLAY object
const TOOL_DISPLAY = {
  my_tool: { name: 'My Tool', verb: 'Processing' }
};
```

---

## System Prompt

The system prompt (stored in Supabase) includes:

1. **Core Principles** - Act don't suggest, read before write, handle errors
2. **Operational Guidelines** - File operations, shell commands, multi-step strategy
3. **Common Patterns** - Edit file flow, debug flow, install deps
4. **Error Recovery** - How to handle common failures

Tool documentation is automatically appended at runtime.

### Key Guidelines for the LLM

- Use **absolute paths** to avoid ambiguity
- Always **read_file before edit_file**
- Set appropriate **timeout** for slow operations
- Provide **exact search text** including whitespace for edits

---

## API Reference

### Registry Methods

```javascript
registry.register(tool)              // Add a tool
registry.get(name)                   // Get tool by name
registry.has(name)                   // Check if exists
registry.getAll()                    // All tools
registry.getEnabled()                // Enabled tools only
registry.getByCategory(category)     // Filter by category
registry.execute(name, params, ctx)  // Execute tool
registry.getSchemas()                // OpenAI function schemas
registry.generateCompactDocumentation() // System prompt docs
registry.getHistory(limit)           // Execution history
```

### Helper Functions

```javascript
initializeTools(options)           // Initialize system
executeTool(name, params, context) // Quick execution
parseToolCall(message)             // Parse from LLM text
formatToolResult(name, result, options) // Format for LLM
getCompactToolDocumentation()      // Get tool docs
getToolSchemas()                   // Native function schemas
```

---

## Troubleshooting

### "Search text not found" in edit_file
- Re-read the file to see exact content
- Include more surrounding context in search
- Check whitespace and indentation match exactly
- Use line-based editing (`insert_after_line`, `delete_lines`) as alternative

### Tool execution timeout
- Increase `timeout` parameter (default: 30000ms)
- For installs/builds, use 120000ms or more
- For servers, use `run_background` instead

### Context growing too large
- Reduce `maxConversationMessages` in AGENT_CONFIG
- Check console for "Windowed from X to Y messages"

### Agent stuck in loop
- Max iterations (15) will stop it automatically
- Improve error messages help agent recover
- Check if tool is returning actionable error info

---

## Token Optimization

| Optimization | Reduction |
|--------------|-----------|
| Enhanced tool docs (vs verbose) | ~70% |
| Minimal system context | ~75% |
| Compact tool results | ~70% |
| Conversation windowing | Prevents unbounded growth |

Typical costs:
- Simple task (1-2 tools): ~800 tokens
- Medium task (3-5 tools): ~2000 tokens
- Complex task (10+ tools): ~4000 tokens

---

## Changelog

### v2.1 - Agent Improvements (January 2026)
- **Enhanced system prompt** with operational guidance
- **Improved tool docs** with parameter descriptions + examples
- **Iteration context** in tool results (step N/15)
- **Line-based editing** (insert_after_line, delete_lines)
- **Project detection** (Node.js, Python, Rust, etc.)
- **Better error messages** with hints for edit_file failures

### v2.0 - Agent Loop Optimizations
- Compact tool documentation
- Conversation windowing
- Minimal system context
- Native function calling support
