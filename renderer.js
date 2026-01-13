// ===== GLOBAL ERROR HANDLERS =====
// Catch unhandled errors to prevent silent UI crashes
window.onerror = function (message, source, lineno, colno, error) {
    console.error('Unhandled error:', { message, source, lineno, colno, error });
    return false; // Let default handler also run
};

window.addEventListener('unhandledrejection', function (event) {
    console.error('Unhandled promise rejection:', event.reason);
});

// DOM Elements
const loadingOverlay = document.getElementById('loading-overlay');
const userAvatar = document.getElementById('user-avatar');
const userEmail = document.getElementById('user-email');
const logoutBtn = document.getElementById('logout-btn');

// Token Elements
const tokenBalance = document.getElementById('token-balance');
const tokenCount = document.getElementById('token-count');

// Chat Elements
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const chatSendBtn = document.getElementById('chat-send-btn');
const clearChatBtn = document.getElementById('clear-chat-btn');

// Snipping Elements
const snipBtn = document.getElementById('snip-btn');
const attachedImagesContainer = document.getElementById('attached-images');
const imageModal = document.getElementById('image-modal');
const modalImage = document.getElementById('modal-image');
const modalCloseBtn = document.getElementById('modal-close-btn');

// Custom prompt stored in localStorage
let customPromptValue = localStorage.getItem('flyt-custom-prompt') || '';

// Chat state
let conversationHistory = [];
let isTyping = false;
let systemInfo = null;
let currentUserData = null;

// Attached images for current message
let attachedImages = [];

// Token state
let currentTokens = 0;

// System prompt (fetched from Supabase)
let systemPromptFromServer = null;

// Initialize the app
async function initialize() {
    try {
        // Set up auth status listener
        window.authAPI.onStatusChanged((data) => {
            console.log('Auth status changed:', data);
            if (data.loggedIn && data.user) {
                displayUserInfo(data.user);
                fetchTokenBalance();
            } else if (data.loggedIn === false) {
                // Logged out, redirect to auth
                window.authAPI.logoutAndShowAuth();
            }
        });

        // Get current user info
        const result = await window.authAPI.getUser();

        if (result.success && result.user) {
            displayUserInfo(result.user);
            // Fetch token balance
            await fetchTokenBalance();
        } else {
            // No valid session, redirect to auth
            console.log('No valid session found');
            await window.authAPI.logoutAndShowAuth();
            return;
        }
    } catch (error) {
        console.error('Failed to initialize:', error);
    } finally {
        // Hide loading overlay
        loadingOverlay.classList.add('hidden');
    }
}

// Display user information
function displayUserInfo(user) {
    currentUserData = user;
    if (user.email) {
        userEmail.textContent = user.email;
        
        // Try to get profile picture from user_metadata (Supabase/Google)
        const avatarUrl = user.user_metadata?.avatar_url;
        
        if (avatarUrl) {
            userAvatar.innerHTML = `<img src="${avatarUrl}" alt="Avatar" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
            userAvatar.style.padding = '0';
            userAvatar.style.background = 'transparent';
        } else {
            // Create avatar initials from email
            const initials = user.email.charAt(0).toUpperCase();
            userAvatar.textContent = initials;
            userAvatar.style.padding = '';
            userAvatar.style.background = '';
        }
    }
}

// ===== TOKEN FUNCTIONS =====

// Fetch and display token balance
async function fetchTokenBalance() {
    try {
        tokenBalance.classList.add('updating');
        const result = await window.tokenAPI.getBalance();

        if (result.success) {
            currentTokens = result.tokens;
            updateTokenDisplay(result.tokens);
        } else {
            console.error('Failed to fetch token balance:', result.error);
            tokenCount.textContent = '---';
        }
    } catch (error) {
        console.error('Error fetching token balance:', error);
        tokenCount.textContent = '---';
    } finally {
        tokenBalance.classList.remove('updating');
    }
}

// Update the token display
function updateTokenDisplay(tokens) {
    currentTokens = tokens;

    // Format the token count with commas
    tokenCount.textContent = tokens.toLocaleString();

    // Add visual indicator for low balance
    if (tokens < 1000) {
        tokenBalance.classList.add('low');
        tokenBalance.title = 'Lågt tokensaldo! Överväg att uppgradera din nivå.';
    } else {
        tokenBalance.classList.remove('low');
        tokenBalance.title = `${tokens.toLocaleString()} tokens (~$${(tokens / 10000).toFixed(2)} värde)`;
    }
}

// Listen for token updates from main process
window.tokenAPI.onUpdated((data) => {
    console.log('Token update received:', data);
    if (data.newBalance !== undefined) {
        updateTokenDisplay(data.newBalance);
    }
});


// Logout handler
logoutBtn.addEventListener('click', async () => {
    logoutBtn.disabled = true;
    logoutBtn.textContent = 'Loggar ut...';

    try {
        await window.authAPI.logoutAndShowAuth();
    } catch (error) {
        console.error('Logout failed:', error);
        logoutBtn.disabled = false;
        logoutBtn.textContent = 'Logga ut';
    }
});

// Fetch system prompt from Supabase
async function loadSystemPrompt() {
    try {
        const result = await window.settingsAPI.getSystemPrompt();
        if (result.success && result.prompt) {
            systemPromptFromServer = result.prompt;
            console.log('System prompt loaded from server');
        } else {
            console.warn('Failed to load system prompt from server');
            // main.js provides the fallback
            systemPromptFromServer = result.prompt;
        }
    } catch (error) {
        console.error('Error loading system prompt:', error);
    }
}

// Initialize chat functionality
async function initializeChat() {
    try {
        // Load system prompt from Supabase
        await loadSystemPrompt();

        // Load system information
        await loadSystemInfo();

        // Set up tool progress listener for the new multi-tool system
        window.llmAPI.onToolProgress((data) => {
            console.log('Tool progress:', data);
            if (data.tool) {
                // Show the tool execution in progress
                showToolExecution(data.tool, data.params);
                setTimeout(() => {
                    // Update with results
                    updateToolExecution(data.tool, data.params, data.output, data.success, data.error);
                    // Keep showing thinking indicator while LLM continues processing
                }, 300);
            }
        });
    } catch (error) {
        console.error('Failed to initialize chat:', error);
    }
}

// Load system information
async function loadSystemInfo() {
    try {
        const result = await window.systemAPI.getInfo();
        if (result.success) {
            systemInfo = result.systemInfo;
        } else {
            console.error('Failed to load system info:', result.error);
        }
    } catch (error) {
        console.error('Failed to load system info:', error);
    }
}

// ============= SYSTEM CONTEXT OPTIMIZATION =============
// Controls what system info is included in the prompt
const SYSTEM_CONTEXT_CONFIG = {
    useMinimalContext: true,  // Use minimal context by default (70% smaller)
};

/**
 * Build MINIMAL system context (~150 tokens vs ~400 tokens)
 * Only includes essential info the agent actually needs
 */
function buildMinimalSystemContext() {
    if (!systemInfo) return '';
    
    // Only essential info: OS, user, shell, dev tools, time
    const devTools = Object.entries(systemInfo.devTools || {})
        .map(([name, ver]) => `${name}:${ver}`)
        .join(' ');
    
    return `## System
OS: ${systemInfo.osType} ${systemInfo.osRelease}, User: ${systemInfo.username}, Shell: ${systemInfo.shell}
Dev: ${devTools || 'none'}
Time: ${systemInfo.currentTime} (${systemInfo.timezone})`;
}

/**
 * Build FULL system context (legacy, verbose)
 * Includes all details like windows, processes, clipboard, etc.
 */
function buildFullSystemContext() {
    if (!systemInfo) return '';

    // Format displays for context
    const displaysContext = systemInfo.displays?.length > 0
        ? systemInfo.displays.map(d =>
            `Display ${d.id}: ${d.resolution} at (${d.bounds.x},${d.bounds.y}), scale ${d.scaleFactor}x${d.isPrimary ? ' [PRIMARY]' : ''}`
        ).join('\n  ')
        : 'Unknown display configuration';

    // Format dev tools
    const devToolsContext = Object.entries(systemInfo.devTools || {}).length > 0
        ? Object.entries(systemInfo.devTools).map(([name, ver]) => `${name} v${ver}`).join(', ')
        : 'No common dev tools found';

    // Format power status
    const powerContext = systemInfo.power?.hasBattery
        ? `Battery at ${systemInfo.power.level}, ${systemInfo.power.charging ? 'charging' : 'on battery'}`
        : 'AC Power (no battery)';

    // Format network
    const networkContext = systemInfo.network?.connected
        ? `Connected via ${systemInfo.network.interfaces?.map(i => i.name).join(', ') || 'network'}${systemInfo.network.internetAccess ? ' with internet access' : ' (no internet)'}`
        : 'Not connected to network';

    // Format clipboard
    let clipboardContext = 'Empty';
    if (systemInfo.clipboard?.hasText || systemInfo.clipboard?.hasImage) {
        const parts = [];
        if (systemInfo.clipboard.hasText) parts.push(`text (${systemInfo.clipboard.textLength} chars)`);
        if (systemInfo.clipboard.hasImage) parts.push('image');
        if (systemInfo.clipboard.hasHTML) parts.push('HTML');
        clipboardContext = `Contains: ${parts.join(', ')}`;
    }

    // Format disk space
    const diskContext = systemInfo.diskSpace?.length > 0
        ? systemInfo.diskSpace.map(d => `${d.drive} has ${d.free} free of ${d.total} (${d.usedPercent} used)`).join(', ')
        : 'Unknown disk configuration';

    // Format active windows - REMOVED: rarely useful, adds ~100 tokens
    // Format running processes - REMOVED: never useful, adds ~50 tokens

    return `
## Current System Context

### System Information
- **OS**: ${systemInfo.osType} ${systemInfo.osRelease} (${systemInfo.arch})
- **Hostname**: ${systemInfo.hostname}
- **User**: ${systemInfo.username}
- **Shell**: ${systemInfo.shell}
- **Locale**: ${systemInfo.envInfo?.locale || 'Unknown'}

### Hardware
- **CPU**: ${systemInfo.cpuModel} (${systemInfo.cpus} cores)
- **Memory**: ${systemInfo.freeMemory} free of ${systemInfo.totalMemory}
- **Power**: ${powerContext}

### Displays (for coordinates/UI automation)
  ${displaysContext}
- **Total Screen Area**: ${systemInfo.totalScreenArea?.width || '?'}x${systemInfo.totalScreenArea?.height || '?'} pixels

### Storage
- ${diskContext}

### Network
- ${networkContext}

### Clipboard
- ${clipboardContext}

### Installed Dev Tools
- ${devToolsContext}

### Time Context
- **Current Time**: ${systemInfo.currentTime}
- **Timezone**: ${systemInfo.timezone}
- **Uptime**: ${systemInfo.uptime}
`;
}

// Build the full system prompt with system info
function buildSystemPrompt() {
    const customPrompt = customPromptValue.trim() || systemPromptFromServer;

    if (!systemInfo) {
        return customPrompt;
    }

    // Use minimal or full context based on config
    const systemContext = SYSTEM_CONTEXT_CONFIG.useMinimalContext 
        ? buildMinimalSystemContext()
        : buildFullSystemContext();

    return `${customPrompt}\n\n${systemContext}`;
}

// Render LaTeX math using KaTeX
function renderMath(latex, displayMode = false) {
    try {
        if (typeof katex !== 'undefined') {
            return katex.renderToString(latex, {
                displayMode: displayMode,
                throwOnError: false,
                trust: true,
                strict: false
            });
        }
    } catch (e) {
        console.error('KaTeX render error:', e);
    }
    // Fallback: return the original LaTeX wrapped in a styled span
    return displayMode
        ? `<div class="math-fallback">${escapeHtml(latex)}</div>`
        : `<span class="math-fallback">${escapeHtml(latex)}</span>`;
}

// Format message content with code blocks and math
function formatMessageContent(content) {
    // First, protect code blocks and math from HTML escaping
    const codeBlocks = [];
    const blockMath = [];
    const inlineMath = [];

    // Extract code blocks first (```...```)
    let processed = content.replace(/```(\w*)\n?([\s\S]*?)```/g, (match, lang, code) => {
        const placeholder = `__CODE_BLOCK_${codeBlocks.length}__`;
        codeBlocks.push({ lang, code: code.trim() });
        return placeholder;
    });

    // Extract block math ($$...$$)
    processed = processed.replace(/\$\$([\s\S]*?)\$\$/g, (match, math) => {
        const placeholder = `__BLOCK_MATH_${blockMath.length}__`;
        blockMath.push(math.trim());
        return placeholder;
    });

    // Extract inline math ($...$) - but not things like $5 or 5$
    processed = processed.replace(/\$([^$\n]+?)\$/g, (match, math) => {
        // Skip if it looks like currency (just a number after $)
        if (/^\d+(\.\d+)?$/.test(math.trim())) {
            return match;
        }
        const placeholder = `__INLINE_MATH_${inlineMath.length}__`;
        inlineMath.push(math.trim());
        return placeholder;
    });

    // Escape HTML
    processed = processed
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // Format inline code (`code`)
    processed = processed.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Format bold (**text**)
    processed = processed.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    // Format italic (*text*)
    processed = processed.replace(/\*([^*]+)\*/g, '<em>$1</em>');

    // Format newlines
    processed = processed.replace(/\n/g, '<br>');

    // Restore code blocks
    codeBlocks.forEach((block, i) => {
        const escaped = block.code
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        processed = processed.replace(`__CODE_BLOCK_${i}__`, `<pre><code>${escaped}</code></pre>`);
    });

    // Restore block math with KaTeX rendering
    blockMath.forEach((math, i) => {
        const rendered = renderMath(math, true);
        processed = processed.replace(`__BLOCK_MATH_${i}__`, `<div class="math-block">${rendered}</div>`);
    });

    // Restore inline math with KaTeX rendering
    inlineMath.forEach((math, i) => {
        const rendered = renderMath(math, false);
        processed = processed.replace(`__INLINE_MATH_${i}__`, `<span class="math-inline">${rendered}</span>`);
    });

    return processed;
}

// Add message to chat display
function addMessageToChat(role, content) {
    // Remove empty state if present
    const emptyState = chatMessages.querySelector('.chat-empty');
    if (emptyState) {
        emptyState.remove();
    }

    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${role}`;

    let avatarHtml = '';
    let avatarStyle = '';

    if (role === 'user') {
        const avatarUrl = currentUserData?.user_metadata?.avatar_url;
        if (avatarUrl) {
            avatarHtml = `<img src="${avatarUrl}" alt="U" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
            avatarStyle = 'background: transparent; padding: 0;';
        } else {
            avatarHtml = 'U';
        }
    } else {
        // AI logo
        avatarHtml = `<img src="assets/logo.svg" alt="AI" style="width: 18px; height: 18px; filter: brightness(0) invert(1);">`;
    }

    messageDiv.innerHTML = `
        <div class="message-avatar" style="${avatarStyle}">${avatarHtml}</div>
        <div class="message-content">${formatMessageContent(content)}</div>
    `;

    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Show typing indicator - now uses the unified cube animation
function showTypingIndicator() {
    // Use the thinking indicator with default text (no tool mode)
    showThinkingIndicator(null, false);
}

// Tool display names and action verbs (Swedish)
const TOOL_DISPLAY = {
    run_command: { name: 'Kör kommando', verb: 'Kör kommando' },
    run_background: { name: 'Bakgrundsprocess', verb: 'Startar process' },
    kill_process: { name: 'Avsluta process', verb: 'Avslutar process' },
    read_file: { name: 'Läs fil', verb: 'Läser fil' },
    write_file: { name: 'Skriv fil', verb: 'Skriver till fil' },
    edit_file: { name: 'Redigera fil', verb: 'Redigerar fil' },
    list_directory: { name: 'Lista mapp', verb: 'Listar mapp' },
    search_files: { name: 'Sök filer', verb: 'Söker filer' },
    delete: { name: 'Ta bort', verb: 'Tar bort' },
    open_url: { name: 'Öppna URL', verb: 'Öppnar URL' },
    open_path: { name: 'Öppna sökväg', verb: 'Öppnar sökväg' },
    clipboard_read: { name: 'Läs urklipp', verb: 'Läser urklipp' },
    clipboard_write: { name: 'Skriv urklipp', verb: 'Skriver till urklipp' },
    system_info: { name: 'Systeminformation', verb: 'Hämtar systeminfo' },
    env_var: { name: 'Miljövariabler', verb: 'Hämtar miljövariabler' },
    wait: { name: 'Vänta', verb: 'Väntar' },
    convert_image: { name: 'Konvertera bild', verb: 'Konverterar bild' }
};

// Get tool display info
function getToolDisplay(toolName) {
    return TOOL_DISPLAY[toolName] || { name: toolName, verb: 'Arbetar' };
}

// Track tool executions for the consolidated view
let toolExecutionHistory = [];

// Format tool parameters for display (compact)
function formatToolParams(tool, params) {
    if (!params) return '';

    switch (tool) {
        case 'run_command':
        case 'run_background':
            const cmd = params.command || '';
            return cmd.length > 60 ? cmd.substring(0, 60) + '...' : cmd;
        case 'read_file':
        case 'write_file':
        case 'edit_file':
        case 'delete':
        case 'open_path':
            const path = params.path || '';
            // Show just filename for long paths
            if (path.length > 40) {
                const parts = path.replace(/\\/g, '/').split('/');
                return '.../' + parts.slice(-2).join('/');
            }
            return path;
        case 'list_directory':
            return params.path || '.';
        case 'search_files':
            return params.pattern || params.content || '';
        case 'open_url':
            const url = params.url || '';
            return url.length > 50 ? url.substring(0, 50) + '...' : url;
        case 'clipboard_write':
            return `${params.text?.length || 0} tecken`;
        case 'kill_process':
            return params.pid ? `PID ${params.pid}` : params.name || '';
        case 'wait':
            return `${params.seconds}s`;
        case 'convert_image':
            const src = params.source || '';
            const out = params.output || '';
            const srcName = src.replace(/\\/g, '/').split('/').pop();
            const outName = out.replace(/\\/g, '/').split('/').pop();
            return `${srcName} → ${outName}`;
        default:
            const str = JSON.stringify(params);
            return str.length > 50 ? str.substring(0, 50) + '...' : str;
    }
}

// Random thinking/working texts in Swedish
const THINKING_TEXTS = ['Tänker...', 'Jobbar...', 'Funderar...', 'Analyserar...', 'Bearbetar...'];
const TOOL_TEXTS = ['Arbetar...', 'Utför...', 'Kör verktyg...', 'Exekverar...', 'Processar...'];

// Track if we're in tool mode
let isToolMode = false;
let thinkingTextInterval = null;

// Get random text based on mode
function getRandomThinkingText() {
    const texts = isToolMode ? TOOL_TEXTS : THINKING_TEXTS;
    return texts[Math.floor(Math.random() * texts.length)];
}

// Update thinking text periodically
function startThinkingTextCycle() {
    if (thinkingTextInterval) return;
    
    thinkingTextInterval = setInterval(() => {
        const textElement = document.querySelector('#thinking-indicator .thinking-text');
        if (textElement) {
            textElement.style.opacity = '0';
            setTimeout(() => {
                textElement.textContent = getRandomThinkingText();
                textElement.style.opacity = '0.9';
            }, 150);
        }
    }, 2500);
}

// Stop thinking text cycle
function stopThinkingTextCycle() {
    if (thinkingTextInterval) {
        clearInterval(thinkingTextInterval);
        thinkingTextInterval = null;
    }
}

// Show or update the thinking indicator
function showThinkingIndicator(actionText = null, toolMode = false) {
    removeTypingIndicator();
    
    isToolMode = toolMode || toolExecutionHistory.length > 0;
    const displayText = actionText || getRandomThinkingText();

    let thinkingDiv = document.getElementById('thinking-indicator');

    if (!thinkingDiv) {
        thinkingDiv = document.createElement('div');
        thinkingDiv.className = 'chat-message assistant thinking-container';
        thinkingDiv.id = 'thinking-indicator';
        chatMessages.appendChild(thinkingDiv);
    }

    const cubeLoaderClass = isToolMode ? 'cube-loader tool-mode' : 'cube-loader';

    thinkingDiv.innerHTML = `
        <div class="message-avatar">
            <img src="assets/logo.svg" alt="AI" style="width: 18px; height: 18px; filter: brightness(0) invert(1);">
        </div>
        <div class="thinking-content">
            <div class="thinking-header">
                <div class="${cubeLoaderClass}">
                    <div class="cube"></div>
                    <div class="cube"></div>
                    <div class="cube"></div>
                    <div class="cube"></div>
                    <div class="cube"></div>
                    <div class="cube"></div>
                    <div class="cube"></div>
                    <div class="cube"></div>
                    <div class="cube"></div>
                </div>
                <span class="thinking-text">${escapeHtml(displayText)}</span>
            </div>
            ${toolExecutionHistory.length > 0 ? `
            <details class="thinking-details">
                <summary>Visa aktivitet (${toolExecutionHistory.length})</summary>
                <div class="thinking-history">
                    ${toolExecutionHistory.map(t => `
                        <div class="thinking-history-item ${t.success === true ? 'success' : t.success === false ? 'error' : 'pending'}">
                            <span class="history-status">${t.success === true ? '✓' : t.success === false ? '✗' : '⋯'}</span>
                            <span class="history-action">${escapeHtml(t.verb)}</span>
                            ${t.param ? `<span class="history-param">${escapeHtml(t.param)}</span>` : ''}
                        </div>
                    `).join('')}
                </div>
            </details>` : ''}
        </div>
    `;

    chatMessages.scrollTop = chatMessages.scrollHeight;
    startThinkingTextCycle();
}

// Show tool execution - updates the thinking indicator
function showToolExecution(tool, params) {
    const display = getToolDisplay(tool);
    const paramDisplay = formatToolParams(tool, params);

    // Add to history as pending
    toolExecutionHistory.push({
        tool,
        verb: display.verb,
        param: paramDisplay,
        success: null // pending
    });

    // Update the thinking indicator with current action and enable tool mode
    showThinkingIndicator(display.verb, true);
}

// Update tool execution with result
function updateToolExecution(tool, params, output, success, error) {
    // Update the last matching tool in history
    for (let i = toolExecutionHistory.length - 1; i >= 0; i--) {
        if (toolExecutionHistory[i].tool === tool && toolExecutionHistory[i].success === null) {
            toolExecutionHistory[i].success = success;
            toolExecutionHistory[i].output = output;
            toolExecutionHistory[i].error = error;
            break;
        }
    }

    // Update the thinking indicator with tool mode still active
    showThinkingIndicator(success ? null : 'Hmm...', true);
}

// Remove thinking indicator and clear history
function removeThinkingIndicator() {
    stopThinkingTextCycle();
    isToolMode = false;
    const thinkingDiv = document.getElementById('thinking-indicator');
    if (thinkingDiv) {
        thinkingDiv.remove();
    }
    toolExecutionHistory = [];
}

// Escape HTML for safe display
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Remove typing indicator (and thinking indicator)
function removeTypingIndicator() {
    const typingDiv = document.getElementById('typing-indicator');
    if (typingDiv) {
        typingDiv.remove();
    }
    removeThinkingIndicator();
}

// Send message to LLM
async function sendMessage() {
    const message = chatInput.value.trim();
    const currentImages = [...attachedImages];

    // Need either a message or images to send
    if ((!message && currentImages.length === 0) || isTyping) return;

    // Build the message content (text + images for vision models)
    let userContent;
    let displayImages = currentImages.map(img => img.data);

    if (currentImages.length > 0) {
        // Build multimodal content for vision-capable models
        const contentParts = [];

        // Add images first
        for (const img of currentImages) {
            contentParts.push({
                type: 'image_url',
                image_url: {
                    url: img.data,
                    detail: 'high'
                }
            });
        }

        // Add text if present
        if (message) {
            contentParts.push({
                type: 'text',
                text: message
            });
        } else {
            contentParts.push({
                type: 'text',
                text: 'Vad ser du på denna skärmbild? Beskriv den och hjälp mig med eventuella frågor jag kan ha om den.'
            });
        }

        userContent = contentParts;
    } else {
        userContent = message;
    }

    // Add user message to history and display
    conversationHistory.push({ role: 'user', content: userContent });
    addMessageToChatWithImages('user', message || '[Skärmbild bifogad]', displayImages);

    // Clear input, images, and disable controls
    chatInput.value = '';
    chatInput.style.height = 'auto';
    attachedImages = [];
    renderAttachedImages();
    isTyping = true;
    chatSendBtn.disabled = true;
    chatInput.disabled = true;
    snipBtn.disabled = true;

    // Show typing indicator
    showTypingIndicator();

    try {
        // Build messages with system prompt
        // Model is controlled server-side via Supabase
        const systemPrompt = buildSystemPrompt();
        const messagesWithSystem = [
            { role: 'system', content: systemPrompt },
            ...conversationHistory
        ];

        const result = await window.llmAPI.chat(messagesWithSystem);

        removeTypingIndicator();

        if (result.success) {
            // Add assistant message to history and display
            conversationHistory.push({ role: 'assistant', content: result.message });
            addMessageToChat('assistant', result.message);

        } else {
            // Check for insufficient tokens
            if (result.insufficientTokens) {
                addMessageToChat('assistant', `⚠️ **Otillräckligt med tokens!**\n\nDu har ${result.currentBalance || 0} tokens kvar. Vänta på att din nivå fyller på dina tokens eller uppgradera din plan.`);
            } else {
                addMessageToChat('assistant', `⚠️ Fel: ${result.error}`);
            }
        }
    } catch (error) {
        removeTypingIndicator();
        addMessageToChat('assistant', `⚠️ Fel: ${error.message}`);
    } finally {
        isTyping = false;
        chatSendBtn.disabled = false;
        chatInput.disabled = false;
        snipBtn.disabled = false;
        chatInput.focus();
    }
}

// Clear chat history
function clearChat() {
    conversationHistory = [];
    attachedImages = [];
    renderAttachedImages();
    chatMessages.innerHTML = `
        <div class="chat-empty">
            <img src="assets/name.svg" alt="Flyt" style="width: 150px; margin-bottom: 20px; opacity: 0.6;">
            <p>Starta en konversation!</p>
            <p style="font-size: 0.8rem; margin-top: 8px;">Ställ frågor, få hjälp med kod eller ta en skärmbild!</p>
        </div>
    `;
}

// Chat event listeners
chatSendBtn.addEventListener('click', sendMessage);

chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

// Auto-resize textarea
chatInput.addEventListener('input', () => {
    chatInput.style.height = 'auto';
    chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
});

clearChatBtn.addEventListener('click', clearChat);

// ===== SNIPPING TOOL FUNCTIONALITY =====

// Open snipping overlay
snipBtn.addEventListener('click', async () => {
    snipBtn.disabled = true;
    try {
        await window.snipAPI.openOverlay();
    } catch (error) {
        console.error('Failed to open snipping tool:', error);
        snipBtn.disabled = false;
    }
});

// Listen for captured snips
window.snipAPI.onCaptured((data) => {
    console.log('Snip captured:', data);
    snipBtn.disabled = false;

    if (data && data.imageData) {
        addAttachedImage(data.imageData);
    }
});

// ===== FILE UPLOAD FUNCTIONALITY =====

const uploadBtn = document.getElementById('upload-btn');
const fileInput = document.getElementById('file-input');
const dropOverlay = document.getElementById('drop-overlay');
const chatSection = document.querySelector('.chat-section');

// Upload button click handler
uploadBtn.addEventListener('click', () => {
    fileInput.click();
});

// File input change handler
fileInput.addEventListener('change', (e) => {
    handleFiles(e.target.files);
    fileInput.value = ''; // Reset to allow re-uploading same file
});

// Handle uploaded files
async function handleFiles(files) {
    for (const file of files) {
        if (file.type.startsWith('image/')) {
            // Handle image files
            const reader = new FileReader();
            reader.onload = (e) => {
                addAttachedImage(e.target.result);
            };
            reader.readAsDataURL(file);
        } else if (file.type.startsWith('text/') ||
            file.name.endsWith('.md') ||
            file.name.endsWith('.txt') ||
            file.name.endsWith('.js') ||
            file.name.endsWith('.ts') ||
            file.name.endsWith('.py') ||
            file.name.endsWith('.json') ||
            file.name.endsWith('.html') ||
            file.name.endsWith('.css')) {
            // Handle text files - add content to chat input
            const reader = new FileReader();
            reader.onload = (e) => {
                const content = e.target.result;
                const currentText = chatInput.value;
                const fileContent = `\n\n--- ${file.name} ---\n\`\`\`\n${content}\n\`\`\`\n`;
                chatInput.value = currentText + fileContent;
                chatInput.style.height = 'auto';
                chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
                chatInput.focus();
            };
            reader.readAsText(file);
        } else {
            console.log('Unsupported file type:', file.type);
        }
    }
}

// ===== DRAG AND DROP FUNCTIONALITY =====

let dragCounter = 0;

// Prevent default drag behaviors on document
document.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
});

document.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
});

// Chat section drag events
chatSection.addEventListener('dragenter', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter++;
    dropOverlay.classList.add('active');
});

chatSection.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter--;
    if (dragCounter === 0) {
        dropOverlay.classList.remove('active');
    }
});

chatSection.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
});

chatSection.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter = 0;
    dropOverlay.classList.remove('active');

    const files = e.dataTransfer.files;
    if (files.length > 0) {
        handleFiles(files);
    }
});

// Add an attached image to the pending list
function addAttachedImage(imageData) {
    const id = Date.now();
    attachedImages.push({ id, data: imageData });
    renderAttachedImages();
}

// Remove an attached image
function removeAttachedImage(id) {
    attachedImages = attachedImages.filter(img => img.id !== id);
    renderAttachedImages();
}

// Render attached images preview
function renderAttachedImages() {
    if (attachedImages.length === 0) {
        attachedImagesContainer.innerHTML = '';
        return;
    }

    attachedImagesContainer.innerHTML = attachedImages.map(img => `
        <div class="attached-image" data-id="${img.id}">
            <img src="${img.data}" alt="Attached screenshot">
            <button class="remove-btn" onclick="removeAttachedImage(${img.id})">×</button>
        </div>
    `).join('');

    // Add click handlers for removal
    attachedImagesContainer.querySelectorAll('.remove-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const id = parseInt(btn.closest('.attached-image').dataset.id);
            removeAttachedImage(id);
        });
    });
}

// Image modal functionality
function showImageModal(src) {
    modalImage.src = src;
    imageModal.classList.add('show');
}

function hideImageModal() {
    imageModal.classList.remove('show');
    modalImage.src = '';
}

imageModal.addEventListener('click', (e) => {
    if (e.target === imageModal || e.target === modalCloseBtn) {
        hideImageModal();
    }
});

modalCloseBtn.addEventListener('click', hideImageModal);

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && imageModal.classList.contains('show')) {
        hideImageModal();
    }
});

// Add message to chat display with optional images
function addMessageToChatWithImages(role, content, images = []) {
    // Remove empty state if present
    const emptyState = chatMessages.querySelector('.chat-empty');
    if (emptyState) {
        emptyState.remove();
    }

    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${role}`;

    let avatarHtml = '';
    let avatarStyle = '';

    if (role === 'user') {
        const avatarUrl = currentUserData?.user_metadata?.avatar_url;
        if (avatarUrl) {
            avatarHtml = `<img src="${avatarUrl}" alt="U" style="width: 100%; height: 100%; border-radius: 50%; object-fit: cover;">`;
            avatarStyle = 'background: transparent; padding: 0;';
        } else {
            avatarHtml = 'U';
        }
    } else {
        // AI logo
        avatarHtml = `<img src="assets/logo.svg" alt="AI" style="width: 18px; height: 18px; filter: brightness(0) invert(1);">`;
    }

    let imagesHtml = '';
    if (images && images.length > 0) {
        imagesHtml = `
            <div class="message-images">
                ${images.map(img => `<img src="${img}" alt="Screenshot" onclick="showImageModal('${img}')">`).join('')}
            </div>
        `;
    }

    messageDiv.innerHTML = `
        <div class="message-avatar" style="${avatarStyle}">${avatarHtml}</div>
        <div class="message-content">
            ${imagesHtml}
            ${content ? formatMessageContent(content) : ''}
        </div>
    `;

    // Add click handlers for images
    messageDiv.querySelectorAll('.message-images img').forEach(img => {
        img.addEventListener('click', () => showImageModal(img.src));
    });

    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Re-enable snip button when window regains focus (in case snipping was cancelled)
window.addEventListener('focus', () => {
    if (snipBtn) {
        snipBtn.disabled = false;
    }
    // Auto-focus chat input when window gains focus
    if (chatInput) {
        chatInput.focus();
    }
});

// ===== WINDOW CONTROLS =====
const pinBtn = document.getElementById('pin-btn');
const minimizeBtn = document.getElementById('minimize-btn');
const closeBtn = document.getElementById('close-btn');

// Initialize window control buttons
async function initializeWindowControls() {
    // Check initial always-on-top status
    const result = await window.windowAPI.getAlwaysOnTop();
    if (result.success && result.alwaysOnTop) {
        pinBtn.classList.add('active');
    }

    // Pin button - toggle always on top
    pinBtn.addEventListener('click', async () => {
        const result = await window.windowAPI.toggleAlwaysOnTop();
        if (result.success) {
            pinBtn.classList.toggle('active', result.alwaysOnTop);
        }
    });

    // Minimize button - minimize to tray
    minimizeBtn.addEventListener('click', async () => {
        await window.windowAPI.minimize();
    });

    // Close button - close to tray
    closeBtn.addEventListener('click', async () => {
        await window.windowAPI.close();
    });
}

// Initialize on load
initialize();
initializeChat();
initializeWindowControls();
