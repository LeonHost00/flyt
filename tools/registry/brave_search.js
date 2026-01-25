/**
 * brave_search Tool - Web Search via Brave Search API
 * 
 * Performs web searches using the Brave Search API.
 * Requires BRAVE_SEARCH_API_KEY environment variable.
 */

const https = require('https');

const name = 'brave_search';
const description = 'Search the web using Brave Search. Returns titles, URLs, and snippets from search results. Requires BRAVE_SEARCH_API_KEY environment variable.';

const inputSchema = {
    type: 'object',
    properties: {
        query: {
            type: 'string',
            description: 'Search query'
        },
        count: {
            type: 'number',
            description: 'Number of results to return (default: 5, max: 20)'
        }
    },
    required: ['query']
};

/**
 * Make HTTPS request
 */
function httpsRequest(options) {
    return new Promise((resolve, reject) => {
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, data: JSON.parse(data) });
                } catch (e) {
                    resolve({ status: res.statusCode, data: data });
                }
            });
        });
        req.on('error', reject);
        req.end();
    });
}

async function execute(params, context = {}) {
    const { query, count = 5 } = params;
    const apiKey = context.braveApiKey || process.env.BRAVE_SEARCH_API_KEY;

    if (!apiKey) {
        return {
            success: false,
            output: '',
            error: 'Brave Search API key is not configured. Please set it in Supabase or environment variable.'
        };
    }

    try {
        const resultCount = Math.min(Math.max(1, count), 20);
        const searchParams = new URLSearchParams({
            q: query,
            count: resultCount.toString()
        });

        const options = {
            hostname: 'api.search.brave.com',
            path: `/res/v1/web/search?${searchParams.toString()}`,
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'X-Subscription-Token': apiKey
            }
        };

        const response = await httpsRequest(options);

        if (response.status !== 200) {
            return {
                success: false,
                output: '',
                error: `Brave Search API error: ${response.status} - ${JSON.stringify(response.data)}`
            };
        }

        const results = response.data.web?.results || [];

        if (results.length === 0) {
            return {
                success: true,
                output: `No results found for: "${query}"`
            };
        }

        // Format results
        let output = `Search results for: "${query}"\n${'─'.repeat(40)}\n\n`;

        for (let i = 0; i < results.length; i++) {
            const result = results[i];
            output += `${i + 1}. ${result.title}\n`;
            output += `   URL: ${result.url}\n`;
            if (result.description) {
                output += `   ${result.description}\n`;
            }
            output += '\n';
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
