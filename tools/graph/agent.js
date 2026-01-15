/**
 * LangGraph Agent - Agentic Loop with Tool Execution
 * 
 * Uses LangGraph StateGraph to manage the agent loop.
 * Now integrates with the modular tool registry.
 */

const { StateGraph, END, START } = require('@langchain/langgraph');
const { ChatOpenAI } = require('@langchain/openai');
const { HumanMessage, AIMessage, SystemMessage, ToolMessage } = require('@langchain/core/messages');

// Use the registry for tool definitions and execution
const registry = require('../registry');

/**
 * Create a configured agent graph
 * @param {Object} config
 * @param {string} config.apiKey - OpenRouter API key
 * @param {string} config.model - Model identifier (e.g., 'openai/gpt-4o-mini')
 * @param {Function} config.onToolProgress - Callback for tool progress updates
 * @param {Object} config.context - Execution context (user, cwd, etc.)
 * @returns {CompiledGraph}
 */
function createAgent(config) {
    const { apiKey, model, onToolProgress, context = {} } = config;

    // Load tools from registry
    const toolDefinitions = registry.getToolDefinitionsForLLM();
    const toolNames = registry.getToolNames();

    // Configure LLM to use OpenRouter
    const llm = new ChatOpenAI({
        model: model,
        apiKey: apiKey,
        configuration: {
            baseURL: 'https://openrouter.ai/api/v1',
            defaultHeaders: {
                'HTTP-Referer': 'https://flyt-app.local',
                'X-Title': 'Flyt'
            }
        },
        temperature: 0.7,
        maxTokens: 4096
    }).bindTools(toolDefinitions);

    // Define the graph state
    const graphState = {
        messages: {
            value: (prev, next) => next,
            default: () => []
        },
        iteration: {
            value: (prev, next) => next,
            default: () => 0
        },
        toolExecutions: {
            value: (prev, next) => next,
            default: () => []
        },
        usage: {
            value: (prev, next) => next,
            default: () => null
        }
    };

    // Agent node: calls the LLM
    async function callModel(state) {
        const { messages, iteration } = state;

        console.log(`\n========== AGENT CALL (Iteration ${iteration + 1}) ==========`);
        console.log('Messages count:', messages.length);
        console.log('Available tools:', toolNames.join(', '));

        const response = await llm.invoke(messages);

        console.log('\n--- LLM Response ---');
        console.log('Content:', response.content?.substring(0, 200) || '[empty]');
        console.log('Tool calls:', response.tool_calls?.length || 0);

        return {
            messages: [...messages, response],
            iteration: iteration + 1,
            usage: response.response_metadata?.usage || null
        };
    }

    // Tool node: executes tool calls using registry
    async function executeTools(state) {
        const { messages, toolExecutions } = state;
        const lastMessage = messages[messages.length - 1];

        if (!lastMessage.tool_calls || lastMessage.tool_calls.length === 0) {
            return state;
        }

        const newMessages = [...messages];
        const newToolExecutions = [...toolExecutions];

        for (const toolCall of lastMessage.tool_calls) {
            const { name, args, id } = toolCall;

            console.log(`\n========== TOOL EXECUTION ==========`);
            console.log('Tool:', name);
            console.log('Args:', JSON.stringify(args, null, 2));

            // Execute via registry
            const result = await registry.executeTool(name, args, context);

            console.log('Success:', result.success);
            console.log('Output:', result.output?.substring(0, 200) || '[empty]');

            // Track execution
            newToolExecutions.push({
                tool: name,
                params: args,
                output: result.output,
                success: result.success,
                error: result.error
            });

            // Notify progress if callback provided
            if (onToolProgress) {
                onToolProgress({
                    tool: name,
                    params: args,
                    output: result.output,
                    success: result.success,
                    error: result.error,
                    iteration: state.iteration
                });
            }

            // Add tool result message
            newMessages.push(new ToolMessage({
                tool_call_id: id,
                content: result.success ? result.output : `Error: ${result.error}\n${result.output}`
            }));
        }

        return {
            messages: newMessages,
            toolExecutions: newToolExecutions
        };
    }

    // Conditional edge: should we continue?
    function shouldContinue(state) {
        const { messages, iteration } = state;
        const lastMessage = messages[messages.length - 1];

        // Max 15 iterations safety
        if (iteration >= 15) {
            console.log('Max iterations reached, ending.');
            return 'end';
        }

        // If last message has tool calls, execute them
        if (lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
            return 'tools';
        }

        // Otherwise, we're done
        return 'end';
    }

    // Build the graph
    const graph = new StateGraph({ channels: graphState })
        .addNode('agent', callModel)
        .addNode('tools', executeTools)
        .addEdge(START, 'agent')
        .addConditionalEdges('agent', shouldContinue, {
            tools: 'tools',
            end: END
        })
        .addEdge('tools', 'agent');

    return graph.compile();
}

/**
 * Convert conversation history to LangChain message format
 * @param {Array} messages - Messages in OpenAI format
 * @returns {Array} - LangChain messages
 */
function convertMessages(messages) {
    return messages.map(msg => {
        if (msg.role === 'system') {
            return new SystemMessage(msg.content);
        } else if (msg.role === 'user') {
            return new HumanMessage(msg.content);
        } else if (msg.role === 'assistant') {
            return new AIMessage(msg.content || '');
        } else if (msg.role === 'tool') {
            return new ToolMessage({
                tool_call_id: msg.tool_call_id || 'unknown',
                content: msg.content
            });
        }
        return new HumanMessage(msg.content);
    });
}

/**
 * Run the agent with given messages
 * @param {Object} options
 * @param {Array} options.messages - Conversation history
 * @param {string} options.apiKey - OpenRouter API key
 * @param {string} options.model - Model identifier
 * @param {Function} options.onToolProgress - Progress callback
 * @param {Object} options.context - Execution context
 * @returns {Promise<Object>} - Agent result
 */
async function runAgent(options) {
    const { messages, apiKey, model, onToolProgress, context } = options;

    const agent = createAgent({
        apiKey,
        model,
        onToolProgress,
        context
    });

    const langchainMessages = convertMessages(messages);

    const result = await agent.invoke({
        messages: langchainMessages,
        iteration: 0,
        toolExecutions: [],
        usage: null
    });

    // Extract final response
    const finalMessages = result.messages;
    const lastAIMessage = [...finalMessages].reverse().find(m => m._getType() === 'ai');

    return {
        message: lastAIMessage?.content || '',
        toolExecutions: result.toolExecutions,
        usage: result.usage,
        iterations: result.iteration
    };
}

module.exports = {
    createAgent,
    runAgent,
    convertMessages
};
