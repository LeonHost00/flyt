/**
 * fetch_url Tool - Fetch URL Content
 * 
 * Fetches a URL and converts HTML to Markdown using axios and turndown.
 */

const axios = require('axios');
const TurndownService = require('turndown');

const name = 'fetch_url';
const description = 'Fetch the content of a URL and convert HTML to readable Markdown. Useful for reading documentation, articles, and web pages.';

const inputSchema = {
    type: 'object',
    properties: {
        url: {
            type: 'string',
            description: 'The URL to fetch'
        },
        timeout: {
            type: 'number',
            description: 'Request timeout in milliseconds (default: 10000)'
        }
    },
    required: ['url']
};

// Configure Turndown for clean markdown output
const turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-'
});

// Remove script, style, nav, footer, and other non-content elements
turndown.remove(['script', 'style', 'nav', 'footer', 'header', 'aside', 'noscript', 'iframe']);

// Simplify links
turndown.addRule('simplifyLinks', {
    filter: 'a',
    replacement: function (content, node) {
        const href = node.getAttribute('href');
        if (!href || href.startsWith('#') || href.startsWith('javascript:')) {
            return content;
        }
        return `[${content}](${href})`;
    }
});

async function execute(params, context = {}) {
    const { url, timeout = 10000 } = params;

    // Validate URL
    try {
        new URL(url);
    } catch (e) {
        return {
            success: false,
            output: '',
            error: `Invalid URL: ${url}`
        };
    }

    try {
        const response = await axios.get(url, {
            timeout,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5'
            },
            maxRedirects: 5,
            validateStatus: (status) => status < 400
        });

        const contentType = response.headers['content-type'] || '';

        // Handle non-HTML responses
        if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
            // For JSON, return formatted
            if (contentType.includes('application/json')) {
                let output = `Content-Type: ${contentType}\n${'─'.repeat(40)}\n`;
                output += JSON.stringify(response.data, null, 2);

                const maxLength = 4000;
                if (output.length > maxLength) {
                    output = output.substring(0, maxLength) + '\n...[truncated]';
                }

                return { success: true, output };
            }

            // For plain text
            if (contentType.includes('text/plain')) {
                let output = response.data.toString();
                const maxLength = 4000;
                if (output.length > maxLength) {
                    output = output.substring(0, maxLength) + '\n...[truncated]';
                }
                return { success: true, output };
            }

            return {
                success: false,
                output: '',
                error: `Unsupported content type: ${contentType}`
            };
        }

        // Convert HTML to Markdown
        const html = response.data;
        let markdown = turndown.turndown(html);

        // Clean up the markdown
        markdown = markdown
            .replace(/\n{3,}/g, '\n\n')           // Remove excessive newlines
            .replace(/^\s+$/gm, '')                // Remove whitespace-only lines
            .replace(/\[([^\]]*)\]\(\)/g, '$1')    // Remove empty links
            .trim();

        // Add header with URL
        let output = `Source: ${url}\n${'─'.repeat(40)}\n\n${markdown}`;

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
        let errorMessage = error.message;

        if (error.response) {
            errorMessage = `HTTP ${error.response.status}: ${error.response.statusText}`;
        } else if (error.code === 'ECONNABORTED') {
            errorMessage = `Request timed out after ${timeout}ms`;
        } else if (error.code === 'ENOTFOUND') {
            errorMessage = `Could not resolve host: ${new URL(url).hostname}`;
        }

        return {
            success: false,
            output: '',
            error: errorMessage
        };
    }
}

module.exports = { name, description, inputSchema, execute };
