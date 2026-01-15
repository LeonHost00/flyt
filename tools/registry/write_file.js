/**
 * write_file Tool - Write/Create Files
 * 
 * Creates or overwrites files with the provided content.
 */

const fs = require('fs');
const path = require('path');

const name = 'write_file';
const description = 'Write content to a file. Creates the file if it doesn\'t exist, or overwrites if it does. Can optionally create parent directories.';

const inputSchema = {
    type: 'object',
    properties: {
        path: {
            type: 'string',
            description: 'Absolute or relative path to the file to write'
        },
        content: {
            type: 'string',
            description: 'Content to write to the file'
        },
        createDirectories: {
            type: 'boolean',
            description: 'Create parent directories if they don\'t exist (default: true)'
        }
    },
    required: ['path', 'content']
};

async function execute(params, context = {}) {
    const { path: filePath, content, createDirectories = true } = params;
    const resolvedPath = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(context.cwd || process.cwd(), filePath);

    try {
        // Create parent directories if needed
        const dirPath = path.dirname(resolvedPath);
        if (createDirectories && !fs.existsSync(dirPath)) {
            fs.mkdirSync(dirPath, { recursive: true });
        }

        // Check if directory exists
        if (!fs.existsSync(dirPath)) {
            return {
                success: false,
                output: '',
                error: `Parent directory does not exist: ${dirPath}`
            };
        }

        // Write the file
        fs.writeFileSync(resolvedPath, content, 'utf-8');

        // Get file stats for confirmation
        const stats = fs.statSync(resolvedPath);
        const lineCount = content.split('\n').length;

        return {
            success: true,
            output: `Successfully wrote to: ${resolvedPath}\nSize: ${stats.size} bytes\nLines: ${lineCount}`
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
