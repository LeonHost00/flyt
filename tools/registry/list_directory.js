/**
 * list_directory Tool - List Directory Contents
 * 
 * Lists files and subdirectories with metadata.
 */

const fs = require('fs');
const path = require('path');

const name = 'list_directory';
const description = 'List the contents of a directory. Returns file names, types (file/directory), and sizes. Can optionally list recursively.';

const inputSchema = {
    type: 'object',
    properties: {
        path: {
            type: 'string',
            description: 'Absolute or relative path to the directory to list'
        },
        recursive: {
            type: 'boolean',
            description: 'List recursively (default: false)'
        },
        maxDepth: {
            type: 'number',
            description: 'Maximum depth for recursive listing (default: 3)'
        }
    },
    required: ['path']
};

/**
 * Format file size in human-readable format
 */
function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

/**
 * List directory entries
 */
function listDir(dirPath, depth, maxDepth, basePath) {
    const entries = [];

    try {
        const items = fs.readdirSync(dirPath);

        for (const item of items) {
            const fullPath = path.join(dirPath, item);
            const relativePath = path.relative(basePath, fullPath);

            try {
                const stats = fs.statSync(fullPath);
                const isDir = stats.isDirectory();

                entries.push({
                    name: relativePath,
                    type: isDir ? 'directory' : 'file',
                    size: isDir ? null : stats.size
                });

                // Recurse into directories if needed
                if (isDir && depth < maxDepth) {
                    const subEntries = listDir(fullPath, depth + 1, maxDepth, basePath);
                    entries.push(...subEntries);
                }
            } catch (err) {
                // Skip entries we can't access
                entries.push({
                    name: relativePath,
                    type: 'unknown',
                    error: err.code
                });
            }
        }
    } catch (err) {
        // Directory read error
    }

    return entries;
}

async function execute(params, context = {}) {
    const { path: dirPath, recursive = false, maxDepth = 3 } = params;
    const resolvedPath = path.isAbsolute(dirPath)
        ? dirPath
        : path.resolve(context.cwd || process.cwd(), dirPath);

    try {
        // Check if path exists
        if (!fs.existsSync(resolvedPath)) {
            return {
                success: false,
                output: '',
                error: `Path not found: ${resolvedPath}`
            };
        }

        // Check if it's a directory
        const stats = fs.statSync(resolvedPath);
        if (!stats.isDirectory()) {
            return {
                success: false,
                output: '',
                error: `Path is not a directory: ${resolvedPath}`
            };
        }

        // List directory contents
        const depth = recursive ? maxDepth : 0;
        const entries = listDir(resolvedPath, 0, depth, resolvedPath);

        // Format output
        let output = `Directory: ${resolvedPath}\nTotal entries: ${entries.length}\n${'─'.repeat(40)}\n`;

        for (const entry of entries) {
            const typeIcon = entry.type === 'directory' ? '📁' : '📄';
            const sizeStr = entry.size !== null ? ` (${formatSize(entry.size)})` : '';
            output += `${typeIcon} ${entry.name}${sizeStr}\n`;
        }

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
