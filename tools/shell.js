/**
 * Shell/Command Tools
 * 
 * Tools for executing shell commands and interacting with the system terminal.
 */

const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const path = require('path');
const os = require('os');
const { BaseTool, ToolResult } = require('./base');

const execAsync = promisify(exec);

/**
 * Run Command Tool
 * Execute shell commands in PowerShell (Windows) or default shell (Unix)
 */
class RunCommandTool extends BaseTool {
  constructor() {
    super({
      name: 'run_command',
      displayName: 'Run Command',
      description: 'Execute a shell command. Use for file operations, git commands, package management, system checks, and automation tasks.',
      category: 'shell',
      parameters: {
        properties: {
          command: {
            type: 'string',
            description: 'The command to execute'
          },
          working_directory: {
            type: 'string',
            description: 'Optional working directory for the command (defaults to user home)'
          },
          timeout: {
            type: 'number',
            description: 'Timeout in milliseconds (default: 30000, max: 300000)'
          }
        },
        required: ['command']
      },
      examples: [
        { tool: 'run_command', command: 'dir' },
        { tool: 'run_command', command: 'git status', working_directory: 'C:\\Projects\\MyApp' },
        { tool: 'run_command', command: 'npm install express', timeout: 60000 }
      ],
      requiresConfirmation: false, // Most commands are safe, destructive ones should be confirmed conversationally
      timeout: 30000
    });
  }

  async execute(params, context = {}) {
    const { command, working_directory, timeout = 30000 } = params;

    // Security: Block obviously dangerous commands
    const dangerousPatterns = [
      /rm\s+(-rf?|--recursive)\s+[\/\\]($|\s)/i,  // rm -rf /
      /format\s+[a-z]:/i,                          // format C:
      /del\s+\/[sq]\s+[a-z]:\\/i,                  // del /s C:\
      /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}/,          // fork bomb
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(command)) {
        return ToolResult.failure(
          'This command appears to be potentially destructive. Please be more specific about what you want to do.',
          '',
          { blocked: true, pattern: pattern.toString() }
        );
      }
    }

    const effectiveTimeout = Math.min(Math.max(timeout, 1000), 300000); // 1s to 5 min
    const cwd = working_directory || os.homedir();

    try {
      console.log('\n========== EXECUTING COMMAND ==========');
      console.log('Command:', command);
      console.log('CWD:', cwd);
      console.log('Timeout:', effectiveTimeout, 'ms');

      const { stdout, stderr } = await execAsync(command, {
        timeout: effectiveTimeout,
        maxBuffer: 5 * 1024 * 1024, // 5MB buffer
        cwd,
        shell: process.platform === 'win32' ? 'powershell.exe' : undefined,
        env: { ...process.env, FORCE_COLOR: '0' } // Disable colors for cleaner output
      });

      const output = stdout + (stderr ? `\n[STDERR]: ${stderr}` : '');
      const truncatedOutput = output.length > 50000
        ? output.substring(0, 50000) + '\n... [output truncated, showing first 50KB]'
        : output;

      console.log('Output length:', output.length);
      console.log('=========================================\n');

      return ToolResult.success(
        truncatedOutput || '(Command completed with no output)',
        { stdout, stderr, exitCode: 0 },
        { cwd, command, duration: Date.now() }
      );

    } catch (error) {
      console.log('Error:', error.message);
      console.log('=========================================\n');

      // Include partial output even on error
      const output = (error.stdout || '') + (error.stderr ? `\n[STDERR]: ${error.stderr}` : '');
      const truncatedOutput = output.length > 50000
        ? output.substring(0, 50000) + '\n... [output truncated]'
        : output;

      return ToolResult.failure(
        error.message,
        truncatedOutput || 'No output captured',
        {
          exitCode: error.code,
          signal: error.signal,
          killed: error.killed
        }
      );
    }
  }
}

/**
 * Background Command Tool
 * Start long-running processes in the background
 */
class BackgroundCommandTool extends BaseTool {
  constructor() {
    super({
      name: 'run_background',
      displayName: 'Run Background Process',
      description: 'Start a long-running process in the background (like servers). Returns immediately without waiting for completion.',
      category: 'shell',
      parameters: {
        properties: {
          command: {
            type: 'string',
            description: 'The command to run in the background'
          },
          working_directory: {
            type: 'string',
            description: 'Working directory for the command'
          }
        },
        required: ['command']
      },
      examples: [
        { tool: 'run_background', command: 'npm run dev', working_directory: 'C:\\Projects\\MyApp' },
        { tool: 'run_background', command: 'python -m http.server 8000' }
      ],
      timeout: 5000
    });

    this.backgroundProcesses = new Map();
  }

  async execute(params, context = {}) {
    const { command, working_directory } = params;
    const cwd = working_directory || os.homedir();

    try {
      // Parse command into parts
      const parts = command.match(/(?:[^\s"]+|"[^"]*")+/g) || [command];
      const cmd = parts[0];
      const args = parts.slice(1).map(arg => arg.replace(/^"|"$/g, ''));

      const child = spawn(cmd, args, {
        cwd,
        shell: process.platform === 'win32' ? 'powershell.exe' : true,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      const processId = child.pid;
      let outputBuffer = '';

      // Capture some initial output
      child.stdout?.on('data', (data) => {
        outputBuffer += data.toString();
        if (outputBuffer.length > 10000) {
          outputBuffer = outputBuffer.slice(-10000);
        }
      });

      child.stderr?.on('data', (data) => {
        outputBuffer += '[STDERR] ' + data.toString();
      });

      // Store process reference
      this.backgroundProcesses.set(processId, {
        command,
        cwd,
        child,
        startTime: Date.now(),
        getOutput: () => outputBuffer
      });

      // Clean up on exit
      child.on('exit', (code) => {
        this.backgroundProcesses.delete(processId);
      });

      // Unref to allow the parent process to exit independently
      child.unref();

      // Wait a moment to catch immediate errors
      await new Promise(resolve => setTimeout(resolve, 1000));

      if (child.killed || child.exitCode !== null) {
        return ToolResult.failure(
          `Process exited immediately with code ${child.exitCode}`,
          outputBuffer
        );
      }

      return ToolResult.success(
        `Background process started with PID ${processId}.\nCommand: ${command}\nWorking directory: ${cwd}\n\nInitial output:\n${outputBuffer.substring(0, 2000) || '(no output yet)'}`,
        { pid: processId, command, cwd },
        { pid: processId }
      );

    } catch (error) {
      return ToolResult.failure(`Failed to start background process: ${error.message}`);
    }
  }
}

/**
 * Kill Process Tool
 * Terminate a running process
 */
class KillProcessTool extends BaseTool {
  constructor() {
    super({
      name: 'kill_process',
      displayName: 'Kill Process',
      description: 'Terminate a process by PID or name. Use with caution.',
      category: 'shell',
      parameters: {
        properties: {
          pid: {
            type: 'number',
            description: 'Process ID to kill'
          },
          name: {
            type: 'string',
            description: 'Process name to kill (e.g., "node", "python")'
          },
          force: {
            type: 'boolean',
            description: 'Force kill (SIGKILL on Unix, /F on Windows)'
          }
        },
        required: [] // At least one of pid or name required
      },
      examples: [
        { tool: 'kill_process', pid: 12345 },
        { tool: 'kill_process', name: 'node', force: true }
      ],
      requiresConfirmation: true,
      timeout: 10000
    });
  }

  async execute(params, context = {}) {
    const { pid, name, force = false } = params;

    if (!pid && !name) {
      return ToolResult.failure('Must provide either "pid" or "name" parameter');
    }

    try {
      let command;

      if (process.platform === 'win32') {
        if (pid) {
          command = force
            ? `taskkill /PID ${pid} /F`
            : `taskkill /PID ${pid}`;
        } else {
          command = force
            ? `taskkill /IM "${name}.exe" /F`
            : `taskkill /IM "${name}.exe"`;
        }
      } else {
        const signal = force ? '-9' : '-15';
        if (pid) {
          command = `kill ${signal} ${pid}`;
        } else {
          command = `pkill ${signal} ${name}`;
        }
      }

      const { stdout, stderr } = await execAsync(command, { timeout: this.timeout });

      return ToolResult.success(
        `Process terminated successfully.\n${stdout}${stderr ? '\n' + stderr : ''}`,
        { pid, name, force }
      );

    } catch (error) {
      return ToolResult.failure(
        `Failed to kill process: ${error.message}`,
        error.stdout || error.stderr || ''
      );
    }
  }
}

module.exports = {
  RunCommandTool,
  BackgroundCommandTool,
  KillProcessTool
};
