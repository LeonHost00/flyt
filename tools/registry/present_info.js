/**
 * Present Info Tool
 * 
 * Allows the agent to present information, plans, or summaries to the user in a rich format.
 * This is useful for showing execution plans, summaries, or structured data before proceeding.
 */

module.exports = {
    name: 'present_info',
    description: 'Present information to the user in a structured, rich format. Use this to display execution plans, summaries, or complex data that is better viewed as a list, steps, or formatted text. This tool waits for the user to acknowledge (click "OK") before returning.',
    inputSchema: {
        type: 'object',
        properties: {
            title: {
                type: 'string',
                description: 'The title of the presentation window.'
            },
            content: {
                type: 'string',
                description: 'The main content text. Required for "text" and "markdown" styles. Optional for others.'
            },
            items: {
                type: 'array',
                items: {
                    type: 'string'
                },
                description: 'List of items. Required for "list" and "steps" styles.'
            },
            data: {
                type: 'object',
                description: 'Key-value pairs. Required for "table" style.'
            },
            style: {
                type: 'string',
                enum: ['text', 'markdown', 'list', 'steps', 'table'],
                description: 'The visual style to use. "steps" is great for execution plans. "markdown" allows rich formatting. "table" is good for key-value data.',
                default: 'markdown'
            }
        },
        required: ['title']
    },
    execute: async ({ title, content, items, data, style = 'markdown' }, context) => {
        if (!context.presentInfo) {
            return {
                success: false,
                output: '',
                error: 'User interface interaction is not available in this context.'
            };
        }

        try {
            await context.presentInfo({ title, content, items, data, style });
            return {
                success: true,
                output: 'User acknowledged the information.'
            };
        } catch (error) {
            return {
                success: false,
                output: '',
                error: `Failed to present info: ${error.message}`
            };
        }
    }
};
