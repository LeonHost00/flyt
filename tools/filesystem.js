/**
 * File System Tools
 * 
 * Tools for reading, writing, and managing files and directories.
 */

const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const os = require('os');
const { BaseTool, ToolResult } = require('./base');

/**
 * Read File Tool
 * Read the contents of a file
 */
class ReadFileTool extends BaseTool {
  constructor() {
    super({
      name: 'read_file',
      displayName: 'Read File',
      description: 'Read the contents of a file. Supports text files. For binary files, returns base64.',
      category: 'filesystem',
      parameters: {
        properties: {
          path: {
            type: 'string',
            description: 'Absolute or relative path to the file'
          },
          encoding: {
            type: 'string',
            description: 'File encoding (default: utf-8). Use "base64" for binary files.'
          },
          start_line: {
            type: 'number',
            description: 'Start reading from this line number (1-indexed)'
          },
          end_line: {
            type: 'number',
            description: 'Stop reading at this line number (inclusive)'
          }
        },
        required: ['path']
      },
      examples: [
        { tool: 'read_file', path: 'C:\\Projects\\app\\package.json' },
        { tool: 'read_file', path: 'config.js', start_line: 1, end_line: 50 }
      ],
      timeout: 10000
    });
  }

  async execute(params, context = {}) {
    let { path: filePath, encoding = 'utf-8', start_line, end_line } = params;

    // Resolve relative paths
    if (!path.isAbsolute(filePath)) {
      filePath = path.resolve(context.cwd || os.homedir(), filePath);
    }

    try {
      // Check if file exists
      const stats = await fs.stat(filePath);
      
      if (!stats.isFile()) {
        return ToolResult.failure(`"${filePath}" is not a file`);
      }

      // Check file size
      const maxSize = 10 * 1024 * 1024; // 10MB
      if (stats.size > maxSize) {
        return ToolResult.failure(
          `File is too large (${(stats.size / 1024 / 1024).toFixed(2)}MB). Maximum: 10MB. Use line ranges for large files.`
        );
      }

      // Read file
      let content;
      if (encoding === 'base64') {
        const buffer = await fs.readFile(filePath);
        content = buffer.toString('base64');
      } else {
        content = await fs.readFile(filePath, encoding);
      }

      // Apply line range filter if specified
      if (start_line || end_line) {
        const lines = content.split('\n');
        const start = Math.max(1, start_line || 1) - 1; // Convert to 0-indexed
        const end = Math.min(lines.length, end_line || lines.length);
        
        const selectedLines = lines.slice(start, end);
        const lineNumbers = selectedLines.map((line, i) => 
          `${String(start + i + 1).padStart(4)} | ${line}`
        );
        content = lineNumbers.join('\n');
      }

      // Truncate if still too long
      const maxChars = 100000;
      if (content.length > maxChars) {
        content = content.substring(0, maxChars) + '\n\n... [content truncated, showing first 100KB]';
      }

      return ToolResult.success(
        content,
        { path: filePath, size: stats.size, lines: content.split('\n').length },
        { encoding, start_line, end_line }
      );

    } catch (error) {
      if (error.code === 'ENOENT') {
        return ToolResult.failure(`File not found: ${filePath}`);
      }
      if (error.code === 'EACCES') {
        return ToolResult.failure(`Permission denied: ${filePath}`);
      }
      return ToolResult.failure(`Failed to read file: ${error.message}`);
    }
  }
}

/**
 * Write File Tool
 * Create or overwrite a file
 */
class WriteFileTool extends BaseTool {
  constructor() {
    super({
      name: 'write_file',
      displayName: 'Write File',
      description: 'Create or overwrite a file with the given content. Creates parent directories if needed.',
      category: 'filesystem',
      parameters: {
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file to write'
          },
          content: {
            type: 'string',
            description: 'Content to write to the file'
          },
          encoding: {
            type: 'string',
            description: 'File encoding (default: utf-8)'
          },
          append: {
            type: 'boolean',
            description: 'Append to file instead of overwriting (default: false)'
          }
        },
        required: ['path', 'content']
      },
      examples: [
        { tool: 'write_file', path: 'hello.txt', content: 'Hello, World!' },
        { tool: 'write_file', path: 'log.txt', content: 'New log entry\n', append: true }
      ],
      requiresConfirmation: true,
      timeout: 10000
    });
  }

  async execute(params, context = {}) {
    let { path: filePath, content, encoding = 'utf-8', append = false } = params;

    // Resolve relative paths
    if (!path.isAbsolute(filePath)) {
      filePath = path.resolve(context.cwd || os.homedir(), filePath);
    }

    try {
      // Create parent directories if they don't exist
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });

      // Check if file exists for reporting
      let existed = false;
      try {
        await fs.access(filePath);
        existed = true;
      } catch {
        existed = false;
      }

      // Write the file
      if (append) {
        await fs.appendFile(filePath, content, encoding);
      } else {
        await fs.writeFile(filePath, content, encoding);
      }

      const stats = await fs.stat(filePath);

      return ToolResult.success(
        `${append ? 'Appended to' : (existed ? 'Updated' : 'Created')} file: ${filePath}\nSize: ${stats.size} bytes`,
        { path: filePath, size: stats.size, existed, append },
        { encoding }
      );

    } catch (error) {
      if (error.code === 'EACCES') {
        return ToolResult.failure(`Permission denied: ${filePath}`);
      }
      return ToolResult.failure(`Failed to write file: ${error.message}`);
    }
  }
}

/**
 * Edit File Tool
 * Make targeted edits to a file using search/replace or line-based operations
 */
class EditFileTool extends BaseTool {
  constructor() {
    super({
      name: 'edit_file',
      displayName: 'Edit File',
      description: 'Edit a file using search/replace OR line-based operations. For search/replace: include enough surrounding context in "search" to make it unique. For line operations: use insert_after_line or delete_lines.',
      category: 'filesystem',
      parameters: {
        properties: {
          path: {
            type: 'string',
            description: 'Path to the file to edit'
          },
          search: {
            type: 'string',
            description: 'Exact text to find (include surrounding lines for uniqueness)'
          },
          replace: {
            type: 'string',
            description: 'Text to replace the search text with'
          },
          all: {
            type: 'boolean',
            description: 'Replace all occurrences (default: false)'
          },
          insert_after_line: {
            type: 'number',
            description: 'Insert new_text after this line number (1-indexed)'
          },
          new_text: {
            type: 'string',
            description: 'Text to insert (used with insert_after_line)'
          },
          delete_lines: {
            type: 'string',
            description: 'Delete line range, e.g., "5" or "5-10" (1-indexed, inclusive)'
          }
        },
        required: ['path']
      },
      examples: [
        { tool: 'edit_file', path: 'config.js', search: 'port: 3000', replace: 'port: 8080' },
        { tool: 'edit_file', path: 'app.js', insert_after_line: 5, new_text: 'const debug = true;' },
        { tool: 'edit_file', path: 'test.js', delete_lines: '10-15' }
      ],
      requiresConfirmation: true,
      timeout: 10000
    });
  }

  async execute(params, context = {}) {
    let { path: filePath, search, replace, all = false, insert_after_line, new_text, delete_lines } = params;

    if (!path.isAbsolute(filePath)) {
      filePath = path.resolve(context.cwd || os.homedir(), filePath);
    }

    try {
      // Read current content
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content.split('\n');
      let newContent;
      let operationDescription;

      // Determine which operation to perform
      if (insert_after_line !== undefined && new_text !== undefined) {
        // LINE INSERT OPERATION
        const lineNum = Math.max(0, Math.min(insert_after_line, lines.length));
        lines.splice(lineNum, 0, new_text);
        newContent = lines.join('\n');
        operationDescription = `Inserted text after line ${lineNum}`;
        
      } else if (delete_lines) {
        // LINE DELETE OPERATION
        const rangeMatch = delete_lines.match(/^(\d+)(?:-(\d+))?$/);
        if (!rangeMatch) {
          return ToolResult.failure('Invalid delete_lines format. Use "5" or "5-10"');
        }
        const startLine = parseInt(rangeMatch[1], 10);
        const endLine = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : startLine;
        
        if (startLine < 1 || endLine > lines.length || startLine > endLine) {
          return ToolResult.failure(`Invalid line range ${startLine}-${endLine}. File has ${lines.length} lines.`);
        }
        
        const deletedLines = lines.splice(startLine - 1, endLine - startLine + 1);
        newContent = lines.join('\n');
        operationDescription = `Deleted lines ${startLine}-${endLine} (${deletedLines.length} lines)`;
        
      } else if (search !== undefined && replace !== undefined) {
        // SEARCH/REPLACE OPERATION
        if (!content.includes(search)) {
          // Provide helpful error with nearby matches
          const searchStart = search.substring(0, 30).trim();
          const possibleMatches = lines
            .map((line, i) => ({ line: i + 1, text: line }))
            .filter(l => l.text.includes(searchStart.substring(0, 15)))
            .slice(0, 3);
          
          let hint = '';
          if (possibleMatches.length > 0) {
            hint = '\n\nPossible matches found at:\n' + possibleMatches
              .map(m => `  Line ${m.line}: "${m.text.substring(0, 60)}..."`)
              .join('\n');
            hint += '\n\nTip: Use read_file with start_line/end_line to see exact content.';
          }
          
          return ToolResult.failure(
            `Search text not found. Ensure exact match including whitespace/indentation.\nSearched for: "${search.substring(0, 100)}${search.length > 100 ? '...' : ''}"${hint}`,
            '',
            { path: filePath }
          );
        }

        const occurrences = content.split(search).length - 1;
        newContent = all 
          ? content.split(search).join(replace)
          : content.replace(search, replace);
        
        const replacedCount = all ? occurrences : 1;
        operationDescription = `Replaced ${replacedCount} occurrence(s)`;
        
      } else {
        return ToolResult.failure('Must provide either: (search + replace), (insert_after_line + new_text), or delete_lines');
      }

      // Write back
      await fs.writeFile(filePath, newContent, 'utf-8');

      return ToolResult.success(
        `Edited ${filePath}\n${operationDescription}`,
        { path: filePath, operation: operationDescription },
        { all }
      );

    } catch (error) {
      if (error.code === 'ENOENT') {
        return ToolResult.failure(`File not found: ${filePath}`);
      }
      return ToolResult.failure(`Failed to edit file: ${error.message}`);
    }
  }
}

/**
 * List Directory Tool
 * List files and directories in a path
 */
class ListDirectoryTool extends BaseTool {
  constructor() {
    super({
      name: 'list_directory',
      displayName: 'List Directory',
      description: 'List files and directories in a given path. Shows file sizes and types.',
      category: 'filesystem',
      parameters: {
        properties: {
          path: {
            type: 'string',
            description: 'Directory path to list (default: current directory)'
          },
          recursive: {
            type: 'boolean',
            description: 'List recursively (default: false)'
          },
          max_depth: {
            type: 'number',
            description: 'Maximum depth for recursive listing (default: 3)'
          },
          show_hidden: {
            type: 'boolean',
            description: 'Show hidden files (starting with dot)'
          }
        },
        required: []
      },
      examples: [
        { tool: 'list_directory', path: 'C:\\Projects\\MyApp' },
        { tool: 'list_directory', path: '.', recursive: true, max_depth: 2 }
      ],
      timeout: 30000
    });
  }

  async execute(params, context = {}) {
    let { path: dirPath = '.', recursive = false, max_depth = 3, show_hidden = false } = params;

    if (!path.isAbsolute(dirPath)) {
      dirPath = path.resolve(context.cwd || os.homedir(), dirPath);
    }

    try {
      const stats = await fs.stat(dirPath);
      if (!stats.isDirectory()) {
        return ToolResult.failure(`"${dirPath}" is not a directory`);
      }

      const items = [];
      const maxItems = 1000;

      const listDir = async (currentPath, depth = 0, prefix = '') => {
        if (items.length >= maxItems) return;
        if (depth > max_depth) return;

        const entries = await fs.readdir(currentPath, { withFileTypes: true });
        
        // Sort: directories first, then files
        entries.sort((a, b) => {
          if (a.isDirectory() === b.isDirectory()) {
            return a.name.localeCompare(b.name);
          }
          return a.isDirectory() ? -1 : 1;
        });

        for (const entry of entries) {
          if (items.length >= maxItems) break;

          // Skip hidden files if not requested
          if (!show_hidden && entry.name.startsWith('.')) continue;

          const fullPath = path.join(currentPath, entry.name);
          let size = '';
          let type = '';

          try {
            const entryStats = await fs.stat(fullPath);
            if (entryStats.isDirectory()) {
              type = '[DIR]';
            } else {
              type = '';
              size = this.formatSize(entryStats.size);
            }
          } catch {
            type = '[?]';
          }

          items.push(`${prefix}${entry.name}${type ? ' ' + type : ''} ${size}`.trim());

          if (recursive && entry.isDirectory()) {
            await listDir(fullPath, depth + 1, prefix + '  ');
          }
        }
      };

      await listDir(dirPath);

      const truncated = items.length >= maxItems;
      const output = items.join('\n') + (truncated ? '\n\n... [listing truncated at 1000 items]' : '');

      return ToolResult.success(
        `Contents of ${dirPath}:\n\n${output}`,
        { path: dirPath, count: items.length, truncated },
        { recursive, max_depth, show_hidden }
      );

    } catch (error) {
      if (error.code === 'ENOENT') {
        return ToolResult.failure(`Directory not found: ${dirPath}`);
      }
      if (error.code === 'EACCES') {
        return ToolResult.failure(`Permission denied: ${dirPath}`);
      }
      return ToolResult.failure(`Failed to list directory: ${error.message}`);
    }
  }

  formatSize(bytes) {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
    return `${(bytes / 1024 / 1024 / 1024).toFixed(1)}GB`;
  }
}

/**
 * Search Files Tool
 * Search for files by name or content
 */
class SearchFilesTool extends BaseTool {
  constructor() {
    super({
      name: 'search_files',
      displayName: 'Search Files',
      description: 'Search for files by name pattern or content text. Note: Automatically skips hidden files (.*), node_modules, and .git directories for performance.',
      category: 'filesystem',
      parameters: {
        properties: {
          path: {
            type: 'string',
            description: 'Directory to search in'
          },
          pattern: {
            type: 'string',
            description: 'File name pattern (glob-style: *.js, test*.py)'
          },
          content: {
            type: 'string',
            description: 'Search for files containing this text'
          },
          max_results: {
            type: 'number',
            description: 'Maximum number of results (default: 50)'
          },
          include_hidden: {
            type: 'boolean',
            description: 'Include hidden files/dirs starting with . (default: false)'
          }
        },
        required: ['path']
      },
      examples: [
        { tool: 'search_files', path: 'C:\\Projects', pattern: '*.json' },
        { tool: 'search_files', path: '.', content: 'TODO:', max_results: 20 }
      ],
      timeout: 60000
    });
  }

  async execute(params, context = {}) {
    let { path: searchPath, pattern, content, max_results = 50, include_hidden = false } = params;

    if (!pattern && !content) {
      return ToolResult.failure('Must provide either "pattern" or "content" to search for');
    }

    if (!path.isAbsolute(searchPath)) {
      searchPath = path.resolve(context.cwd || os.homedir(), searchPath);
    }

    try {
      const results = [];
      const maxDepth = 10;
      // Directories to always skip for performance
      const skipDirs = ['node_modules', '.git', '__pycache__', '.venv', 'venv', 'dist', 'build'];

      const matchPattern = (filename, pat) => {
        const regex = new RegExp(
          '^' + pat.replace(/\./g, '\\.').replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
          'i'
        );
        return regex.test(filename);
      };

      const searchDir = async (currentPath, depth = 0) => {
        if (results.length >= max_results || depth > maxDepth) return;

        try {
          const entries = await fs.readdir(currentPath, { withFileTypes: true });

          for (const entry of entries) {
            if (results.length >= max_results) break;
            // Skip hidden files unless explicitly included
            if (!include_hidden && entry.name.startsWith('.')) continue;
            // Always skip common large directories
            if (skipDirs.includes(entry.name)) continue;

            const fullPath = path.join(currentPath, entry.name);

            if (entry.isDirectory()) {
              await searchDir(fullPath, depth + 1);
            } else {
              // Check pattern match
              if (pattern && !matchPattern(entry.name, pattern)) continue;

              // Check content match
              if (content) {
                try {
                  const fileContent = await fs.readFile(fullPath, 'utf-8');
                  if (!fileContent.includes(content)) continue;
                  
                  // Find matching lines
                  const lines = fileContent.split('\n');
                  const matchingLines = [];
                  for (let i = 0; i < lines.length && matchingLines.length < 3; i++) {
                    if (lines[i].includes(content)) {
                      matchingLines.push({ line: i + 1, text: lines[i].trim().substring(0, 100) });
                    }
                  }
                  
                  results.push({
                    path: fullPath,
                    matches: matchingLines
                  });
                } catch {
                  // Skip files that can't be read as text
                  continue;
                }
              } else {
                results.push({ path: fullPath });
              }
            }
          }
        } catch {
          // Skip directories we can't access
        }
      };

      await searchDir(searchPath);

      if (results.length === 0) {
        return ToolResult.success(
          `No files found matching criteria in ${searchPath}`,
          { count: 0, pattern, content }
        );
      }

      let output = `Found ${results.length} file(s)${results.length >= max_results ? ' (limit reached)' : ''}:\n\n`;
      
      for (const result of results) {
        output += `📄 ${result.path}\n`;
        if (result.matches) {
          for (const match of result.matches) {
            output += `   Line ${match.line}: ${match.text}\n`;
          }
        }
      }

      return ToolResult.success(output, { count: results.length, results });

    } catch (error) {
      return ToolResult.failure(`Search failed: ${error.message}`);
    }
  }
}

/**
 * Delete File/Directory Tool
 */
class DeleteTool extends BaseTool {
  constructor() {
    super({
      name: 'delete',
      displayName: 'Delete File/Directory',
      description: 'Delete a file or directory. Use with caution - this is permanent!',
      category: 'filesystem',
      parameters: {
        properties: {
          path: {
            type: 'string',
            description: 'Path to delete'
          },
          recursive: {
            type: 'boolean',
            description: 'Delete directories recursively (required for non-empty dirs)'
          }
        },
        required: ['path']
      },
      examples: [
        { tool: 'delete', path: 'temp.txt' },
        { tool: 'delete', path: 'node_modules', recursive: true }
      ],
      requiresConfirmation: true,
      timeout: 60000
    });
  }

  async execute(params, context = {}) {
    let { path: targetPath, recursive = false } = params;

    if (!path.isAbsolute(targetPath)) {
      targetPath = path.resolve(context.cwd || os.homedir(), targetPath);
    }

    // Safety checks
    const safePaths = [os.homedir(), 'C:\\', 'C:\\Windows', 'C:\\Program Files', '/', '/home', '/etc', '/usr'];
    for (const safePath of safePaths) {
      if (path.normalize(targetPath).toLowerCase() === path.normalize(safePath).toLowerCase()) {
        return ToolResult.failure(`Cannot delete protected path: ${targetPath}`);
      }
    }

    try {
      const stats = await fs.stat(targetPath);
      
      if (stats.isDirectory()) {
        if (recursive) {
          await fs.rm(targetPath, { recursive: true, force: true });
          return ToolResult.success(`Deleted directory recursively: ${targetPath}`);
        } else {
          await fs.rmdir(targetPath);
          return ToolResult.success(`Deleted empty directory: ${targetPath}`);
        }
      } else {
        await fs.unlink(targetPath);
        return ToolResult.success(`Deleted file: ${targetPath}`);
      }

    } catch (error) {
      if (error.code === 'ENOENT') {
        return ToolResult.failure(`Path not found: ${targetPath}`);
      }
      if (error.code === 'ENOTEMPTY') {
        return ToolResult.failure(`Directory not empty. Use recursive: true to delete.`);
      }
      return ToolResult.failure(`Failed to delete: ${error.message}`);
    }
  }
}

module.exports = {
  ReadFileTool,
  WriteFileTool,
  EditFileTool,
  ListDirectoryTool,
  SearchFilesTool,
  DeleteTool
};
