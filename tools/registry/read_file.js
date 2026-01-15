/**
 * read_file Tool - Read File Contents
 * 
 * Reads the contents of a file with optional line range support.
 */

const fs = require('fs');
const path = require('path');

const name = 'read_file';
const description = 'Read the contents of a file. Can optionally specify a line range. Returns file contents with line numbers.';

const inputSchema = {
    type: 'object',
    properties: {
        path: {
            type: 'string',
            description: 'Absolute or relative path to the file to read'
        },
        startLine: {
            type: 'number',
            description: 'Starting line number (1-indexed, optional)'
        },
        endLine: {
            type: 'number',
            description: 'Ending line number (1-indexed, inclusive, optional)'
        }
    },
    required: ['path']
};

async function execute(params, context = {}) {
    const { path: filePath, startLine, endLine } = params;
    const resolvedPath = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(context.cwd || process.cwd(), filePath);

    try {
        // Check if file exists
        if (!fs.existsSync(resolvedPath)) {
            return {
                success: false,
                output: '',
                error: `File not found: ${resolvedPath}`
            };
        }

        // Check if it's a file
        const stats = fs.statSync(resolvedPath);
        if (stats.isDirectory()) {
            return {
                success: false,
                output: '',
                error: `Path is a directory, not a file: ${resolvedPath}`
            };
        }

        // Read file content
        const content = fs.readFileSync(resolvedPath, 'utf-8');
        const lines = content.split('\n');

        // Apply line range if specified
        let start = startLine ? Math.max(1, startLine) : 1;
        let end = endLine ? Math.min(lines.length, endLine) : lines.length;

        // Validate range
        if (start > lines.length) {
            return {
                success: false,
                output: '',
                error: `Start line ${start} exceeds file length (${lines.length} lines)`
            };
        }

        // Extract requested lines with line numbers
        const selectedLines = lines.slice(start - 1, end);
        let output = selectedLines
            .map((line, idx) => `${start + idx}: ${line}`)
            .join('\n');

        // Add file info header
        const header = `File: ${resolvedPath}\nLines: ${start}-${end} of ${lines.length}\n${'─'.repeat(40)}\n`;
        output = header + output;

        // Truncate if too long
        const maxLength = 4000;
        if (output.length > maxLength) {
            output = output.substring(0, maxLength) + '\n...[truncated]';
        }

        return {
            success: true,
            output
        };

    } catch (error) {
        return {
            success: false,
            output: '',
            error: error.message
        };
    }
}

module.exports = { name, description, inputSchema, execute };
