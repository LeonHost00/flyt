// ===== GLOBAL ERROR HANDLERS =====
// Catch unhandled errors to prevent silent UI crashes
window.onerror = function (message, source, lineno, colno, error) {
    console.error('Unhandled error:', { message, source, lineno, colno, error });
    return false; // Let default handler also run
};

window.addEventListener('unhandledrejection', function (event) {
    console.error('Unhandled promise rejection:', event.reason);
});

// Initialize marked with KaTeX extension
marked.use(markedKatex({
    throwOnError: false,
    displayMode: false
}));
console.log('Marked initialized with KaTeX extension');

// DOM Elements
const loadingOverlay = document.getElementById('loading-overlay');
const userAvatar = document.getElementById('user-avatar');
const logoutBtn = document.getElementById('logout-btn');

// Profile Menu Elements
const profileMenuContainer = document.getElementById('profile-menu-container');
const profileDropdown = document.getElementById('profile-dropdown');
const accountSettingsBtn = document.getElementById('account-settings-btn');

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

// Validate critical DOM elements
function validateDOMElements() {
    const criticalElements = {
        loadingOverlay, userAvatar, chatMessages, chatInput, chatSendBtn,
        attachedImagesContainer, tokenBalance, tokenCount
    };
    
    for (const [name, element] of Object.entries(criticalElements)) {
        if (!element) {
            console.error(`Critical DOM element missing: ${name}`);
            alert(`Applikationen kunde inte initieras korrekt. Saknar element: ${name}`);
            return false;
        }
    }
    return true;
}

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

// Mode state (jobba/chatta)
let currentMode = 'chatta';

// System prompt (fetched from Supabase)
let systemPromptFromServer = null;

// Chat history state
let currentConversationId = null;
let isConversationSaved = false;

// Initialize the app
async function initialize() {
    // Validate DOM elements first
    if (!validateDOMElements()) {
        return;
    }
    
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
        // Try to get profile picture from user_metadata (Supabase/Google)
        const avatarUrl = user.user_metadata?.avatar_url;

        if (avatarUrl) {
            userAvatar.innerHTML = `<img src="${avatarUrl}" alt="Avatar" class="avatar-image">`;
            userAvatar.classList.add('avatar-custom');
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
        tokenBalance.title = `${tokens.toLocaleString()} tokens`;
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
if (logoutBtn) {
    logoutBtn.addEventListener('click', async (e) => {
    e.stopPropagation(); // Prevent dropdown from closing if it matters

    // Visual feedback
    const originalText = logoutBtn.innerHTML;
    logoutBtn.style.pointerEvents = 'none';
    logoutBtn.style.opacity = '0.5';
    logoutBtn.innerHTML = '<span>⏳</span> Loggar ut...';

    try {
        await window.authAPI.logoutAndShowAuth();
    } catch (error) {
        console.error('Logout failed:', error);
        logoutBtn.style.pointerEvents = 'auto';
        logoutBtn.style.opacity = '1';
        logoutBtn.innerHTML = originalText;
    }
    });
}

// Toggle profile dropdown
if (userAvatar && profileMenuContainer) {
    userAvatar.addEventListener('click', (e) => {
        e.stopPropagation();
        profileMenuContainer.classList.toggle('show');
    });
}

// Close dropdown when clicking outside
window.addEventListener('click', (e) => {
    if (profileMenuContainer && profileMenuContainer.classList.contains('show') && !profileMenuContainer.contains(e.target)) {
        profileMenuContainer.classList.remove('show');
    }
});

// Account settings link handler
if (accountSettingsBtn && profileMenuContainer) {
    accountSettingsBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.shellAPI.openExternal('https://flytapp.se/dashboard');
        profileMenuContainer.classList.remove('show');
    });
}

// Fetch system prompt from Supabase
async function loadSystemPrompt() {
    try {
        const result = await window.settingsAPI.getSystemPrompt({ mode: currentMode });
        if (result.success && result.prompt) {
            systemPromptFromServer = result.prompt;
            console.log(`System prompt loaded from server for mode: ${currentMode}`);
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

/**
 * Build MINIMAL system context (~150 tokens)
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

// Build the full system prompt with system info
function buildSystemPrompt() {
    const customPrompt = customPromptValue.trim() || systemPromptFromServer;

    if (!systemInfo) {
        return customPrompt;
    }

    // Always use minimal context for token efficiency
    return `${customPrompt}\n\n${buildMinimalSystemContext()}`;
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
    if (!content) return '';

    try {
        const parseOptions = { breaks: true, gfm: true };
        let processed = marked.parse(content, parseOptions);

        if (processed) {
            // Post-process links to use our external link system
            return processed.replace(/<a href="([^"]+)"/g, (match, url) => {
                if (url.startsWith('#')) return match;
                return `<a href="#" data-url="${url}" class="external-link"`;
            });
        }
    } catch (e) {
        console.error('Markdown parsing error:', e);
    }

    // Safety fallback: simple HTML escape if parser fails
    return content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
}

// Global click delegation for external links
document.addEventListener('click', (e) => {
    const link = e.target.closest('.external-link');
    if (link) {
        e.preventDefault();
        const url = link.getAttribute('data-url');
        if (url) {
            console.log('Opening external link:', url);
            window.shellAPI.openExternal(url);
        }
    }
});

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
    let avatarClass = '';

    if (role === 'user') {
        const avatarUrl = currentUserData?.user_metadata?.avatar_url;
        if (avatarUrl) {
            avatarHtml = `<img src="${avatarUrl}" alt="U" class="avatar-image">`;
            avatarClass = 'avatar-custom';
        } else {
            avatarHtml = 'U';
        }
    } else {
        // AI logo
        avatarHtml = `<img src="assets/logo.svg" alt="AI" class="ai-avatar-logo">`;
    }

    messageDiv.innerHTML = `
        <div class="message-avatar ${avatarClass}">${avatarHtml}</div>
        <div class="message-content">${formatMessageContent(content)}</div>
    `;

    chatMessages.appendChild(messageDiv);
    smoothScrollToBottom();
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

    const thinkingDiv = document.getElementById('thinking-indicator');
    const textElement = thinkingDiv?.querySelector('.thinking-text');
    if (!textElement) return;

    thinkingTextInterval = setInterval(() => {
        textElement.style.opacity = '0';
        setTimeout(() => {
            textElement.textContent = getRandomThinkingText();
            textElement.style.opacity = '0.9';
        }, 150);
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

        thinkingDiv.innerHTML = `
            <div class="message-avatar">
                <img src="assets/logo.svg" alt="AI" class="ai-avatar-logo">
            </div>
            <div class="thinking-content">
                <div class="thinking-header">
                    <div class="cube-loader">
                        <div class="cube"></div>
                    </div>
                    <span class="thinking-text"></span>
                </div>
                <div class="thinking-details-container"></div>
            </div>
        `;
        chatMessages.appendChild(thinkingDiv);
    }

    // Update text only if it has changed to avoid unnecessary reflows
    const textElement = thinkingDiv.querySelector('.thinking-text');
    if (textElement && textElement.textContent !== displayText) {
        textElement.textContent = displayText;
    }

    // Update cube loader mode
    const cubeLoader = thinkingDiv.querySelector('.cube-loader');
    if (cubeLoader) {
        cubeLoader.classList.toggle('tool-mode', isToolMode);
    }

    // Update history/details
    const detailsContainer = thinkingDiv.querySelector('.thinking-details-container');
    if (detailsContainer) {
        if (toolExecutionHistory.length > 0) {
            let detailsElement = detailsContainer.querySelector('.thinking-details');

            if (!detailsElement) {
                detailsElement = document.createElement('details');
                detailsElement.className = 'thinking-details';
                detailsContainer.appendChild(detailsElement);
            }

            const headerHtml = `<summary>Visa aktivitet (${toolExecutionHistory.length})</summary>`;
            const historyHtml = `
                <div class="thinking-history">
                    ${toolExecutionHistory.map(t => `
                        <div class="thinking-history-item ${t.success === true ? 'success' : t.success === false ? 'error' : 'pending'}">
                            <span class="history-status">${t.success === true ? '✓' : t.success === false ? '✗' : '⋯'}</span>
                            <span class="history-action">${escapeHtml(t.verb)}</span>
                            ${t.param ? `<span class="history-param">${escapeHtml(t.param)}</span>` : ''}
                        </div>
                    `).join('')}
                </div>
            `;

            // Granular update: only update summary text if count changed
            const summary = detailsElement.querySelector('summary');
            const expectedSummary = `Visa aktivitet (${toolExecutionHistory.length})`;
            if (!summary || summary.textContent !== expectedSummary) {
                if (!summary) {
                    detailsElement.insertAdjacentHTML('afterbegin', headerHtml);
                } else {
                    summary.textContent = expectedSummary;
                }
            }

            // Granular update: sync history list children with toolExecutionHistory (Issue 2)
            let historyList = detailsElement.querySelector('.thinking-history');
            if (!historyList) {
                historyList = document.createElement('div');
                historyList.className = 'thinking-history';
                detailsElement.appendChild(historyList);
            }

            toolExecutionHistory.forEach((t, idx) => {
                let item = historyList.children[idx];
                const statusClass = t.success === true ? 'success' : (t.success === false ? 'error' : 'pending');
                const statusSymbol = t.success === true ? '✓' : (t.success === false ? '✗' : '⋯');

                if (!item) {
                    item = document.createElement('div');
                    item.className = `thinking-history-item ${statusClass}`;
                    item.innerHTML = `
                        <span class="history-status">${statusSymbol}</span>
                        <span class="history-action">${escapeHtml(t.verb)}</span>
                        ${t.param ? `<span class="history-param">${escapeHtml(t.param)}</span>` : ''}
                    `;
                    historyList.appendChild(item);
                } else {
                    // Update existing item classes and symbols if they changed
                    if (!item.classList.contains(statusClass)) {
                        item.className = `thinking-history-item ${statusClass}`;
                        const statusElem = item.querySelector('.history-status');
                        if (statusElem) statusElem.textContent = statusSymbol;
                    }
                }
            });
        } else {
            detailsContainer.innerHTML = '';
        }
    }

    smoothScrollToBottom();
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
    if (!text) return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return String(text).replace(/[&<>"']/g, m => map[m]);
}

// Global scroll helper to prevent layout thrashing
let scrollTimeout;
function smoothScrollToBottom() {
    if (scrollTimeout) cancelAnimationFrame(scrollTimeout);
    scrollTimeout = requestAnimationFrame(() => {
        if (chatMessages) {
            chatMessages.scrollTop = chatMessages.scrollHeight;
        }
    });
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
        const apiMessages = [
            { role: 'system', content: systemPrompt },
            ...conversationHistory
        ];

        // IPC call to main process
        const result = await window.llmAPI.chat({
            messages: apiMessages,
            mode: currentMode
        });

        removeTypingIndicator();

        if (result.success) {
            // Add assistant message to history and display
            conversationHistory.push({ role: 'assistant', content: result.message });
            addMessageToChat('assistant', result.message);

            // Auto-save conversation after each response
            saveCurrentConversation();

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

// ===== CHAT HISTORY MANAGEMENT =====

// Generate a title from the first user message
function generateConversationTitle(messages) {
    const firstUserMessage = messages.find(m => m.role === 'user');
    if (!firstUserMessage) return 'Ny konversation';

    let text = '';
    if (typeof firstUserMessage.content === 'string') {
        text = firstUserMessage.content;
    } else if (Array.isArray(firstUserMessage.content)) {
        const textPart = firstUserMessage.content.find(p => p.type === 'text');
        text = textPart?.text || '[Bild]';
    }

    // Truncate to reasonable length
    return text.length > 50 ? text.substring(0, 50) + '...' : text;
}

// Generate a preview from the last assistant message
function generateConversationPreview(messages) {
    const lastAssistant = [...messages].reverse().find(m => m.role === 'assistant');
    if (!lastAssistant) return '';

    const text = lastAssistant.content || '';
    return text.length > 100 ? text.substring(0, 100) + '...' : text;
}

// Save the current conversation to history
async function saveCurrentConversation() {
    // Only save if there are actual messages (not just system message)
    const userMessages = conversationHistory.filter(m => m.role !== 'system');
    if (userMessages.length === 0) {
        console.log('No messages to save');
        return;
    }

    try {
        const conversation = {
            id: currentConversationId || Date.now().toString(),
            title: generateConversationTitle(userMessages),
            preview: generateConversationPreview(userMessages),
            messages: conversationHistory,
            createdAt: isConversationSaved ? undefined : new Date().toISOString()
        };

        const result = await window.chatHistoryAPI.save(conversation);
        if (result.success) {
            currentConversationId = result.id;
            isConversationSaved = true;
            console.log('Conversation saved:', result.id);
        }
    } catch (error) {
        console.error('Failed to save conversation:', error);
    }
}

// Start a new conversation (saves current one first)
async function startNewConversation() {
    // Save current conversation if there are messages
    await saveCurrentConversation();

    // Reset state
    conversationHistory = [];
    attachedImages = [];
    currentConversationId = null;
    isConversationSaved = false;

    renderAttachedImages();
    chatMessages.innerHTML = `
        <div class="chat-empty"></div>
    `;

    // Refresh history list
    renderHistoryList();
}

// Load a conversation from history
async function loadConversation(id) {
    try {
        // Save current conversation first if needed
        await saveCurrentConversation();

        const result = await window.chatHistoryAPI.load(id);
        if (!result.success) {
            console.error('Failed to load conversation:', result.error);
            return;
        }

        const conversation = result.conversation;

        // Restore state
        conversationHistory = conversation.messages || [];
        currentConversationId = conversation.id;
        isConversationSaved = true;
        attachedImages = [];

        // Rebuild the UI
        chatMessages.innerHTML = '';

        // Re-render all messages (skip system messages)
        for (const msg of conversationHistory) {
            if (msg.role !== 'system') {
                // Check if message has images
                const images = [];
                if (Array.isArray(msg.content)) {
                    for (const part of msg.content) {
                        if (part.type === 'image_url') {
                            images.push(part.image_url.url);
                        }
                    }
                    const textPart = msg.content.find(p => p.type === 'text');
                    const text = textPart?.text || '[Bild]';
                    addMessageToChatWithImages(msg.role, text, images);
                } else {
                    addMessageToChat(msg.role, msg.content);
                }
            }
        }

        // If no messages were rendered, show empty state
        if (chatMessages.children.length === 0) {
            chatMessages.innerHTML = `<div class="chat-empty"></div>`;
        }

        renderAttachedImages();

        // Close history panel
        const historyPanel = document.getElementById('history-panel');
        historyPanel.classList.remove('show');

        console.log('Conversation loaded:', id);
    } catch (error) {
        console.error('Failed to load conversation:', error);
    }
}

// Delete a conversation from history
async function deleteConversation(id, event) {
    event.stopPropagation(); // Prevent triggering the load

    try {
        const result = await window.chatHistoryAPI.delete(id);
        if (result.success) {
            // If we deleted the current conversation, reset state
            if (id === currentConversationId) {
                currentConversationId = null;
                isConversationSaved = false;
            }
            renderHistoryList();
        }
    } catch (error) {
        console.error('Failed to delete conversation:', error);
    }
}

// Clear all chat history
async function clearAllHistory() {
    if (!confirm('Är du säker på att du vill radera all chatthistorik?')) return;

    try {
        const result = await window.chatHistoryAPI.clearAll();
        if (result.success) {
            currentConversationId = null;
            isConversationSaved = false;
            renderHistoryList();
        }
    } catch (error) {
        console.error('Failed to clear history:', error);
    }
}

// Format relative time
function formatRelativeTime(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just nu';
    if (diffMins < 60) return `${diffMins} min sedan`;
    if (diffHours < 24) return `${diffHours} tim sedan`;
    if (diffDays === 1) return 'Igår';
    if (diffDays < 7) return `${diffDays} dagar sedan`;

    return date.toLocaleDateString('sv-SE');
}

// Render the history list
async function renderHistoryList() {
    const historyList = document.getElementById('history-list');

    try {
        const result = await window.chatHistoryAPI.list();
        if (!result.success) {
            historyList.innerHTML = '<div class="history-empty">Kunde inte ladda historik</div>';
            return;
        }

        const conversations = result.conversations || [];

        if (conversations.length === 0) {
            historyList.innerHTML = '<div class="history-empty">Ingen historik ännu</div>';
            return;
        }

        historyList.innerHTML = conversations.map(conv => `
            <div class="history-item${conv.id === currentConversationId ? ' active' : ''}" onclick="loadConversation('${conv.id}')">
                <div class="history-item-content">
                    <div class="history-item-title">${escapeHtml(conv.title)}</div>
                    <div class="history-item-preview">${escapeHtml(conv.preview)}</div>
                    <div class="history-item-meta">${formatRelativeTime(conv.updatedAt || conv.createdAt)} • ${conv.messageCount || 0} meddelanden</div>
                </div>
                <button class="history-item-delete" onclick="deleteConversation('${conv.id}', event)" title="Ta bort">
                    <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                </button>
            </div>
        `).join('');
    } catch (error) {
        console.error('Failed to render history:', error);
        historyList.innerHTML = '<div class="history-empty">Kunde inte ladda historik</div>';
    }
}

// Make functions available globally for onclick handlers
window.loadConversation = loadConversation;
window.deleteConversation = deleteConversation;

// History panel elements - using global declarations from top of file
const historyBtn = document.getElementById('history-btn');
const historyPanel = document.getElementById('history-panel');
const historyClearAllBtn = document.getElementById('history-clear-all-btn');

// Toggle history panel
if (historyBtn && historyPanel) {
    historyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isShowing = historyPanel.classList.toggle('show');
        if (isShowing) {
            renderHistoryList();
        }
    });
}

// Close history panel when clicking outside
document.addEventListener('click', (e) => {
    if (historyPanel && historyPanel.classList.contains('show') &&
        !historyPanel.contains(e.target) && !historyBtn.contains(e.target)) {
        historyPanel.classList.remove('show');
    }
});

// Clear all history button
if (historyClearAllBtn) {
    historyClearAllBtn.addEventListener('click', clearAllHistory);
}

// "Ny konversation" button - start new conversation
if (clearChatBtn) {
    clearChatBtn.addEventListener('click', startNewConversation);
}

// Chat event listeners
if (chatSendBtn) {
    chatSendBtn.addEventListener('click', sendMessage);
}

if (chatInput) {
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    // Cache font size for auto-resize calculation (performance optimization)
    const baseFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
    const maxHeight = baseFontSize * 7.5; // 7.5rem
    
    // Auto-resize textarea
    chatInput.addEventListener('input', () => {
        chatInput.style.height = 'auto';
        chatInput.style.height = Math.min(chatInput.scrollHeight, maxHeight) + 'px';
    });
}

// ===== SNIPPING TOOL FUNCTIONALITY =====

// Open snipping overlay
if (snipBtn) {
    snipBtn.addEventListener('click', async () => {
        snipBtn.disabled = true;
    try {
        await window.snipAPI.openOverlay();
    } catch (error) {
        console.error('Failed to open snipping tool:', error);
        snipBtn.disabled = false;
    }
    });
}

// Listen for captured snips
window.snipAPI.onCaptured((data) => {
    console.log('Snip captured:', data);
    if (snipBtn) {
        snipBtn.disabled = false;
    }

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
if (uploadBtn && fileInput) {
    uploadBtn.addEventListener('click', () => {
        fileInput.click();
    });
}

// File input change handler
if (fileInput) {
    fileInput.addEventListener('change', (e) => {
        handleFiles(e.target.files);
        fileInput.value = ''; // Reset to allow re-uploading same file
    });
}

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
                const maxHeight = parseFloat(getComputedStyle(document.documentElement).fontSize) * 7.5; // 7.5rem
                chatInput.style.height = Math.min(chatInput.scrollHeight, maxHeight) + 'px';
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
if (chatSection && dropOverlay) {
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
}

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
    if (!attachedImagesContainer) return;
    
    if (attachedImages.length === 0) {
        attachedImagesContainer.innerHTML = '';
        return;
    }

    // Use data attribute instead of onclick to enable event delegation
    attachedImagesContainer.innerHTML = attachedImages.map(img => `
        <div class="attached-image" data-id="${img.id}">
            <img src="${img.data}" alt="Attached screenshot">
            <button class="remove-btn" data-remove-id="${img.id}">×</button>
        </div>
    `).join('');
}

// Event delegation for attached image removal (prevents memory leaks)
if (attachedImagesContainer) {
    attachedImagesContainer.addEventListener('click', (e) => {
        const removeBtn = e.target.closest('.remove-btn');
        if (removeBtn) {
            e.stopPropagation();
            const id = parseInt(removeBtn.dataset.removeId);
            if (!isNaN(id)) {
                removeAttachedImage(id);
            }
        }
    });
}

// Image modal functionality
function showImageModal(src) {
    if (modalImage && imageModal) {
        modalImage.src = src;
        imageModal.classList.add('show');
    }
}

function hideImageModal() {
    if (imageModal && modalImage) {
        imageModal.classList.remove('show');
        modalImage.src = '';
    }
}

if (imageModal) {
    imageModal.addEventListener('click', (e) => {
        if (e.target === imageModal || e.target === modalCloseBtn) {
            hideImageModal();
        }
    });
}

if (modalCloseBtn) {
    modalCloseBtn.addEventListener('click', hideImageModal);
}

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && imageModal && imageModal.classList.contains('show')) {
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
    let avatarClass = '';

    if (role === 'user') {
        const avatarUrl = currentUserData?.user_metadata?.avatar_url;
        if (avatarUrl) {
            avatarHtml = `<img src="${avatarUrl}" alt="U" class="avatar-image">`;
            avatarClass = 'avatar-custom';
        } else {
            avatarHtml = 'U';
        }
    } else {
        // AI logo
        avatarHtml = `<img src="assets/logo.svg" alt="AI" class="ai-avatar-logo">`;
    }

    let imagesHtml = '';
    if (images && images.length > 0) {
        imagesHtml = `
            <div class="message-images">
                ${images.map(img => `<img src="${img}" alt="Screenshot">`).join('')}
            </div>
        `;
    }

    messageDiv.innerHTML = `
        <div class="message-avatar ${avatarClass}">${avatarHtml}</div>
        <div class="message-content">
            ${imagesHtml}
            ${content ? formatMessageContent(content) : ''}
        </div>
    `;

    // Add click handlers for images (Issue 4: Removed redundant onclick from HTML string)
    messageDiv.querySelectorAll('.message-images img').forEach(img => {
        img.addEventListener('click', () => showImageModal(img.src));
    });

    chatMessages.appendChild(messageDiv);
    smoothScrollToBottom();
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
    if (!pinBtn || !minimizeBtn || !closeBtn) {
        console.warn('Window control buttons not found');
        return;
    }
    
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

// Mode Toggle logic
function initializeModeToggle() {
    const jobbaBtn = document.getElementById('jobba-btn');
    const chattaBtn = document.getElementById('chatta-btn');
    // Use global chatInput instead of redeclaring (fixes Issue #1)
    
    if (!jobbaBtn || !chattaBtn || !chatInput) {
        console.warn('Mode toggle elements not found');
        return;
    }

    const setMode = (mode) => {
        currentMode = mode;

        // Update UI
        jobbaBtn.classList.toggle('active', mode === 'jobba');
        chattaBtn.classList.toggle('active', mode === 'chatta');

        // Update placeholder
        if (mode === 'chatta') {
            chatInput.placeholder = 'Vad kan jag hjälpa till med?';
        } else {
            chatInput.placeholder = 'Vad vill du göra idag?';
        }

        // Update window size and constraints (fast, local)
        window.windowAPI.setWindowMode(mode);

        // Reload system prompt for new mode (async, remote)
        loadSystemPrompt();
    };

    jobbaBtn.addEventListener('click', () => setMode('jobba'));
    chattaBtn.addEventListener('click', () => setMode('chatta'));

    // Initialize with default mode
    setMode(currentMode);
}

// Initialize on load
initialize();
initializeChat();
initializeWindowControls();
initializeModeToggle();

// ===== USER INPUT LOGIC (INLINE CHAT) =====

window.userInputAPI.onRequest(({ requestId, prompt, type, options }) => {
    addInteractiveInputToChat(requestId, prompt, type, options);
});

function addInteractiveInputToChat(requestId, prompt, type, options) {
    // Remove thinking indicator if present
    removeThinkingIndicator();

    const messageDiv = document.createElement('div');
    messageDiv.className = 'chat-message assistant interactive-input';
    messageDiv.id = `interactive-${requestId}`;

    messageDiv.innerHTML = `
        <div class="message-avatar">
            <img src="assets/logo.svg" alt="AI" style="width: 18px; height: 18px; filter: brightness(0) invert(1);">
        </div>
        <div class="message-content interactive-content">
            <div class="interactive-prompt">${formatMessageContent(prompt)}</div>
            <div class="interactive-form" id="form-${requestId}"></div>
        </div>
    `;

    chatMessages.appendChild(messageDiv);
    const formContainer = messageDiv.querySelector(`#form-${requestId}`);

    if (type === 'select' && options && options.length > 0) {
        // Render options as buttons in a grid/list
        const optionsList = document.createElement('div');
        optionsList.className = 'interactive-options-list';

        options.forEach(option => {
            const btn = document.createElement('button');
            btn.className = 'interactive-option-btn';
            btn.textContent = option;
            btn.onclick = () => submitInlineInput(requestId, option, messageDiv);
            optionsList.appendChild(btn);
        });

        formContainer.appendChild(optionsList);
    } else {
        // Render text input
        const inputContainer = document.createElement('div');
        inputContainer.className = 'interactive-text-input-container';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'interactive-text-input';
        input.placeholder = 'Skriv ditt svar...';
        input.onkeydown = (e) => {
            if (e.key === 'Enter') {
                submitInlineInput(requestId, input.value, messageDiv);
            }
        };

        const submitBtn = document.createElement('button');
        submitBtn.className = 'interactive-submit-btn';
        submitBtn.innerHTML = `
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24" width="16" height="16">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"/>
            </svg>
        `;
        submitBtn.onclick = () => submitInlineInput(requestId, input.value, messageDiv);

        inputContainer.appendChild(input);
        inputContainer.appendChild(submitBtn);
        formContainer.appendChild(inputContainer);

        // Auto-focus logic
        setTimeout(() => input.focus(), 100);
    }

    smoothScrollToBottom();
}

function submitInlineInput(requestId, value, messageDiv) {
    if (!value) return;

    // Send response
    window.userInputAPI.sendResponse({ requestId, value });

    // Mark as completed in UI
    const formContainer = messageDiv.querySelector('.interactive-form');
    if (formContainer) {
        formContainer.innerHTML = `<div class="interactive-completed">
            <span class="completed-icon">✓</span>
            <span class="completed-value">${escapeHtml(value)}</span>
        </div>`;
    }
}

// ===== INFO PRESENTATION LOGIC (INLINE CHAT) =====

window.userInterfaceAPI.onPresent(({ requestId, title, content, items, data, style }) => {
    addInteractiveInfoToChat(requestId, title, content, items, data, style);
});

function addInteractiveInfoToChat(requestId, title, content, items, data, style) {
    // Remove thinking indicator if present
    removeThinkingIndicator();

    const messageDiv = document.createElement('div');
    messageDiv.className = 'chat-message assistant interactive-info';
    messageDiv.id = `info-${requestId}`;

    // Generate content HTML based on style
    let innerContent = '';

    if (style === 'steps' && items && Array.isArray(items)) {
        innerContent = '<div class="info-steps">';
        items.forEach((step, index) => {
            innerContent += `
                <div class="info-step">
                    <div class="info-step-number">${index + 1}</div>
                    <div class="info-step-text">${formatMessageContent(step)}</div>
                </div>
            `;
        });
        innerContent += '</div>';

    } else if (style === 'table' && data && typeof data === 'object') {
        innerContent = '<div class="info-table-container"><table class="info-table">';
        Object.entries(data).forEach(([key, value]) => {
            innerContent += `
                <tr>
                    <td>${escapeHtml(key)}</td>
                    <td>${escapeHtml(String(value))}</td>
                </tr>
            `;
        });
        innerContent += '</table></div>';

    } else if (style === 'list' && items && Array.isArray(items)) {
        innerContent = '<div class="info-content-markdown"><ul>';
        items.forEach(item => {
            innerContent += `<li>${formatMessageContent(item)}</li>`;
        });
        innerContent += '</ul></div>';

    } else {
        // Default text/markdown
        innerContent = `<div class="info-content-markdown">${formatMessageContent(content || '')}</div>`;
    }

    messageDiv.innerHTML = `
        <div class="message-avatar">
            <img src="assets/logo.svg" alt="AI" style="width: 18px; height: 18px; filter: brightness(0) invert(1);">
        </div>
        <div class="message-content interactive-content">
            <div class="interactive-header">
                ${title ? `<div class="interactive-title">${escapeHtml(title)}</div>` : ''}
            </div>
            <div class="interactive-body">
                ${innerContent}
            </div>
            <div class="interactive-actions" id="actions-${requestId}">
                <button class="interactive-ack-btn" onclick="acknowledgeInfo('${requestId}', this)">
                    OK / Fortsätt
                </button>
            </div>
        </div>
    `;

    chatMessages.appendChild(messageDiv);
    smoothScrollToBottom();
}

// Global function for the onclick handler (needs to be attached to window)
window.acknowledgeInfo = (requestId, btn) => {
    window.userInterfaceAPI.sendAck({ requestId });

    // UI feedback
    const actionContainer = btn.parentElement;
    actionContainer.innerHTML = '<span class="interactive-ack-text">✓ Fortsätter...</span>';
};
