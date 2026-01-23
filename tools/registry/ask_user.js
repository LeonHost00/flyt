/**
 * User Input Tool
 * 
 * Allows the agent to ask the user for input or a choice.
 */

module.exports = {
    name: 'ask_user',
    description: 'Ask the user for input or a decision. Use this when you need clarification, confirmation, or creative input from the user. You can request simple text input or offer a set of options.',
    inputSchema: {
        type: 'object',
        properties: {
            prompt: {
                type: 'string',
                description: 'The question or prompt to display to the user.'
            },
            type: {
                type: 'string',
                enum: ['text', 'select'],
                description: 'The type of input to request. "text" for free-form text, "select" for multiple choice.',
                default: 'text'
            },
            options: {
                type: 'array',
                items: {
                    type: 'string'
                },
                description: 'List of options to choose from (only valid when type is "select").'
            }
        },
        required: ['prompt']
    },
    execute: async ({ prompt, type = 'text', options = [] }, context) => {
        if (!context.askUser) {
            return {
                success: false,
                output: '',
                error: 'User interaction is not available in this context.'
            };
        }

        try {
            const response = await context.askUser(prompt, type, options);
            return {
                success: true,
                output: response
            };
        } catch (error) {
            return {
                success: false,
                output: '',
                error: `Failed to get user input: ${error.message}`
            };
        }
    }
};
