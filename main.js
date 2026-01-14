const { app, BrowserWindow, ipcMain, shell, screen, desktopCapturer, globalShortcut, Menu, Tray, nativeImage, clipboard, Notification } = require('electron');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const { createClient } = require('@supabase/supabase-js');
const Store = require('electron-store');
const AutoLaunch = require('auto-launch');
const { autoUpdater } = require('electron-updater');

// Configure auto-updater
autoUpdater.logger = require('console');
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

// Check if running in development
const isDev = !app.isPackaged;

/**
 * Initialize auto-update loop and listeners
 */
function initAutoUpdate() {
  if (isDev) return;

  console.log('Initializing auto-update system...');

  // Auto-updater events
  autoUpdater.on('update-available', (info) => {
    console.log(`Update available: version ${info.version}`);
  });

  autoUpdater.on('update-not-available', () => {
    console.log('No updates available');
  });

  autoUpdater.on('error', (err) => {
    console.error('Auto-updater error:', err);
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log(`Update downloaded: version ${info.version}`);

    // Notify user that the app will restart for update
    const notification = new Notification({
      title: 'Flyt Uppdatering',
      body: `Version ${info.version} har laddats ner och kommer att installeras nu.`,
      icon: path.join(__dirname, 'assets', 'icon.png')
    });

    notification.show();

    // Small delay to allow user to see notification before restart
    setTimeout(() => {
      console.log('Quitting and installing update...');
      isQuitting = true;
      autoUpdater.quitAndInstall(false, true);
    }, 5000);
  });

  // Initial check on startup
  autoUpdater.checkForUpdatesAndNotify();

  // Check periodically every 4 hours
  setInterval(() => {
    console.log('Checking for updates (periodic)...');
    autoUpdater.checkForUpdatesAndNotify();
  }, 4 * 60 * 60 * 1000);
}

// Generate a machine-specific encryption key
function getMachineEncryptionKey() {
  // Combine machine-unique identifiers
  const hostname = os.hostname();
  const username = os.userInfo().username;
  const platform = os.platform();
  const cpuModel = os.cpus()[0]?.model || 'unknown';

  // Get primary network interface MAC address for additional uniqueness
  const networkInterfaces = os.networkInterfaces();
  let macAddress = 'unknown';

  // Sort interface names to ensure deterministic selection across reboots
  const interfaceNames = Object.keys(networkInterfaces).sort();

  for (const interfaceName of interfaceNames) {
    const iface = networkInterfaces[interfaceName];
    for (const entry of iface) {
      if (!entry.internal && entry.mac && entry.mac !== '00:00:00:00:00:00') {
        macAddress = entry.mac;
        break;
      }
    }
    if (macAddress !== 'unknown') break;
  }

  // Create a deterministic hash from machine identifiers
  const machineId = `${hostname}:${username}:${platform}:${cpuModel}:${macAddress}`;
  const hash = crypto.createHash('sha256').update(machineId).digest('hex');

  return hash;
}

// Import the modular tool system
const {
  initializeTools,
  registry,
  parseToolCall,
  formatToolResult,
  getToolDocumentation,
  getCompactToolDocumentation
} = require('./tools');

// ============= AGENT LOOP OPTIMIZATION SETTINGS =============
const AGENT_CONFIG = {
  // Use compact tool documentation (80% smaller, ~500 tokens vs ~2500)
  // Set to false if the model has trouble understanding tool format
  useCompactDocs: true,

  // Conversation windowing settings
  maxConversationMessages: 20,     // Keep last N messages (excluding system)
  summarizeAfter: 10,              // Summarize after this many tool iterations
  maxToolResultSize: 2000,         // Truncate tool results to this size
  maxErrorResultSize: 500,         // Truncate error outputs to this size

  // System context settings
  includeSystemContext: true,      // Include system info in first message
  refreshSystemContextEvery: 5,    // Refresh system context every N iterations (0 = never)
  minimalSystemContext: true,      // Use minimal system context (no processes, windows)

  // Native function calling (more efficient for supported models)
  useNativeFunctionCalling: false, // Set to true to use OpenRouter's native tools API
  nativeFunctionCallingModels: [   // Models that support native function calling well
    'anthropic/claude-3',
    'anthropic/claude-3.5',
    'openai/gpt-4',
    'openai/gpt-4o',
    'google/gemini-pro',
    'google/gemini-1.5',
  ],
};

/**
 * Check if a model supports native function calling
 * @param {string} model - Model identifier
 * @returns {boolean}
 */
function supportsNativeFunctionCalling(model) {
  if (!model) return false;
  return AGENT_CONFIG.nativeFunctionCallingModels.some(m => model.toLowerCase().includes(m.toLowerCase()));
}

// Tray instance
let tray = null;

// Auto-launch configuration
const autoLauncher = new AutoLaunch({
  name: 'Flyt',
  path: app.getPath('exe'),
  isHidden: true // Start minimized to tray
});

// Snipping tool state
let snippingWindow = null;
let capturedScreenshots = [];
let isSnippingToolOpening = false; // Flag to prevent race conditions with rapid shortcut presses

// Supabase configuration
const SUPABASE_URL = 'https://cddircpnawvpryttmpel.supabase.co';
const SUPABASE_KEY = 'sb_publishable_lDoWq98zufz9gRxUCSl-3A_NXIWcpyJ';

// Custom protocol for OAuth callback (must match Supabase redirect URL)
const OAUTH_CALLBACK_PROTOCOL = 'flyt';
const OAUTH_REDIRECT_URL = `${OAUTH_CALLBACK_PROTOCOL}://auth-callback`;

// Encrypted store for session data (machine-specific encryption)
// Handle case where encryption key changed and old store can't be decrypted
function createStore() {
  const encryptionKey = getMachineEncryptionKey();
  const storeName = 'auth-store';

  try {
    const newStore = new Store({
      encryptionKey,
      name: storeName
    });
    // Test that we can read the store (triggers decryption)
    newStore.get('__test__');
    return newStore;
  } catch (error) {
    console.log('Existing store encrypted with different key, clearing...');
    // Delete the old store file and create fresh
    const fs = require('fs');
    const storePath = path.join(app.getPath('userData'), `${storeName}.json`);
    try {
      if (fs.existsSync(storePath)) {
        fs.unlinkSync(storePath);
        console.log('Old store file deleted');
      }
    } catch (deleteError) {
      console.error('Error deleting old store:', deleteError);
    }
    // Create a fresh store
    return new Store({
      encryptionKey,
      name: storeName
    });
  }
}

let store; // Initialized in app.whenReady()

let supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
let mainWindow = null;
let authWindow = null;
let currentUser = null;
let isQuitting = false; // Track if we're actually quitting vs hiding to tray

// Create system tray icon
function createTray() {
  if (tray) return; // Already created

  // Load the icon from the assets folder
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  let trayIcon;

  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    // Resize for tray if needed (usually 16x16 or 32x32 depending on OS)
    trayIcon = trayIcon.resize({ width: 16, height: 16 });
    tray = new Tray(trayIcon);
  } catch (err) {
    console.log('Could not load tray icon from path, creating fallback');
    const emptyIcon = nativeImage.createEmpty();
    tray = new Tray(emptyIcon.resize({ width: 16, height: 16 }));
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Visa Flyt',
      click: () => {
        showApp();
      }
    },
    {
      label: 'Starta med Windows',
      type: 'checkbox',
      checked: true, // Enabled by default
      click: async (menuItem) => {
        try {
          if (menuItem.checked) {
            await autoLauncher.enable();
            console.log('Auto-launch enabled');
          } else {
            await autoLauncher.disable();
            console.log('Auto-launch disabled');
          }
        } catch (err) {
          console.error('Auto-launch toggle error:', err);
        }
      }
    },
    { type: 'separator' },
    {
      label: 'Avsluta Flyt',
      click: () => {
        isQuitting = true;
        app.quit();
      }
    }
  ]);

  // Check current auto-launch status and update menu
  autoLauncher.isEnabled().then((isEnabled) => {
    contextMenu.items[1].checked = isEnabled;
    tray.setContextMenu(contextMenu);
  }).catch(() => {
    tray.setContextMenu(contextMenu);
  });

  tray.setToolTip('Flyt - Ctrl+Shift+C: visa/dölj | Ctrl+Shift+V: klippverktyg');
  tray.setContextMenu(contextMenu);

  // Double-click on tray icon shows the app
  tray.on('double-click', () => {
    showApp();
  });

  console.log('System tray created');
}

// Show the app window
function showApp() {
  const targetWindow = mainWindow || authWindow;

  if (targetWindow) {
    if (targetWindow.isMinimized()) {
      targetWindow.restore();
    }
    if (!targetWindow.isVisible()) {
      targetWindow.show();
    }
    targetWindow.focus();
  } else {
    // No window exists, create one
    if (currentUser) {
      createMainWindow();
    } else {
      createAuthWindow();
    }
  }
}

// Toggle app window visibility (show/hide) - Smart toggle
// If hidden/minimized: show and focus
// If visible but NOT focused (behind other windows): bring to front
// If visible AND focused: hide
function toggleAppVisibility() {
  const targetWindow = mainWindow || authWindow;

  if (targetWindow) {
    if (!targetWindow.isVisible() || targetWindow.isMinimized()) {
      // Window is hidden or minimized, show it
      if (targetWindow.isMinimized()) {
        targetWindow.restore();
      }
      targetWindow.show();
      targetWindow.focus();
      console.log('Window shown via shortcut');
    } else if (!targetWindow.isFocused()) {
      // Window is visible but not focused (behind other windows), bring to front
      targetWindow.focus();
      console.log('Window focused via shortcut (was behind other windows)');
    } else {
      // Window is visible and focused, hide it
      targetWindow.hide();
      console.log('Window hidden via shortcut');
    }
  } else {
    // No window exists, create one
    if (currentUser) {
      createMainWindow();
    } else {
      createAuthWindow();
    }
  }
}

// Open snipping tool via global shortcut
async function openSnippingTool() {
  // Prevent opening snipping tool if already active or currently opening (race condition guard)
  if (snippingWindow && !snippingWindow.isDestroyed()) {
    console.log('Snipping tool already active, ignoring shortcut');
    return;
  }
  
  if (isSnippingToolOpening) {
    console.log('Snipping tool already opening, ignoring rapid shortcut');
    return;
  }
  
  // Set flag immediately to prevent race conditions
  isSnippingToolOpening = true;

  try {
    const displays = screen.getAllDisplays();

    // Get combined bounds of all displays
    const minX = Math.min(...displays.map(d => d.bounds.x));
    const minY = Math.min(...displays.map(d => d.bounds.y));
    const maxX = Math.max(...displays.map(d => d.bounds.x + d.bounds.width));
    const maxY = Math.max(...displays.map(d => d.bounds.y + d.bounds.height));

    const totalWidth = maxX - minX;
    const totalHeight = maxY - minY;

    // Hide main window temporarily
    if (mainWindow) {
      mainWindow.hide();
    }

    // Small delay to ensure window is hidden before capture
    await new Promise(resolve => setTimeout(resolve, 200));

    // Capture fresh screenshots after hiding
    // Use native resolution by accounting for scale factor
    const maxScaleFactor = Math.max(...displays.map(d => d.scaleFactor || 1));
    const freshSources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.round(Math.max(...displays.map(d => d.size.width)) * maxScaleFactor),
        height: Math.round(Math.max(...displays.map(d => d.size.height)) * maxScaleFactor)
      }
    });

    capturedScreenshots = freshSources.map((source, index) => {
      const display = displays[index] || displays[0];
      return {
        id: source.id,
        name: source.name,
        thumbnail: source.thumbnail.toDataURL(),
        bounds: display.bounds,
        scaleFactor: display.scaleFactor
      };
    });

    // Create fullscreen transparent overlay window
    snippingWindow = new BrowserWindow({
      x: minX,
      y: minY,
      width: totalWidth,
      height: totalHeight,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      fullscreenable: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    snippingWindow.loadFile('snipping.html');
    snippingWindow.setVisibleOnAllWorkspaces(true);

    snippingWindow.on('closed', () => {
      snippingWindow = null;
      isSnippingToolOpening = false; // Reset flag when window closes
      if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
      }
    });

    // Send screenshot data once window is ready
    snippingWindow.webContents.on('did-finish-load', () => {
      snippingWindow.webContents.send('snip:screenshotData', {
        screenshots: capturedScreenshots,
        displays: displays.map(d => ({
          id: d.id,
          bounds: d.bounds,
          scaleFactor: d.scaleFactor
        })),
        offset: { x: minX, y: minY }
      });
    });

    console.log('Snipping tool opened via shortcut');
  } catch (error) {
    console.error('Snipping tool shortcut error:', error);
    isSnippingToolOpening = false; // Reset flag on error
    if (mainWindow) {
      mainWindow.show();
    }
  }
}

// Token system constants
const TOKENS_PER_DOLLAR = 10000; // 10,000 tokens = $1 USD

// Store tokens in encrypted store
function storeTokens(accessToken, refreshToken) {
  try {
    store.set('auth', {
      access_token: accessToken,
      refresh_token: refreshToken,
      stored_at: Date.now()
    });
    console.log('Tokens stored');
  } catch (error) {
    console.error('Error storing tokens:', error);
  }
}

// Get tokens from encrypted store
function getTokens() {
  try {
    return store.get('auth');
  } catch (error) {
    console.error('Error getting tokens:', error);
    return null;
  }
}

// Clear tokens
function clearTokens() {
  try {
    store.delete('auth');
    console.log('Tokens cleared');
  } catch (error) {
    console.error('Error clearing tokens:', error);
  }
}

// ===== TOKEN MANAGEMENT FUNCTIONS =====

// Get user's token balance from Supabase
async function getUserTokens(userId) {
  try {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('tokens, tokens_used, tier')
      .eq('id', userId)
      .single();

    if (error) {
      console.error('Error fetching user tokens:', error);
      // If profile doesn't exist, create it
      if (error.code === 'PGRST116') {
        const user = await supabase.auth.getUser();
        if (user.data.user) {
          await createUserProfile(user.data.user);
          return { tokens: 10000, tokens_used: 0, tier: 'free' };
        }
      }
      return null;
    }

    return data;
  } catch (error) {
    console.error('Error in getUserTokens:', error);
    return null;
  }
}

// Create user profile if it doesn't exist
async function createUserProfile(user) {
  try {
    const { error } = await supabase
      .from('user_profiles')
      .insert({
        id: user.id,
        email: user.email,
        tokens: 10000, // Starting balance
        tokens_used: 0,
        tier: 'free'
      });

    if (error && error.code !== '23505') { // Ignore duplicate key errors
      console.error('Error creating user profile:', error);
      return false;
    }

    console.log('User profile created for:', user.email);
    return true;
  } catch (error) {
    console.error('Error in createUserProfile:', error);
    return false;
  }
}

// Deduct tokens after AI usage based on OpenRouter cost
async function deductTokens(userId, openRouterCost, model, description = 'AI inference') {
  try {
    // Convert USD cost to tokens (10,000 tokens = $1)
    const tokensToDeduct = Math.ceil(openRouterCost * TOKENS_PER_DOLLAR);

    if (tokensToDeduct <= 0) {
      console.log('No tokens to deduct (cost was 0 or negative)');
      return { success: true, tokensDeducted: 0 };
    }

    // Get current balance
    const { data: profile, error: fetchError } = await supabase
      .from('user_profiles')
      .select('tokens, tokens_used')
      .eq('id', userId)
      .single();

    if (fetchError) {
      console.error('Error fetching profile for deduction:', fetchError);
      return { success: false, error: fetchError.message };
    }

    const newBalance = Math.max(0, profile.tokens - tokensToDeduct);
    const newTokensUsed = profile.tokens_used + tokensToDeduct;

    // Update the balance
    const { error: updateError } = await supabase
      .from('user_profiles')
      .update({
        tokens: newBalance,
        tokens_used: newTokensUsed
      })
      .eq('id', userId);

    if (updateError) {
      console.error('Error updating token balance:', updateError);
      return { success: false, error: updateError.message };
    }

    // Record the transaction
    await supabase
      .from('token_transactions')
      .insert({
        user_id: userId,
        amount: -tokensToDeduct,
        balance_after: newBalance,
        transaction_type: 'usage',
        description: description,
        model: model,
        openrouter_cost: openRouterCost
      });

    console.log(`Deducted ${tokensToDeduct} tokens (cost: $${openRouterCost.toFixed(6)}) - New balance: ${newBalance}`);

    return {
      success: true,
      tokensDeducted: tokensToDeduct,
      newBalance: newBalance,
      cost: openRouterCost
    };
  } catch (error) {
    console.error('Error in deductTokens:', error);
    return { success: false, error: error.message };
  }
}

// Add tokens to user account (for purchases, bonuses, tier refills)
async function addTokens(userId, amount, transactionType = 'bonus', description = '') {
  try {
    // Get current balance
    const { data: profile, error: fetchError } = await supabase
      .from('user_profiles')
      .select('tokens')
      .eq('id', userId)
      .single();

    if (fetchError) {
      console.error('Error fetching profile for addition:', fetchError);
      return { success: false, error: fetchError.message };
    }

    const newBalance = profile.tokens + amount;

    // Update the balance
    const { error: updateError } = await supabase
      .from('user_profiles')
      .update({ tokens: newBalance })
      .eq('id', userId);

    if (updateError) {
      console.error('Error updating token balance:', updateError);
      return { success: false, error: updateError.message };
    }

    // Record the transaction
    await supabase
      .from('token_transactions')
      .insert({
        user_id: userId,
        amount: amount,
        balance_after: newBalance,
        transaction_type: transactionType,
        description: description
      });

    console.log(`Added ${amount} tokens - New balance: ${newBalance}`);

    return { success: true, tokensAdded: amount, newBalance: newBalance };
  } catch (error) {
    console.error('Error in addTokens:', error);
    return { success: false, error: error.message };
  }
}

// Get model-specific pricing for cost estimation (per 1M tokens)
// These are fallback values - actual costs come from OpenRouter API
function getModelPricing(model) {
  const pricing = {
    // Google
    'google/gemini-2.5-flash-preview': { input: 0.15, output: 0.60 },
    'google/gemini-pro-1.5': { input: 1.25, output: 5.00 },
    'google/gemini-flash-1.5': { input: 0.075, output: 0.30 },
    // Zhipu AI
    'z-ai/glm-4.7': { input: 0.50, output: 0.50 },
    // OpenAI
    'openai/gpt-4o-mini': { input: 0.15, output: 0.60 },
    'openai/gpt-4o': { input: 2.50, output: 10.00 },
    'openai/gpt-4-turbo': { input: 10.00, output: 30.00 },
    // Anthropic
    'anthropic/claude-3.5-sonnet': { input: 3.00, output: 15.00 },
    'anthropic/claude-3-haiku': { input: 0.25, output: 1.25 },
    'anthropic/claude-3-opus': { input: 15.00, output: 75.00 },
  };

  // Return model-specific pricing or a conservative default
  return pricing[model] || { input: 3.00, output: 15.00 };
}

// Get OpenRouter generation cost from the API (with retry for async cost calculation)
async function getOpenRouterGenerationCost(generationId, retries = 3, delayMs = 500) {
  const apiKey = await getOpenRouterApiKey();
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // Wait a bit for OpenRouter to calculate the cost
      await new Promise(resolve => setTimeout(resolve, delayMs * attempt));

      // OpenRouter provides cost info in the generation details endpoint
      const response = await fetch(`https://openrouter.ai/api/v1/generation?id=${generationId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        console.log(`Attempt ${attempt}: Could not fetch generation cost (status ${response.status})`);
        continue;
      }

      const data = await response.json();
      console.log(`Generation cost data (attempt ${attempt}):`, JSON.stringify(data, null, 2));

      // OpenRouter returns cost in 'data' object
      const cost = data.data?.total_cost ?? data.data?.native_tokens_cost ?? null;

      if (cost !== null && cost !== undefined) {
        console.log(`Got actual OpenRouter cost: $${cost}`);
        return cost;
      }

      // Cost not yet available, retry
      console.log(`Attempt ${attempt}: Cost not yet available, retrying...`);
    } catch (error) {
      console.error(`Attempt ${attempt} error fetching generation cost:`, error.message);
    }
  }

  console.log('Could not fetch actual cost after retries, will use estimate');
  return null;
}

// Initialize session from stored tokens
async function initializeSession() {
  console.log('Checking for stored session...');
  const tokens = getTokens();

  if (!tokens || !tokens.access_token || !tokens.refresh_token) {
    console.log('No stored tokens found');
    return null;
  }

  console.log('Found stored tokens, validating...');

  try {
    const { data, error } = await supabase.auth.setSession({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token
    });

    if (error) {
      console.log('Session invalid or expired:', error.message);
      // Don't clear tokens immediately, Supabase might still be trying to refresh
      if (error.message.includes('refresh_token_not_found') || error.message.includes('Invalid Refresh Token')) {
        console.log('Refresh token is invalid, clearing session');
        clearTokens();
      }
      return null;
    }

    if (data.session) {
      console.log('Session restored successfully for:', data.session.user.email);
      storeTokens(data.session.access_token, data.session.refresh_token);
      return data.session.user;
    }
  } catch (error) {
    console.error('Error restoring session:', error);
    // Only clear on catastrophic errors
  }

  return null;
}

// Set up auth state change listener to keep store in sync
function setupAuthListener() {
  console.log('Setting up Supabase auth listener...');

  supabase.auth.onAuthStateChange(async (event, session) => {
    console.log(`Auth state change: ${event}`);

    if (session) {
      currentUser = session.user;
      storeTokens(session.access_token, session.refresh_token);

      // Notify any open windows about the session update
      const targetWindow = mainWindow || authWindow;
      if (targetWindow && !targetWindow.isDestroyed()) {
        targetWindow.webContents.send('auth:status-changed', {
          loggedIn: true,
          user: session.user
        });
      }
    } else if (event === 'SIGNED_OUT') {
      currentUser = null;
      clearTokens();

      const targetWindow = mainWindow || authWindow;
      if (targetWindow && !targetWindow.isDestroyed()) {
        targetWindow.webContents.send('auth:status-changed', {
          loggedIn: false,
          user: null
        });
      }
    }
  });
}

function createAuthWindow() {
  // Prevent duplicate windows
  if (authWindow && !authWindow.isDestroyed()) {
    console.log('Auth window already exists, focusing...');
    authWindow.show();
    authWindow.focus();
    return;
  }
  console.log('Creating auth window...');

  // Get screen dimensions
  const primaryDisplay = screen.getPrimaryDisplay();
  const { height: screenHeight } = primaryDisplay.workAreaSize;

  // Auth window - centered on screen
  const windowWidth = 420;
  const windowHeight = Math.min(650, screenHeight - 40);

  authWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    center: true,
    resizable: false,
    show: true,
    frame: false, // Frameless window
    transparent: false,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  authWindow.loadFile('auth.html');
  console.log('Auth window created - centered');

  // Hide to tray instead of quitting when closed
  authWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      authWindow.hide();
      console.log('Auth window hidden to tray');
    }
  });

  authWindow.on('closed', () => {
    authWindow = null;
  });
}

function createMainWindow() {
  // Prevent duplicate windows
  if (mainWindow && !mainWindow.isDestroyed()) {
    console.log('Main window already exists, focusing...');
    mainWindow.show();
    mainWindow.focus();
    return;
  }
  console.log('Creating main window...');

  // Get screen dimensions for helper popup positioning
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  const { x: workAreaX, y: workAreaY } = primaryDisplay.workArea;

  // Helper popup dimensions - narrow, almost full height, right-aligned
  const windowWidth = 470;
  const windowHeight = screenHeight - 40; // Leave some margin
  const windowX = workAreaX + screenWidth - windowWidth - 10; // 10px from right edge
  const windowY = workAreaY + 20; // 20px from top

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: windowX,
    y: windowY,
    minWidth: 360,
    minHeight: 400,
    maxWidth: 600,
    show: true,
    frame: false, // Frameless window - no Windows title bar
    transparent: false,
    resizable: true,
    skipTaskbar: false,
    alwaysOnTop: false, // Can be toggled by user
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile('index.html');
  console.log('Main window created - helper popup style');

  // Hide to tray instead of quitting when closed
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      console.log('Main window hidden to tray');
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Auto-updater events
// (Moved to initAutoUpdate)

// IPC Handlers
ipcMain.handle('auth:signup', async (event, { email, password }) => {
  try {
    const { data, error } = await supabase.auth.signUp({ email, password });

    if (error) {
      return { success: false, error: error.message };
    }

    if (data.user && !data.session) {
      return {
        success: true,
        requiresConfirmation: true,
        message: 'Kontrollera din e-post för att bekräfta ditt konto.'
      };
    }

    if (data.session) {
      currentUser = data.user;
      storeTokens(data.session.access_token, data.session.refresh_token);
    }

    return { success: true, user: data.user, requiresConfirmation: false };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('auth:login', async (event, { email, password }) => {
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      return { success: false, error: error.message };
    }

    currentUser = data.user;
    storeTokens(data.session.access_token, data.session.refresh_token);

    // Ensure user profile exists (in case trigger didn't fire)
    await createUserProfile(data.user);

    return { success: true, user: data.user };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('auth:logout', async () => {
  try {
    await supabase.auth.signOut();
    currentUser = null;
    clearTokens();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('auth:getUser', async () => {
  try {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      return { success: false, user: null };
    }
    return { success: true, user: data.user };
  } catch (error) {
    return { success: false, user: null, error: error.message };
  }
});

ipcMain.handle('auth:resetPassword', async (event, { email }) => {
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true, message: 'Password reset email sent!' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Google OAuth login
let oauthWindow = null;

ipcMain.handle('auth:googleLogin', async () => {
  try {
    // Generate the OAuth URL with PKCE
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: OAUTH_REDIRECT_URL,
        skipBrowserRedirect: true // We'll handle the redirect ourselves
      }
    });

    if (error) {
      return { success: false, error: error.message };
    }

    // Open OAuth window
    oauthWindow = new BrowserWindow({
      width: 500,
      height: 700,
      show: true,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    // Load the OAuth URL
    oauthWindow.loadURL(data.url);

    // Handle window close
    oauthWindow.on('closed', () => {
      oauthWindow = null;
    });

    return { success: true, message: 'OAuth window opened' };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Handle OAuth callback from custom protocol
async function handleOAuthCallback(url) {
  console.log('OAuth callback received:', url);

  try {
    // Parse the URL to extract tokens
    const urlObj = new URL(url);

    // Tokens can be in hash fragment or query params depending on flow
    let accessToken, refreshToken;

    // Check hash fragment first (implicit flow)
    if (urlObj.hash) {
      const hashParams = new URLSearchParams(urlObj.hash.substring(1));
      accessToken = hashParams.get('access_token');
      refreshToken = hashParams.get('refresh_token');
    }

    // Check query params (PKCE flow)
    if (!accessToken) {
      accessToken = urlObj.searchParams.get('access_token');
      refreshToken = urlObj.searchParams.get('refresh_token');
    }

    // If we have a code instead of tokens (authorization code flow)
    const code = urlObj.searchParams.get('code');
    if (code && !accessToken) {
      // Exchange code for session
      const { data, error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        console.error('Code exchange error:', error);
        return;
      }
      if (data.session) {
        accessToken = data.session.access_token;
        refreshToken = data.session.refresh_token;
        currentUser = data.session.user;
      }
    }

    if (accessToken && refreshToken) {
      // Set the session
      const { data, error } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken
      });

      if (error) {
        console.error('Session set error:', error);
        return;
      }

      if (data.session) {
        currentUser = data.session.user;
        storeTokens(data.session.access_token, data.session.refresh_token);
        console.log('Google OAuth successful for:', currentUser.email);

        // Close OAuth window if open
        if (oauthWindow) {
          oauthWindow.close();
          oauthWindow = null;
        }

        // Close auth window and open main window
        if (authWindow) {
          authWindow.close();
          authWindow = null;
        }
        createMainWindow();
      }
    }
  } catch (error) {
    console.error('OAuth callback error:', error);
  }
}

ipcMain.handle('auth:complete', async () => {
  console.log('auth:complete called - currentUser:', !!currentUser, 'authWindow:', !!authWindow);

  if (currentUser) {
    // Destroy the auth window if it exists
    if (authWindow && !authWindow.isDestroyed()) {
      console.log('Destroying auth window...');
      authWindow.destroy();
      authWindow = null;
    }

    // Create the main window
    console.log('Creating main window after auth...');
    createMainWindow();
    return { success: true };
  }
  return { success: false, error: 'No authenticated user' };
});

ipcMain.handle('auth:logoutAndShowAuth', async () => {
  try {
    await supabase.auth.signOut();
    currentUser = null;
    clearTokens();

    if (mainWindow) {
      mainWindow.close();
      mainWindow = null;
    }

    createAuthWindow();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});



// ===== AUTO-LAUNCH IPC HANDLERS =====

// Get auto-launch status
ipcMain.handle('autoLaunch:getStatus', async () => {
  try {
    const isEnabled = await autoLauncher.isEnabled();
    return { success: true, enabled: isEnabled };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Enable auto-launch
ipcMain.handle('autoLaunch:enable', async () => {
  try {
    await autoLauncher.enable();
    console.log('Auto-launch enabled');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Disable auto-launch
ipcMain.handle('autoLaunch:disable', async () => {
  try {
    await autoLauncher.disable();
    console.log('Auto-launch disabled');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Minimize to tray
ipcMain.handle('app:minimizeToTray', async () => {
  const targetWindow = mainWindow || authWindow;
  if (targetWindow) {
    targetWindow.hide();
  }
  return { success: true };
});

// ===== WINDOW CONTROL IPC HANDLERS =====

// Close window (hide to tray)
ipcMain.handle('window:close', async () => {
  const targetWindow = mainWindow || authWindow;
  if (targetWindow) {
    targetWindow.hide();
  }
  return { success: true };
});

// Minimize window
ipcMain.handle('window:minimize', async () => {
  const targetWindow = mainWindow || authWindow;
  if (targetWindow) {
    targetWindow.minimize();
  }
  return { success: true };
});

// Toggle always on top
ipcMain.handle('window:toggleAlwaysOnTop', async () => {
  const targetWindow = mainWindow || authWindow;
  if (targetWindow) {
    const isAlwaysOnTop = targetWindow.isAlwaysOnTop();
    targetWindow.setAlwaysOnTop(!isAlwaysOnTop);
    return { success: true, alwaysOnTop: !isAlwaysOnTop };
  }
  return { success: false };
});

// Get always on top status
ipcMain.handle('window:getAlwaysOnTop', async () => {
  const targetWindow = mainWindow || authWindow;
  if (targetWindow) {
    return { success: true, alwaysOnTop: targetWindow.isAlwaysOnTop() };
  }
  return { success: false, alwaysOnTop: false };
});

// ===== TOKEN IPC HANDLERS =====

// Get current user's token balance
ipcMain.handle('tokens:getBalance', async () => {
  try {
    if (!currentUser) {
      return { success: false, error: 'Inte inloggad' };
    }

    const tokenData = await getUserTokens(currentUser.id);
    if (!tokenData) {
      return { success: false, error: 'Kunde inte hämta tokensaldo' };
    }

    return {
      success: true,
      tokens: tokenData.tokens,
      tokensUsed: tokenData.tokens_used,
      tier: tokenData.tier
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get token transaction history
ipcMain.handle('tokens:getHistory', async (event, { limit = 50 }) => {
  try {
    if (!currentUser) {
      return { success: false, error: 'Inte inloggad' };
    }

    const { data, error } = await supabase
      .from('token_transactions')
      .select('*')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, transactions: data };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Tool system is now modular - see /tools directory
// executeCommand and parseToolCall are handled by the registry

/**
 * Apply conversation windowing to reduce context size
 * Keeps: system message + recent messages within window
 * Optionally summarizes older tool interactions
 * 
 * @param {Array} messages - Full message history
 * @param {Object} config - Windowing configuration
 * @returns {Array} - Windowed messages for API
 */
function applyConversationWindowing(messages, config = AGENT_CONFIG) {
  if (messages.length <= config.maxConversationMessages + 1) {
    return messages; // No windowing needed
  }

  const windowedMessages = [];

  // Always keep the system message first
  const systemMessage = messages.find(m => m.role === 'system');
  if (systemMessage) {
    windowedMessages.push(systemMessage);
  }

  // Get non-system messages
  const nonSystemMessages = messages.filter(m => m.role !== 'system');

  // If we have too many messages, keep only the window
  if (nonSystemMessages.length > config.maxConversationMessages) {
    const droppedCount = nonSystemMessages.length - config.maxConversationMessages;

    // Add a summary of dropped context (optional)
    if (droppedCount > 0) {
      // Count tool calls in dropped messages
      const droppedMessages = nonSystemMessages.slice(0, droppedCount);
      const toolCallCount = droppedMessages.filter(m =>
        m.role === 'assistant' && m.content?.includes('tool_call')
      ).length;

      if (toolCallCount > 0) {
        windowedMessages.push({
          role: 'system',
          content: `[Context: ${toolCallCount} earlier tool operations completed successfully]`
        });
      }
    }

    // Keep the last N messages
    const keptMessages = nonSystemMessages.slice(-config.maxConversationMessages);
    windowedMessages.push(...keptMessages);
  } else {
    windowedMessages.push(...nonSystemMessages);
  }

  return windowedMessages;
}

/**
 * Estimate token count for messages (rough approximation)
 * ~4 chars per token for English text
 * @param {Array} messages 
 * @returns {number}
 */
function estimateTokenCount(messages) {
  let totalChars = 0;
  for (const msg of messages) {
    if (typeof msg.content === 'string') {
      totalChars += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content) {
        if (part.type === 'text') {
          totalChars += part.text.length;
        }
      }
    }
  }
  return Math.ceil(totalChars / 4);
}

// LLM Chat handler using OpenRouter API (with agent loop for tool calls)
// Uses the modular tool system from /tools directory
ipcMain.handle('llm:chat', async (event, { messages }) => {
  try {
    // Ensure user is authenticated before allowing LLM access
    if (!currentUser) {
      return { success: false, error: 'Du måste vara inloggad för att använda AI-assistenten.' };
    }

    // Fetch the active model from Supabase
    const model = await getActiveModel();
    console.log('Using model from Supabase:', model);

    // Fetch the OpenRouter API key from Supabase
    const apiKey = await getOpenRouterApiKey();
    if (!apiKey) {
      return { success: false, error: 'OpenRouter API-nyckel kunde inte hämtas. Kontakta support.' };
    }

    // Check token balance before making request
    const tokenData = await getUserTokens(currentUser.id);
    if (!tokenData) {
      return { success: false, error: 'Kunde inte verifiera tokensaldo. Försök igen.' };
    }

    if (tokenData.tokens <= 0) {
      return {
        success: false,
        error: 'Insufficient tokens. Please upgrade your tier or wait for your token refill.',
        insufficientTokens: true,
        currentBalance: tokenData.tokens
      };
    }

    const MAX_TOOL_ITERATIONS = 15; // Allow more iterations for complex multi-step tasks
    let currentMessages = [...messages];
    let iteration = 0;
    let allToolExecutions = []; // Track all tool executions for this request
    let totalCost = 0; // Track total cost across all iterations

    while (iteration < MAX_TOOL_ITERATIONS) {
      iteration++;

      // Log the request
      console.log('\n========== LLM REQUEST (Iteration ' + iteration + ') ==========');
      console.log('Model:', model);
      console.log('Messages count:', currentMessages.length);
      console.log('Available tools:', registry.getToolNames().join(', '));

      // Apply conversation windowing to reduce context size
      const windowedMessages = applyConversationWindowing(currentMessages);
      const estimatedTokens = estimateTokenCount(windowedMessages);

      // Log message summary (use windowed messages)
      console.log(`Windowed from ${currentMessages.length} to ${windowedMessages.length} messages (~${estimatedTokens} tokens)`);
      windowedMessages.forEach((msg, i) => {
        console.log(`\n--- Message ${i + 1} (${msg.role}) ---`);
        const content = typeof msg.content === 'string' ? msg.content : '[multipart]';
        // Truncate log output for readability
        console.log(content.length > 500 ? content.substring(0, 500) + '...[truncated]' : content);
      });
      console.log('==================================\n');

      // Build request body (optionally with native function calling)
      const useNativeTools = AGENT_CONFIG.useNativeFunctionCalling && supportsNativeFunctionCalling(model);
      const requestBody = {
        model: model,
        messages: windowedMessages, // Use windowed messages to reduce context size
        max_tokens: 4096, // Increased for complex tool responses
        temperature: 0.7
      };

      // Add native function calling if enabled and supported
      if (useNativeTools) {
        requestBody.tools = registry.getSchemas();
        requestBody.tool_choice = 'auto';
        console.log('Using native function calling with', requestBody.tools.length, 'tools');
      }

      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://flyt-app.local',
          'X-Title': 'Flyt'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('LLM API Error:', errorData);
        return {
          success: false,
          error: errorData.error?.message || `API request failed with status ${response.status}`
        };
      }

      const data = await response.json();
      const assistantMessage = data.choices?.[0]?.message?.content;

      // Log the full response JSON for debugging
      console.log('\n========== LLM RAW RESPONSE (Iteration ' + iteration + ') ==========');
      console.log(JSON.stringify(data, null, 2));
      console.log('===================================\n');

      // Log the response
      console.log('\n========== LLM RESPONSE (Iteration ' + iteration + ') ==========');
      console.log('Model used:', data.model);
      console.log('Usage:', JSON.stringify(data.usage));
      console.log('\n--- Assistant Response ---');
      console.log(assistantMessage || '[No response]');
      console.log('===================================\n');

      // Track cost from this iteration
      let iterationCost = 0;
      let costSource = 'none';

      if (data.usage?.total_cost) {
        iterationCost = data.usage.total_cost;
        costSource = 'response';
      } else if (data.id) {
        const fetchedCost = await getOpenRouterGenerationCost(data.id);
        if (fetchedCost !== null) {
          iterationCost = fetchedCost;
          costSource = 'api';
        } else {
          const promptTokens = data.usage?.prompt_tokens || 0;
          const completionTokens = data.usage?.completion_tokens || 0;
          const modelPricing = getModelPricing(model);
          iterationCost = (promptTokens * modelPricing.input / 1000000) +
            (completionTokens * modelPricing.output / 1000000);
          costSource = 'estimate';
        }
      }

      totalCost += iterationCost;
      console.log(`Iteration ${iteration} cost: $${iterationCost.toFixed(6)} (${costSource}), Total: $${totalCost.toFixed(6)}`);

      // Check for native function calling response first
      const nativeToolCalls = data.choices?.[0]?.message?.tool_calls;

      if (nativeToolCalls && nativeToolCalls.length > 0) {
        // Handle native function calling response
        const nativeCall = nativeToolCalls[0]; // Handle first tool call
        const toolName = nativeCall.function?.name;
        let toolParams = {};

        try {
          toolParams = JSON.parse(nativeCall.function?.arguments || '{}');
        } catch (e) {
          console.warn('Failed to parse native tool arguments:', e.message);
        }

        console.log('\n========== NATIVE TOOL CALL DETECTED ==========');
        console.log('Tool:', toolName);
        console.log('Parameters:', JSON.stringify(toolParams, null, 2));
        console.log('================================================\n');

        if (!registry.has(toolName)) {
          console.warn(`Unknown tool requested: ${toolName}`);
          currentMessages.push({
            role: 'assistant',
            content: assistantMessage || '',
            tool_calls: nativeToolCalls
          });
          currentMessages.push({
            role: 'tool',
            tool_call_id: nativeCall.id,
            content: `Error: Unknown tool "${toolName}". Available: ${registry.getToolNames().join(', ')}`
          });
          continue;
        }

        // Execute the tool
        const toolResult = await registry.execute(toolName, toolParams, {
          user: currentUser,
          cwd: os.homedir()
        });

        allToolExecutions.push({
          tool: toolName,
          params: toolParams,
          output: toolResult.output,
          success: toolResult.success,
          error: toolResult.error
        });

        // Add assistant message with tool call
        currentMessages.push({
          role: 'assistant',
          content: assistantMessage || '',
          tool_calls: nativeToolCalls
        });

        // Add tool result in native format
        currentMessages.push({
          role: 'tool',
          tool_call_id: nativeCall.id,
          content: toolResult.success ? toolResult.output : `Error: ${toolResult.error}`
        });

        // Send progress update
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('llm:toolProgress', {
            tool: toolName,
            params: toolParams,
            output: toolResult.output,
            success: toolResult.success,
            error: toolResult.error,
            iteration
          });
        }

        continue;
      }

      if (!assistantMessage) {
        if (totalCost > 0) {
          await deductTokens(currentUser.id, totalCost, model, 'AI inference (no response)');
        }
        return { success: false, error: 'Inget svar mottaget från AI.' };
      }

      // Parse tool call from text using the modular parser (fallback for non-native)
      const toolCall = parseToolCall(assistantMessage);

      if (toolCall && toolCall.tool) {
        console.log('\n========== TOOL CALL DETECTED (text) ==========');
        console.log('Tool:', toolCall.tool);
        console.log('Parameters:', JSON.stringify(toolCall.params, null, 2));
        console.log('================================================\n');

        // Check if tool exists
        if (!registry.has(toolCall.tool)) {
          console.warn(`Unknown tool requested: ${toolCall.tool}`);
          // Let the LLM know the tool doesn't exist with clear formatting
          currentMessages.push({ role: 'assistant', content: assistantMessage });
          currentMessages.push({
            role: 'user',
            content: `[Tool Result]\n[${toolCall.tool} ✗] (step ${iteration}/${MAX_TOOL_ITERATIONS}) Unknown tool. Available tools: ${registry.getToolNames().join(', ')}`
          });
          continue;
        }

        // Execute the tool using the registry
        const toolResult = await registry.execute(toolCall.tool, toolCall.params, {
          user: currentUser,
          cwd: os.homedir()
        });

        // Track this tool execution
        allToolExecutions.push({
          tool: toolCall.tool,
          params: toolCall.params,
          output: toolResult.output,
          success: toolResult.success,
          error: toolResult.error
        });

        // Add the assistant's message to the conversation
        currentMessages.push({ role: 'assistant', content: assistantMessage });

        // Format and add the tool result with iteration context
        const toolResultMessage = formatToolResult(toolCall.tool, toolResult, {
          maxOutput: AGENT_CONFIG.maxToolResultSize,
          maxError: AGENT_CONFIG.maxErrorResultSize,
          iteration: iteration,
          maxIterations: MAX_TOOL_ITERATIONS
        });
        // Use a clear "Tool Result" prefix so LLM knows this is tool output, not user input
        currentMessages.push({ role: 'user', content: `[Tool Result]\n${toolResultMessage}` });

        // Send progress update to renderer
        if (mainWindow && mainWindow.webContents) {
          mainWindow.webContents.send('llm:toolProgress', {
            tool: toolCall.tool,
            params: toolCall.params,
            output: toolResult.output,
            success: toolResult.success,
            error: toolResult.error,
            iteration
          });
        }

        // Continue the loop to get the LLM's response to the tool output
        continue;
      }

      // No tool call, return the final response
      let tokenResult = { tokensDeducted: 0, newBalance: tokenData.tokens };
      if (totalCost > 0) {
        tokenResult = await deductTokens(currentUser.id, totalCost, model, 'AI inference');
      }

      // Notify renderer of token update
      if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('tokens:updated', {
          newBalance: tokenResult.newBalance,
          tokensDeducted: tokenResult.tokensDeducted,
          cost: totalCost,
          costSource: costSource
        });
      }

      return {
        success: true,
        message: assistantMessage,
        model: data.model,
        usage: data.usage,
        toolExecutions: allToolExecutions.length > 0 ? allToolExecutions : undefined,
        tokenUsage: {
          cost: totalCost,
          tokensDeducted: tokenResult.tokensDeducted,
          newBalance: tokenResult.newBalance,
          costSource: costSource
        }
      };
    }

    // Max iterations reached
    if (totalCost > 0) {
      await deductTokens(currentUser.id, totalCost, model, 'AI inference (max iterations)');
    }

    return {
      success: false,
      error: `Maximum tool iterations (${MAX_TOOL_ITERATIONS}) reached. The agent may be stuck in a loop.`,
      toolExecutions: allToolExecutions
    };

  } catch (error) {
    console.error('LLM chat error:', error);
    return { success: false, error: error.message };
  }
});

// ===== MODEL CONFIGURATION FROM SUPABASE =====

// Default model as fallback if Supabase fetch fails
const DEFAULT_MODEL = 'openai/gpt-4o-mini';

// Cache for the active model (refreshed periodically)
let cachedActiveModel = null;
let modelCacheTime = 0;
const MODEL_CACHE_TTL = 60000; // Cache for 1 minute

// Cache for the OpenRouter API key (refreshed periodically)
let cachedApiKey = null;
let apiKeyCacheTime = 0;
const API_KEY_CACHE_TTL = 300000; // Cache for 5 minutes

// Fallback API key (empty - requires Supabase to be available)
const DEFAULT_API_KEY = '';

// Fetch OpenRouter API key from Supabase app_settings
async function getOpenRouterApiKey() {
  try {
    // Return cached key if still valid
    const now = Date.now();
    if (cachedApiKey && (now - apiKeyCacheTime) < API_KEY_CACHE_TTL) {
      return cachedApiKey;
    }

    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'openrouter_api_key')
      .single();

    if (error) {
      console.error('Error fetching OpenRouter API key from Supabase:', error);
      return cachedApiKey || DEFAULT_API_KEY;
    }

    if (data && data.value && data.value.key) {
      cachedApiKey = data.value.key;
      apiKeyCacheTime = now;
      console.log('OpenRouter API key fetched from Supabase');
      return cachedApiKey;
    }

    return DEFAULT_API_KEY;
  } catch (error) {
    console.error('Error in getOpenRouterApiKey:', error);
    return cachedApiKey || DEFAULT_API_KEY;
  }
}

// Fetch active model from Supabase app_settings
async function getActiveModel() {
  try {
    // Return cached model if still valid
    const now = Date.now();
    if (cachedActiveModel && (now - modelCacheTime) < MODEL_CACHE_TTL) {
      return cachedActiveModel;
    }

    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'active_model')
      .single();

    if (error) {
      console.error('Error fetching active model from Supabase:', error);
      return cachedActiveModel || DEFAULT_MODEL;
    }

    if (data && data.value) {
      const modelConfig = data.value;
      cachedActiveModel = modelConfig.model_id || DEFAULT_MODEL;
      modelCacheTime = now;
      console.log('Active model fetched from Supabase:', cachedActiveModel);
      return cachedActiveModel;
    }

    return DEFAULT_MODEL;
  } catch (error) {
    console.error('Error in getActiveModel:', error);
    return cachedActiveModel || DEFAULT_MODEL;
  }
}

// Cache for the system prompt (refreshed periodically)
let cachedSystemPrompt = null;
let systemPromptCacheTime = 0;
const SYSTEM_PROMPT_CACHE_TTL = 60000; // Cache for 1 minute

// Generic fallback if Supabase is unreachable
const DEFAULT_SYSTEM_PROMPT = 'You are a helpful AI assistant.';

// Fetch system prompt from Supabase app_settings
async function getSystemPrompt() {
  try {
    // Return cached prompt if still valid
    const now = Date.now();
    if (cachedSystemPrompt && (now - systemPromptCacheTime) < SYSTEM_PROMPT_CACHE_TTL) {
      return cachedSystemPrompt;
    }

    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'system_prompt')
      .single();

    if (error) {
      console.error('Error fetching system prompt from Supabase:', error);
      return cachedSystemPrompt || DEFAULT_SYSTEM_PROMPT;
    }

    if (data && data.value && data.value.prompt) {
      cachedSystemPrompt = data.value.prompt;
      systemPromptCacheTime = now;
      console.log('System prompt fetched from Supabase');
      return cachedSystemPrompt;
    }

    return DEFAULT_SYSTEM_PROMPT;
  } catch (error) {
    console.error('Error in getSystemPrompt:', error);
    return cachedSystemPrompt || DEFAULT_SYSTEM_PROMPT;
  }
}

// IPC handler to get the system prompt (now includes dynamic tool documentation)
ipcMain.handle('settings:getSystemPrompt', async () => {
  try {
    const basePrompt = await getSystemPrompt();

    // Use compact docs by default (90% smaller, ~300 tokens vs ~3000)
    const toolDocs = AGENT_CONFIG.useCompactDocs
      ? getCompactToolDocumentation()
      : getToolDocumentation();

    // Combine base prompt with tool documentation
    const fullPrompt = `${basePrompt}\n\n${toolDocs}`;

    return { success: true, prompt: fullPrompt };
  } catch (error) {
    console.error('Error getting system prompt:', error);
    return { success: false, error: error.message, prompt: DEFAULT_SYSTEM_PROMPT };
  }
});

// IPC handler to get available tools (for UI display)
ipcMain.handle('tools:getAvailable', async () => {
  try {
    const tools = registry.getEnabled().map(tool => ({
      name: tool.name,
      displayName: tool.displayName,
      description: tool.description,
      category: tool.category,
      requiresConfirmation: tool.requiresConfirmation
    }));

    const categories = registry.getCategories();

    return {
      success: true,
      tools,
      categories,
      count: tools.length
    };
  } catch (error) {
    console.error('Error getting tools:', error);
    return { success: false, error: error.message };
  }
});

// IPC handler to get tool execution history
ipcMain.handle('tools:getHistory', async (event, { limit = 20 }) => {
  try {
    const history = registry.getHistory(limit);
    return { success: true, history };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get available models (for admin reference, not exposed to users)
ipcMain.handle('llm:getModels', async () => {
  // This is kept for potential admin use, but not used in the app UI
  try {
    if (!currentUser) {
      return { success: false, error: 'Du måste vara inloggad.' };
    }

    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'available_models')
      .single();

    if (error || !data) {
      return { success: false, error: 'Kunde inte hämta modellista.' };
    }

    return { success: true, models: data.value };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Helper function to check if a command exists and get version
async function getToolVersion(command, versionFlag = '--version') {
  try {
    const { stdout } = await execAsync(`${command} ${versionFlag}`, { timeout: 3000 });
    // Extract first line and clean up
    const firstLine = stdout.trim().split('\n')[0];
    // Try to extract version number
    const versionMatch = firstLine.match(/(\d+\.\d+\.?\d*)/);
    return versionMatch ? versionMatch[1] : firstLine.substring(0, 50);
  } catch {
    return null;
  }
}

// Project type detection - identifies what kind of project is in a directory
async function detectProjectType(directory) {
  const fs = require('fs').promises;
  const indicators = [
    {
      file: 'package.json', type: 'Node.js', extras: async (dir) => {
        try {
          const pkg = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf-8'));
          const deps = { ...pkg.dependencies, ...pkg.devDependencies };
          if (deps['next']) return 'Next.js';
          if (deps['react']) return 'React';
          if (deps['vue']) return 'Vue.js';
          if (deps['@angular/core']) return 'Angular';
          if (deps['express']) return 'Express.js';
          if (deps['electron']) return 'Electron';
          return 'Node.js';
        } catch { return 'Node.js'; }
      }
    },
    { file: 'requirements.txt', type: 'Python' },
    { file: 'pyproject.toml', type: 'Python' },
    { file: 'Pipfile', type: 'Python' },
    { file: 'Cargo.toml', type: 'Rust' },
    { file: 'go.mod', type: 'Go' },
    { file: 'pom.xml', type: 'Java (Maven)' },
    { file: 'build.gradle', type: 'Java (Gradle)' },
    { file: '*.csproj', type: '.NET' },
    { file: 'composer.json', type: 'PHP' },
    { file: 'Gemfile', type: 'Ruby' },
    { file: 'pubspec.yaml', type: 'Flutter/Dart' },
  ];

  for (const indicator of indicators) {
    try {
      const filePath = path.join(directory, indicator.file);
      await fs.access(filePath);
      // File exists
      if (indicator.extras) {
        return await indicator.extras(directory);
      }
      return indicator.type;
    } catch {
      // File doesn't exist, continue
    }
  }
  return null;
}

// Get system information for Flyt context
ipcMain.handle('system:getInfo', async () => {
  try {
    const systemInfo = {
      // OS Information
      platform: os.platform(),
      osType: os.type(),
      osRelease: os.release(),
      osVersion: os.version(),
      arch: os.arch(),
      hostname: os.hostname(),

      // Hardware
      cpus: os.cpus().length,
      cpuModel: os.cpus()[0]?.model || 'Unknown',
      totalMemory: Math.round(os.totalmem() / (1024 * 1024 * 1024)) + ' GB',
      freeMemory: Math.round(os.freemem() / (1024 * 1024 * 1024)) + ' GB',

      // User
      username: os.userInfo().username,
      homeDir: os.homedir(),
      shell: os.userInfo().shell || process.env.SHELL || process.env.COMSPEC || 'unknown',

      // Time
      uptime: Math.round(os.uptime() / 3600) + ' timmar',
      currentTime: new Date().toLocaleString(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,

      // Will be populated below
      runningProcesses: [],
      activeWindows: [],
      displays: [],
      devTools: {},
      network: {},
      power: {},
      clipboard: {},
      diskSpace: [],
      envInfo: {}
    };

    // ===== SCREEN & DISPLAYS =====
    try {
      const { screen } = require('electron');
      const displays = screen.getAllDisplays();
      const primaryDisplay = screen.getPrimaryDisplay();

      systemInfo.displays = displays.map((d, i) => ({
        id: i + 1,
        isPrimary: d.id === primaryDisplay.id,
        resolution: `${d.size.width}x${d.size.height}`,
        workArea: `${d.workArea.width}x${d.workArea.height}`,
        scaleFactor: d.scaleFactor,
        rotation: d.rotation,
        bounds: { x: d.bounds.x, y: d.bounds.y }
      }));

      systemInfo.totalScreenArea = {
        width: Math.max(...displays.map(d => d.bounds.x + d.size.width)),
        height: Math.max(...displays.map(d => d.bounds.y + d.size.height))
      };
    } catch (displayError) {
      console.log('Could not get display info:', displayError.message);
    }

    // ===== DEVELOPER TOOLS =====
    const toolChecks = [
      { name: 'git', cmd: 'git', flag: '--version' },
      { name: 'node', cmd: 'node', flag: '--version' },
      { name: 'npm', cmd: 'npm', flag: '--version' },
      { name: 'python', cmd: process.platform === 'win32' ? 'python' : 'python3', flag: '--version' },
      { name: 'pip', cmd: process.platform === 'win32' ? 'pip' : 'pip3', flag: '--version' },
      { name: 'docker', cmd: 'docker', flag: '--version' },
      { name: 'code', cmd: 'code', flag: '--version' },
      { name: 'java', cmd: 'java', flag: '-version' },
      { name: 'rustc', cmd: 'rustc', flag: '--version' },
      { name: 'go', cmd: 'go', flag: 'version' },
      { name: 'dotnet', cmd: 'dotnet', flag: '--version' },
      { name: 'kubectl', cmd: 'kubectl', flag: 'version --client --short' },
      { name: 'aws', cmd: 'aws', flag: '--version' },
      { name: 'az', cmd: 'az', flag: '--version' },
      { name: 'terraform', cmd: 'terraform', flag: '--version' },
      { name: 'pnpm', cmd: 'pnpm', flag: '--version' },
      { name: 'yarn', cmd: 'yarn', flag: '--version' },
      { name: 'bun', cmd: 'bun', flag: '--version' }
    ];

    // Check tools in parallel for speed
    const toolResults = await Promise.all(
      toolChecks.map(async tool => ({
        name: tool.name,
        version: await getToolVersion(tool.cmd, tool.flag)
      }))
    );

    toolResults.forEach(result => {
      if (result.version) {
        systemInfo.devTools[result.name] = result.version;
      }
    });

    // ===== NETWORK STATUS =====
    try {
      const networkInterfaces = os.networkInterfaces();
      const activeInterfaces = [];

      for (const [name, interfaces] of Object.entries(networkInterfaces)) {
        for (const iface of interfaces) {
          if (!iface.internal && iface.family === 'IPv4') {
            activeInterfaces.push({
              name: name,
              ip: iface.address,
              mac: iface.mac
            });
          }
        }
      }

      systemInfo.network.interfaces = activeInterfaces;
      systemInfo.network.connected = activeInterfaces.length > 0;

      // Check internet connectivity
      try {
        if (process.platform === 'win32') {
          await execAsync('ping -n 1 -w 1000 8.8.8.8', { timeout: 2000 });
        } else {
          await execAsync('ping -c 1 -W 1 8.8.8.8', { timeout: 2000 });
        }
        systemInfo.network.internetAccess = true;
      } catch {
        systemInfo.network.internetAccess = false;
      }
    } catch (netError) {
      console.log('Could not get network info:', netError.message);
    }

    // ===== POWER/BATTERY STATUS =====
    try {
      if (process.platform === 'win32') {
        const { stdout } = await execAsync(
          'powershell -command "Get-WmiObject Win32_Battery | Select-Object EstimatedChargeRemaining, BatteryStatus | ConvertTo-Json"',
          { timeout: 3000 }
        );
        if (stdout.trim()) {
          const battery = JSON.parse(stdout);
          if (battery) {
            systemInfo.power = {
              hasBattery: true,
              level: battery.EstimatedChargeRemaining + '%',
              charging: battery.BatteryStatus === 2,
              status: battery.BatteryStatus === 2 ? 'Charging' :
                battery.BatteryStatus === 1 ? 'Discharging' : 'Unknown'
            };
          }
        } else {
          systemInfo.power = { hasBattery: false, status: 'AC Power (Desktop)' };
        }
      } else if (process.platform === 'darwin') {
        const { stdout } = await execAsync('pmset -g batt', { timeout: 3000 });
        const match = stdout.match(/(\d+)%/);
        const charging = stdout.includes('charging') || stdout.includes('AC Power');
        systemInfo.power = {
          hasBattery: match !== null,
          level: match ? match[1] + '%' : 'N/A',
          charging: charging,
          status: charging ? 'Laddar/Nätström' : 'Batteri'
        };
      } else {
        // Linux
        try {
          const { stdout } = await execAsync('cat /sys/class/power_supply/BAT0/capacity 2>/dev/null || echo "none"', { timeout: 2000 });
          if (stdout.trim() !== 'none') {
            const { stdout: status } = await execAsync('cat /sys/class/power_supply/BAT0/status', { timeout: 2000 });
            systemInfo.power = {
              hasBattery: true,
              level: stdout.trim() + '%',
              charging: status.trim() === 'Charging',
              status: status.trim()
            };
          } else {
            systemInfo.power = { hasBattery: false, status: 'Nätström' };
          }
        } catch {
          systemInfo.power = { hasBattery: false, status: 'Okänd' };
        }
      }
    } catch (powerError) {
      console.log('Could not get power info:', powerError.message);
      systemInfo.power = { hasBattery: false, status: 'Okänd' };
    }

    // ===== CLIPBOARD METADATA =====
    try {
      const { clipboard } = require('electron');
      const formats = clipboard.availableFormats();

      systemInfo.clipboard = {
        hasText: formats.some(f => f.includes('text')),
        hasImage: formats.some(f => f.includes('image')),
        hasHTML: formats.some(f => f.includes('html')),
        hasFiles: formats.some(f => f.includes('file')),
        formats: formats.slice(0, 5), // First 5 formats
        textLength: clipboard.readText()?.length || 0
      };
    } catch (clipError) {
      console.log('Could not get clipboard info:', clipError.message);
    }

    // ===== DISK SPACE =====
    try {
      if (process.platform === 'win32') {
        const { stdout } = await execAsync(
          'powershell -command "Get-PSDrive -PSProvider FileSystem | Select-Object Name, @{N=\'UsedGB\';E={[math]::Round($_.Used/1GB,1)}}, @{N=\'FreeGB\';E={[math]::Round($_.Free/1GB,1)}}, @{N=\'TotalGB\';E={[math]::Round(($_.Used+$_.Free)/1GB,1)}} | ConvertTo-Json"',
          { timeout: 5000 }
        );
        const drives = JSON.parse(stdout);
        systemInfo.diskSpace = (Array.isArray(drives) ? drives : [drives])
          .filter(d => d.TotalGB > 0)
          .map(d => ({
            drive: d.Name + ':',
            free: d.FreeGB + ' GB',
            total: d.TotalGB + ' GB',
            usedPercent: Math.round((d.UsedGB / d.TotalGB) * 100) + '%'
          }));
      } else {
        const { stdout } = await execAsync('df -h / /home 2>/dev/null | tail -n +2', { timeout: 3000 });
        systemInfo.diskSpace = stdout.trim().split('\n').map(line => {
          const parts = line.split(/\s+/);
          return {
            drive: parts[5] || parts[0],
            free: parts[3],
            total: parts[1],
            usedPercent: parts[4]
          };
        });
      }
    } catch (diskError) {
      console.log('Could not get disk info:', diskError.message);
    }

    // ===== ENVIRONMENT INFO =====
    systemInfo.envInfo = {
      nodeVersion: process.version,
      electronVersion: process.versions.electron,
      locale: Intl.DateTimeFormat().resolvedOptions().locale,
      tempDir: os.tmpdir(),
      pathSeparator: path.sep,
      // Don't expose full PATH for security, just count
      pathEntries: (process.env.PATH || '').split(path.delimiter).length
    };

    // ===== PROJECT DETECTION =====
    try {
      const projectType = await detectProjectType(os.homedir());
      if (projectType) {
        systemInfo.projectType = projectType;
      }
    } catch (e) {
      console.log('Project detection skipped:', e.message);
    }

    // ===== RUNNING PROCESSES =====
    try {
      if (process.platform === 'win32') {
        const { stdout } = await execAsync('tasklist /FO CSV /NH', { timeout: 5000 });
        const lines = stdout.trim().split('\n').slice(0, 30);
        systemInfo.runningProcesses = lines.map(line => {
          const parts = line.split('","');
          return parts[0]?.replace(/"/g, '') || '';
        }).filter(p => p);
      } else {
        const { stdout } = await execAsync('ps -eo comm= | head -30', { timeout: 5000 });
        systemInfo.runningProcesses = stdout.trim().split('\n').filter(p => p);
      }
    } catch (procError) {
      console.log('Could not get running processes:', procError.message);
      systemInfo.runningProcesses = ['Kunde inte hämta processlistan'];
    }

    // ===== ACTIVE WINDOWS =====
    if (process.platform === 'win32') {
      try {
        const { stdout } = await execAsync(
          'powershell -command "Get-Process | Where-Object {$_.MainWindowTitle} | Select-Object -First 10 ProcessName, MainWindowTitle | ConvertTo-Json"',
          { timeout: 5000 }
        );
        const windows = JSON.parse(stdout);
        systemInfo.activeWindows = Array.isArray(windows) ? windows : [windows];
      } catch {
        systemInfo.activeWindows = [];
      }
    }

    return { success: true, systemInfo };
  } catch (error) {
    console.error('System info error:', error);
    return { success: false, error: error.message };
  }
});

// Refresh system info (dynamic data only - for real-time updates)
ipcMain.handle('system:refreshProcesses', async () => {
  try {
    const refreshData = {
      processes: [],
      activeWindows: [],
      freeMemory: Math.round(os.freemem() / (1024 * 1024 * 1024)) + ' GB',
      currentTime: new Date().toLocaleString(),
      clipboard: {},
      power: {}
    };

    // Processes
    if (process.platform === 'win32') {
      try {
        const { stdout } = await execAsync('tasklist /FO CSV /NH', { timeout: 5000 });
        const lines = stdout.trim().split('\n').slice(0, 30);
        refreshData.processes = lines.map(line => {
          const parts = line.split('","');
          return parts[0]?.replace(/"/g, '') || '';
        }).filter(p => p);
      } catch (e) { }

      try {
        const { stdout } = await execAsync(
          'powershell -command "Get-Process | Where-Object {$_.MainWindowTitle} | Select-Object -First 10 ProcessName, MainWindowTitle | ConvertTo-Json"',
          { timeout: 5000 }
        );
        const windows = JSON.parse(stdout);
        refreshData.activeWindows = Array.isArray(windows) ? windows : [windows];
      } catch (e) { }

      // Power on Windows
      try {
        const { stdout } = await execAsync(
          'powershell -command "Get-WmiObject Win32_Battery | Select-Object EstimatedChargeRemaining, BatteryStatus | ConvertTo-Json"',
          { timeout: 3000 }
        );
        if (stdout.trim()) {
          const battery = JSON.parse(stdout);
          if (battery) {
            refreshData.power = {
              hasBattery: true,
              level: battery.EstimatedChargeRemaining + '%',
              charging: battery.BatteryStatus === 2
            };
          }
        }
      } catch (e) { }
    } else {
      try {
        const { stdout } = await execAsync('ps -eo comm= | head -30', { timeout: 5000 });
        refreshData.processes = stdout.trim().split('\n').filter(p => p);
      } catch (e) { }
    }

    // Clipboard
    try {
      const { clipboard } = require('electron');
      const formats = clipboard.availableFormats();
      refreshData.clipboard = {
        hasText: formats.some(f => f.includes('text')),
        hasImage: formats.some(f => f.includes('image')),
        textLength: clipboard.readText()?.length || 0
      };
    } catch (e) { }

    return { success: true, ...refreshData };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ===== SNIPPING TOOL =====

// Capture all screens and return as base64
ipcMain.handle('snip:captureScreens', async () => {
  try {
    const displays = screen.getAllDisplays();
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.max(...displays.map(d => d.size.width * d.scaleFactor)),
        height: Math.max(...displays.map(d => d.size.height * d.scaleFactor))
      }
    });

    capturedScreenshots = [];

    for (const source of sources) {
      const display = displays.find(d =>
        source.name.includes(d.id.toString()) ||
        source.display_id === d.id.toString() ||
        source.name.toLowerCase().includes('screen')
      ) || displays[0];

      capturedScreenshots.push({
        id: source.id,
        name: source.name,
        displayId: source.display_id || display.id.toString(),
        thumbnail: source.thumbnail.toDataURL(),
        bounds: display.bounds,
        scaleFactor: display.scaleFactor
      });
    }

    return { success: true, screenshots: capturedScreenshots };
  } catch (error) {
    console.error('Screen capture error:', error);
    return { success: false, error: error.message };
  }
});

// Open snipping overlay window - delegates to openSnippingTool() to avoid code duplication
ipcMain.handle('snip:openOverlay', async () => {
  try {
    await openSnippingTool();
    return { success: true };
  } catch (error) {
    console.error('Snipping overlay error:', error);
    return { success: false, error: error.message };
  }
});

// Cancel snipping
ipcMain.handle('snip:cancel', async () => {
  if (snippingWindow) {
    snippingWindow.close();
    snippingWindow = null;
  }
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
  }
  return { success: true };
});

// Complete snipping with selected region
ipcMain.handle('snip:complete', async (event, { imageData, region }) => {
  try {
    if (snippingWindow) {
      snippingWindow.close();
      snippingWindow = null;
    }

    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();

      // Send the captured snip to the main window
      mainWindow.webContents.send('snip:captured', {
        imageData,
        region,
        timestamp: Date.now()
      });
    }

    return { success: true };
  } catch (error) {
    console.error('Snip complete error:', error);
    return { success: false, error: error.message };
  }
});

// Register custom protocol for OAuth callbacks
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(OAUTH_CALLBACK_PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient(OAUTH_CALLBACK_PROTOCOL);
}

// Handle protocol on Windows (single instance lock)
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine) => {
    // Someone tried to run a second instance, we should focus our window.
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    } else if (authWindow) {
      if (authWindow.isMinimized()) authWindow.restore();
      authWindow.focus();
    }

    // Handle OAuth callback on Windows
    const url = commandLine.find(arg => arg.startsWith(`${OAUTH_CALLBACK_PROTOCOL}://`));
    if (url) {
      handleOAuthCallback(url);
    }
  });
}

// Handle protocol on macOS
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleOAuthCallback(url);
});

// App startup
app.whenReady().then(async () => {
  console.log('=== App Starting ===');

  // Initialize the encrypted store (must be after app is ready)
  store = createStore();
  console.log('Encrypted store initialized with machine-specific key');

  // Set up auth listener to keep session in sync
  setupAuthListener();

  // Initialize the modular tool system
  console.log('Initializing tool system...');
  initializeTools({
    electron: {
      clipboard: clipboard,
      shell: shell
    }
  });

  // Remove the application menu (File, Edit, View, etc.)
  Menu.setApplicationMenu(null);

  // Create system tray for background operation
  createTray();

  // Enable auto-launch by default (start with Windows)
  try {
    const isEnabled = await autoLauncher.isEnabled();
    if (!isEnabled) {
      await autoLauncher.enable();
      console.log('Auto-launch enabled by default');
    }
  } catch (err) {
    console.error('Failed to enable auto-launch:', err);
  }

  // Register global shortcut for toggling window visibility (Ctrl+Shift+C on Windows/Linux, Cmd+Shift+C on macOS)
  const toggleShortcutRegistered = globalShortcut.register('CommandOrControl+Shift+C', () => {
    console.log('Global shortcut triggered: Ctrl+Shift+C (toggle window)');
    toggleAppVisibility();
  });

  if (toggleShortcutRegistered) {
    console.log('Global shortcut registered: Ctrl+Shift+C (toggle window visibility)');
  } else {
    console.log('Failed to register toggle shortcut');
  }

  // Register global shortcut for snipping tool (Ctrl+Shift+V on Windows/Linux, Cmd+Shift+V on macOS)
  const snipShortcutRegistered = globalShortcut.register('CommandOrControl+Shift+V', async () => {
    console.log('Global shortcut triggered: Ctrl+Shift+V (snipping tool)');
    await openSnippingTool();
  });

  if (snipShortcutRegistered) {
    console.log('Global shortcut registered: Ctrl+Shift+V (snipping tool)');
  } else {
    console.log('Failed to register snipping shortcut');
  }

  // Initialize auto-update system
  initAutoUpdate();

  // Check if app was opened with OAuth callback URL (Windows)
  const oauthUrl = process.argv.find(arg => arg.startsWith(`${OAUTH_CALLBACK_PROTOCOL}://`));
  if (oauthUrl) {
    // Handle OAuth callback after a short delay to ensure app is ready
    setTimeout(() => handleOAuthCallback(oauthUrl), 500);
  }

  // Check if started with --hidden flag (from auto-launch)
  const startHidden = process.argv.includes('--hidden');

  // Try to restore session
  const user = await initializeSession();

  if (user) {
    console.log('User logged in:', user.email);
    currentUser = user;
    if (!startHidden) {
      createMainWindow();
    } else {
      console.log('Startade dold - appen körs i aktivitetsfältet. Ctrl+Shift+C: visa/dölj | Ctrl+Shift+V: klippverktyg');
    }
  } else {
    console.log('No session, showing login');
    if (!startHidden) {
      createAuthWindow();
    } else {
      console.log('Startade dold - appen körs i aktivitetsfältet. Ctrl+Shift+C: visa/dölj | Ctrl+Shift+V: klippverktyg');
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      showApp();
    }
  });
});

app.on('window-all-closed', () => {
  // Don't quit - keep running in the system tray
  // The app will only quit when user explicitly clicks "Quit" in tray menu
  console.log('All windows closed - app continues running in system tray');
});

// Handle before-quit to set isQuitting flag
app.on('before-quit', () => {
  isQuitting = true;
});

// Clean up global shortcuts and tray when app quits
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  if (tray) {
    tray.destroy();
    tray = null;
  }
  console.log('Global shortcuts unregistered, tray destroyed');
});
