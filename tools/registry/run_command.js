/**
 * run_command Tool - Shell Command Execution
 * 
 * Executes shell commands using PowerShell on Windows or bash on Unix.
 */

const { spawn } = require('child_process');
const os = require('os');

/**
 * Tool metadata
 */
const name = 'run_command';
const description = 'Execute a shell command. Uses PowerShell on Windows, bash on Unix. Returns stdout, stderr, and exit code.';

const inputSchema = {
    type: 'object',
    properties: {
        command: {
            type: 'string',
            description: 'The command to execute'
        },
        cwd: {
            type: 'string',
            description: 'Working directory for the command (optional)'
        },
        timeout: {
            type: 'number',
            description: 'Timeout in milliseconds (default: 30000)'
        }
    },
    required: ['command']
};

/**
 * Execute the tool
 * @param {Object} params - Tool parameters
 * @param {Object} context - Execution context (cwd, user, etc.)
 * @returns {Promise<{success: boolean, output: string, error?: string}>}
 */
async function execute(params, context = {}) {
    const { command, cwd, timeout = 30000 } = params;
    const workingDir = cwd || context.cwd || os.homedir();

    try {
        const isWindows = process.platform === 'win32';
        const shell = isWindows ? 'powershell.exe' : '/bin/bash';
        const shellArgs = isWindows ? ['-NoProfile', '-Command', command] : ['-c', command];

        const result = await new Promise((resolve, reject) => {
            const proc = spawn(shell, shellArgs, {
                cwd: workingDir,
                timeout,
                windowsHide: true,
                env: { ...process.env }
            });

            let stdout = '';
            let stderr = '';

            proc.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            proc.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            proc.on('close', (code) => {
                resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() });
            });

            proc.on('error', (err) => {
                reject(err);
            });

            // Handle timeout
            setTimeout(() => {
                proc.kill('SIGTERM');
                reject(new Error(`Command timed out after ${timeout}ms`));
            }, timeout);
        });

        // Format output
        let output = '';
        if (result.stdout) {
            output += result.stdout;
        }
        if (result.stderr) {
            output += output ? `\n\nStderr:\n${result.stderr}` : result.stderr;
        }
        if (!output) {
            output = `Command completed with exit code ${result.code}`;
        }

        // Truncate if too long (save tokens)
        const maxLength = 4000;
        if (output.length > maxLength) {
            output = output.substring(0, maxLength) + '\n...[truncated]';
        }

        return {
            success: result.code === 0,
            output,
            error: result.code !== 0 ? `Exit code: ${result.code}` : undefined
        };

    } catch (error) {
        return {
            success: false,
            output: '',
            error: error.message
        };
    }
}

module.exports = {
    name,
    description,
    inputSchema,
    execute
};
