/**
 * System Tools
 * 
 * Tools for interacting with the system: clipboard, URLs, notifications, etc.
 */

const { exec } = require('child_process');
const { promisify } = require('util');
const os = require('os');
const { BaseTool, ToolResult } = require('./base');

const execAsync = promisify(exec);

// Electron modules will be injected
let electronClipboard = null;
let electronShell = null;

/**
 * Initialize with Electron modules
 */
function initElectronModules(clipboard, shell) {
  electronClipboard = clipboard;
  electronShell = shell;
}

/**
 * Open URL Tool
 * Open a URL in the default browser
 */
class OpenUrlTool extends BaseTool {
  constructor() {
    super({
      name: 'open_url',
      displayName: 'Open URL',
      description: 'Open a URL in the default web browser.',
      category: 'system',
      parameters: {
        properties: {
          url: {
            type: 'string',
            description: 'The URL to open'
          }
        },
        required: ['url']
      },
      examples: [
        { tool: 'open_url', url: 'https://github.com' },
        { tool: 'open_url', url: 'https://docs.python.org' }
      ],
      timeout: 5000
    });
  }

  async execute(params, context = {}) {
    const { url } = params;

    // Validate URL
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return ToolResult.failure('Only http and https URLs are supported');
      }
    } catch {
      return ToolResult.failure(`Invalid URL: ${url}`);
    }

    try {
      if (electronShell) {
        await electronShell.openExternal(url);
      } else {
        // Fallback for non-Electron environments
        const command = process.platform === 'win32'
          ? `start "" "${url}"`
          : process.platform === 'darwin'
            ? `open "${url}"`
            : `xdg-open "${url}"`;
        await execAsync(command);
      }

      return ToolResult.success(`Opened URL in browser: ${url}`, { url });

    } catch (error) {
      return ToolResult.failure(`Failed to open URL: ${error.message}`);
    }
  }
}

/**
 * Open File/Folder Tool
 * Open a file or folder in the default application
 */
class OpenPathTool extends BaseTool {
  constructor() {
    super({
      name: 'open_path',
      displayName: 'Open File/Folder',
      description: 'Open a file in its default application or open a folder in file explorer.',
      category: 'system',
      parameters: {
        properties: {
          path: {
            type: 'string',
            description: 'The file or folder path to open'
          }
        },
        required: ['path']
      },
      examples: [
        { tool: 'open_path', path: 'C:\\Projects\\app' },
        { tool: 'open_path', path: 'document.pdf' }
      ],
      timeout: 5000
    });
  }

  async execute(params, context = {}) {
    const { path: targetPath } = params;

    try {
      if (electronShell) {
        await electronShell.openPath(targetPath);
      } else {
        const command = process.platform === 'win32'
          ? `start "" "${targetPath}"`
          : process.platform === 'darwin'
            ? `open "${targetPath}"`
            : `xdg-open "${targetPath}"`;
        await execAsync(command);
      }

      return ToolResult.success(`Opened: ${targetPath}`, { path: targetPath });

    } catch (error) {
      return ToolResult.failure(`Failed to open path: ${error.message}`);
    }
  }
}

/**
 * Clipboard Read Tool
 * Read text from the system clipboard
 */
class ClipboardReadTool extends BaseTool {
  constructor() {
    super({
      name: 'clipboard_read',
      displayName: 'Read Clipboard',
      description: 'Read the current text content from the system clipboard.',
      category: 'system',
      parameters: {
        properties: {},
        required: []
      },
      examples: [
        { tool: 'clipboard_read' }
      ],
      timeout: 5000
    });
  }

  async execute(params, context = {}) {
    try {
      let text;
      
      if (electronClipboard) {
        text = electronClipboard.readText();
      } else {
        // Fallback for non-Electron
        if (process.platform === 'win32') {
          const { stdout } = await execAsync('powershell -command "Get-Clipboard"');
          text = stdout.trim();
        } else if (process.platform === 'darwin') {
          const { stdout } = await execAsync('pbpaste');
          text = stdout;
        } else {
          const { stdout } = await execAsync('xclip -selection clipboard -o');
          text = stdout;
        }
      }

      if (!text || text.length === 0) {
        return ToolResult.success('Clipboard is empty', { empty: true });
      }

      // Truncate very long content
      const maxLength = 50000;
      const truncated = text.length > maxLength;
      const displayText = truncated 
        ? text.substring(0, maxLength) + '\n... [truncated]'
        : text;

      return ToolResult.success(
        `Clipboard content (${text.length} characters):\n\n${displayText}`,
        { text, length: text.length, truncated }
      );

    } catch (error) {
      return ToolResult.failure(`Failed to read clipboard: ${error.message}`);
    }
  }
}

/**
 * Clipboard Write Tool
 * Write text to the system clipboard
 */
class ClipboardWriteTool extends BaseTool {
  constructor() {
    super({
      name: 'clipboard_write',
      displayName: 'Write to Clipboard',
      description: 'Write text to the system clipboard.',
      category: 'system',
      parameters: {
        properties: {
          text: {
            type: 'string',
            description: 'The text to write to the clipboard'
          }
        },
        required: ['text']
      },
      examples: [
        { tool: 'clipboard_write', text: 'Hello, World!' }
      ],
      timeout: 5000
    });
  }

  async execute(params, context = {}) {
    const { text } = params;

    try {
      if (electronClipboard) {
        electronClipboard.writeText(text);
      } else {
        if (process.platform === 'win32') {
          await execAsync(`powershell -command "Set-Clipboard -Value '${text.replace(/'/g, "''")}'"`);
        } else if (process.platform === 'darwin') {
          await execAsync(`echo "${text.replace(/"/g, '\\"')}" | pbcopy`);
        } else {
          await execAsync(`echo "${text.replace(/"/g, '\\"')}" | xclip -selection clipboard`);
        }
      }

      return ToolResult.success(
        `Copied ${text.length} characters to clipboard`,
        { length: text.length }
      );

    } catch (error) {
      return ToolResult.failure(`Failed to write to clipboard: ${error.message}`);
    }
  }
}

/**
 * System Info Tool
 * Get current system information
 */
class SystemInfoTool extends BaseTool {
  constructor() {
    super({
      name: 'system_info',
      displayName: 'System Information',
      description: 'Get current system information including OS, memory, CPU, and running processes.',
      category: 'system',
      parameters: {
        properties: {
          section: {
            type: 'string',
            description: 'Specific section: "os", "memory", "cpu", "network", "processes", or "all"'
          }
        },
        required: []
      },
      examples: [
        { tool: 'system_info' },
        { tool: 'system_info', section: 'memory' }
      ],
      timeout: 10000
    });
  }

  async execute(params, context = {}) {
    const { section = 'all' } = params;

    try {
      const info = {};

      if (section === 'all' || section === 'os') {
        info.os = {
          platform: os.platform(),
          type: os.type(),
          release: os.release(),
          arch: os.arch(),
          hostname: os.hostname(),
          uptime: `${Math.round(os.uptime() / 3600)} hours`
        };
      }

      if (section === 'all' || section === 'memory') {
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        info.memory = {
          total: `${(totalMem / 1024 / 1024 / 1024).toFixed(1)} GB`,
          free: `${(freeMem / 1024 / 1024 / 1024).toFixed(1)} GB`,
          used: `${((totalMem - freeMem) / 1024 / 1024 / 1024).toFixed(1)} GB`,
          usedPercent: `${Math.round((totalMem - freeMem) / totalMem * 100)}%`
        };
      }

      if (section === 'all' || section === 'cpu') {
        const cpus = os.cpus();
        info.cpu = {
          model: cpus[0]?.model || 'Unknown',
          cores: cpus.length,
          speed: `${cpus[0]?.speed || 0} MHz`
        };
      }

      if (section === 'all' || section === 'network') {
        const interfaces = os.networkInterfaces();
        const activeInterfaces = [];
        for (const [name, addrs] of Object.entries(interfaces)) {
          for (const addr of addrs) {
            if (!addr.internal && addr.family === 'IPv4') {
              activeInterfaces.push({ name, ip: addr.address });
            }
          }
        }
        info.network = { interfaces: activeInterfaces };
      }

      if (section === 'all' || section === 'processes') {
        try {
          if (process.platform === 'win32') {
            const { stdout } = await execAsync(
              'powershell -command "Get-Process | Sort-Object CPU -Descending | Select-Object -First 10 Name, CPU, WorkingSet | Format-Table -AutoSize"',
              { timeout: 5000 }
            );
            info.topProcesses = stdout.trim();
          } else {
            const { stdout } = await execAsync('ps aux --sort=-%cpu | head -11', { timeout: 5000 });
            info.topProcesses = stdout.trim();
          }
        } catch {
          info.topProcesses = 'Could not retrieve process list';
        }
      }

      let output = '';
      for (const [key, value] of Object.entries(info)) {
        if (key === 'topProcesses') {
          output += `\n**Top Processes:**\n\`\`\`\n${value}\n\`\`\`\n`;
        } else {
          output += `**${key.charAt(0).toUpperCase() + key.slice(1)}:**\n`;
          output += JSON.stringify(value, null, 2) + '\n\n';
        }
      }

      return ToolResult.success(output, info);

    } catch (error) {
      return ToolResult.failure(`Failed to get system info: ${error.message}`);
    }
  }
}

/**
 * Environment Variable Tool
 */
class EnvVarTool extends BaseTool {
  constructor() {
    super({
      name: 'env_var',
      displayName: 'Environment Variable',
      description: 'Get or list environment variables.',
      category: 'system',
      parameters: {
        properties: {
          name: {
            type: 'string',
            description: 'Variable name to get (omit to list all)'
          },
          filter: {
            type: 'string',
            description: 'Filter variable names containing this text'
          }
        },
        required: []
      },
      examples: [
        { tool: 'env_var', name: 'PATH' },
        { tool: 'env_var', filter: 'NODE' }
      ],
      timeout: 5000
    });
  }

  async execute(params, context = {}) {
    const { name, filter } = params;

    if (name) {
      const value = process.env[name];
      if (value === undefined) {
        return ToolResult.success(`Environment variable "${name}" is not set`, { exists: false });
      }
      return ToolResult.success(`${name}=${value}`, { name, value });
    }

    // List variables
    let vars = Object.entries(process.env);
    
    if (filter) {
      vars = vars.filter(([key]) => key.toLowerCase().includes(filter.toLowerCase()));
    }

    // Sort and format
    vars.sort(([a], [b]) => a.localeCompare(b));
    
    const output = vars.map(([key, value]) => {
      // Truncate long values
      const displayValue = value.length > 200 ? value.substring(0, 200) + '...' : value;
      return `${key}=${displayValue}`;
    }).join('\n');

    return ToolResult.success(
      `Environment variables${filter ? ` (filter: "${filter}")` : ''} (${vars.length}):\n\n${output}`,
      { count: vars.length }
    );
  }
}

/**
 * Wait/Sleep Tool
 */
class WaitTool extends BaseTool {
  constructor() {
    super({
      name: 'wait',
      displayName: 'Wait',
      description: 'Pause execution for a specified duration. Useful for waiting for processes to complete.',
      category: 'system',
      parameters: {
        properties: {
          seconds: {
            type: 'number',
            description: 'Number of seconds to wait (max: 60)'
          }
        },
        required: ['seconds']
      },
      examples: [
        { tool: 'wait', seconds: 5 }
      ],
      timeout: 65000
    });
  }

  async execute(params, context = {}) {
    const { seconds } = params;

    if (seconds < 0 || seconds > 60) {
      return ToolResult.failure('Wait time must be between 0 and 60 seconds');
    }

    const ms = Math.round(seconds * 1000);
    await new Promise(resolve => setTimeout(resolve, ms));

    return ToolResult.success(`Waited for ${seconds} seconds`);
  }
}

module.exports = {
  initElectronModules,
  OpenUrlTool,
  OpenPathTool,
  ClipboardReadTool,
  ClipboardWriteTool,
  SystemInfoTool,
  EnvVarTool,
  WaitTool
};
