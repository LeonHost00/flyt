/**
 * search_files Tool - Search for Files by Pattern
 * 
 * Searches for files matching a glob pattern.
 */

const fs = require('fs');
const path = require('path');

const name = 'search_files';
const description = 'Search for files matching a pattern in a directory. Supports glob patterns like *.js, **/*.txt, etc.';

const inputSchema = {
    type: 'object',
    properties: {
        directory: {
            type: 'string',
            description: 'Directory to search in'
        },
        pattern: {
            type: 'string',
            description: 'Search pattern (glob-style: *.js, **/*.txt, etc.)'
        },
        maxResults: {
            type: 'number',
            description: 'Maximum number of results to return (default: 50)'
        }
    },
    required: ['directory', 'pattern']
};

/**
 * Convert glob pattern to regex
 */
function globToRegex(pattern) {
    let regex = pattern
        .replace(/\./g, '\\.')      // Escape dots
        .replace(/\*\*/g, '{{GLOBSTAR}}')  // Placeholder for **
        .replace(/\*/g, '[^/\\\\]*')       // * matches anything except path separators
        .replace(/\?/g, '[^/\\\\]')        // ? matches single char except path separator
        .replace(/{{GLOBSTAR}}/g, '.*');   // ** matches everything including path separators

    return new RegExp(`^${regex}$`, 'i');
}

/**
 * Recursively search for files
 */
function searchDir(dirPath, regex, results, maxResults, basePath) {
    if (results.length >= maxResults) return;

    try {
        const items = fs.readdirSync(dirPath);

        for (const item of items) {
            if (results.length >= maxResults) break;

            const fullPath = path.join(dirPath, item);
            const relativePath = path.relative(basePath, fullPath);

            try {
                const stats = fs.statSync(fullPath);

                if (stats.isDirectory()) {
                    // Skip node_modules and hidden directories
                    if (item !== 'node_modules' && !item.startsWith('.')) {
                        searchDir(fullPath, regex, results, maxResults, basePath);
                    }
                } else if (stats.isFile()) {
                    // Test against pattern (check both filename and relative path)
                    const fileName = path.basename(relativePath);
                    if (regex.test(fileName) || regex.test(relativePath.replace(/\\/g, '/'))) {
                        results.push({
                            path: relativePath,
                            size: stats.size
                        });
                    }
                }
            } catch (err) {
                // Skip inaccessible entries
            }
        }
    } catch (err) {
        // Directory read error
    }
}

async function execute(params, context = {}) {
    const { directory, pattern, maxResults = 50 } = params;
    const resolvedPath = path.isAbsolute(directory)
        ? directory
        : path.resolve(context.cwd || process.cwd(), directory);

    try {
        // Check if path exists
        if (!fs.existsSync(resolvedPath)) {
            return {
                success: false,
                output: '',
                error: `Directory not found: ${resolvedPath}`
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

        // Convert pattern to regex and search
        const regex = globToRegex(pattern);
        const results = [];
        searchDir(resolvedPath, regex, results, maxResults, resolvedPath);

        // Format output
        if (results.length === 0) {
            return {
                success: true,
                output: `No files found matching pattern: ${pattern}`
            };
        }

        let output = `Found ${results.length} file(s) matching "${pattern}":\n${'─'.repeat(40)}\n`;
        for (const result of results) {
            output += `📄 ${result.path}\n`;
        }

        if (results.length >= maxResults) {
            output += `\n...[limited to ${maxResults} results]`;
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
