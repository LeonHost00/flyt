const { app, BrowserWindow, ipcMain, shell, screen, desktopCapturer, globalShortcut, Menu, Tray, nativeImage, clipboard, Notification, safeStorage, protocol } = require('electron');
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

// Register custom protocol for screenshots to avoid IPC bottlenecks
protocol.registerSchemesAsPrivileged([
  { scheme: 'flyt-screenshot', privileges: { standard: true, secure: true, supportFetchAPI: true, bypassCSP: true } }
]);

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

    // Force immediate installation as requested
    console.log('Forcing immediate update installation...');
    isQuitting = true;
    autoUpdater.quitAndInstall(false, true);
  });

  // Initial check on startup
  autoUpdater.checkForUpdatesAndNotify();

  // Check periodically every 4 hours
  setInterval(() => {
    console.log('Checking for updates (periodic)...');
    autoUpdater.checkForUpdatesAndNotify();
  }, 4 * 60 * 60 * 1000);
}

// Import the modular tool system (LangGraph-based)
const {
  runAgent,
  getToolDocumentation
} = require('./tools');

// Tray instance
let tray = null;

// Auto-launch configuration
const autoLauncher = new AutoLaunch({
  name: 'Flyt',
  path: app.getPath('exe'),
  isHidden: true // Start minimized to tray
});

// Snipping tool state
let snippingWindows = []; // Use multiple windows for better multi-monitor support
let screenshotMap = new Map(); // Store NativeImage objects for the protocol
let isSnippingToolOpening = false; // Flag to prevent race conditions with rapid shortcut presses

/**
 * Initialize snipping tool windows (hidden) for all displays
 * This makes the tool feel instant when the user triggers the shortcut.
 */
async function initSnippingWindows() {
  if (isQuitting) return;
  
  // Close existing windows if any
  snippingWindows.forEach(win => {
    if (!win.isDestroyed()) {
      win.removeAllListeners('close');
      win.close();
    }
  });
  snippingWindows = [];

  const displays = screen.getAllDisplays();
  
  snippingWindows = displays.map((display, index) => {
    const win = new BrowserWindow({
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      movable: false,
      resizable: false,
      fullscreenable: false,
      focusable: true,
      enableLargerThanScreen: true,
      show: false, // Window starts hidden
      type: 'toolbar',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    if (process.platform === 'win32') {
      win.setAlwaysOnTop(true, 'screen-saver');
    }

    win.loadFile('snipping.html');
    win.setVisibleOnAllWorkspaces(true);

    // Instead of closing, we intercept the close event to just hide it
    win.on('close', (e) => {
      if (!isQuitting) {
        e.preventDefault();
        hideSnippingTool();
      }
    });

    return win;
  });

  console.log(`Initialized ${snippingWindows.length} snipping windows`);
}

/**
 * Hide all snipping windows and reset state
 */
function hideSnippingTool() {
  snippingWindows.forEach(win => {
    if (!win.isDestroyed() && win.isVisible()) {
      win.hide();
    }
  });
  
  isSnippingToolOpening = false;
  screenshotMap.clear();
  
  if (mainWindow && !isQuitting) {
    mainWindow.show();
    mainWindow.focus();
  }
}

// Supabase configuration
const SUPABASE_URL = 'https://cddircpnawvpryttmpel.supabase.co';
const SUPABASE_KEY = 'sb_publishable_lDoWq98zufz9gRxUCSl-3A_NXIWcpyJ';

// Custom protocol for OAuth callback (must match Supabase redirect URL)
const OAUTH_CALLBACK_PROTOCOL = 'flyt';
const OAUTH_REDIRECT_URL = `${OAUTH_CALLBACK_PROTOCOL}://auth-callback`;

// Safe Storage Helper
function encryptData(data) {
  if (safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.encryptString(data).toString('hex');
    } catch (e) {
      console.error('Encryption failed:', e);
      return null;
    }
  } else {
    console.warn('safeStorage is not available on this system');
    return null;
  }
}

function decryptData(encryptedData) {
  if (safeStorage.isEncryptionAvailable()) {
    try {
      return safeStorage.decryptString(Buffer.from(encryptedData, 'hex'));
    } catch (e) {
      console.error('Decryption failed:', e);
      return null;
    }
  } else {
    console.error('safeStorage is not available to decrypt data');
    return null;
  }
}

let store; // Initialized in app.whenReady() - contains auth

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
  // Prevent opening snipping tool if already active or currently opening
  const alreadyActive = snippingWindows.some(win => win.isVisible());
  if (alreadyActive || isSnippingToolOpening) {
    console.log('Snipping tool already active or opening, ignoring shortcut');
    return;
  }

  isSnippingToolOpening = true;

  try {
    const displays = screen.getAllDisplays();
    
    // Check if display count changed, if so re-init windows
    if (displays.length !== snippingWindows.length) {
      console.log('Display configuration changed, re-initializing snipping windows...');
      await initSnippingWindows();
    }

    // Hide main window immediately to capture what's behind it
    if (mainWindow) {
      mainWindow.hide();
    }

    // Capture screens
    const maxMonitorSize = displays.reduce((max, d) => ({
      width: Math.max(max.width, d.bounds.width * (d.scaleFactor || 1)),
      height: Math.max(max.height, d.bounds.height * (d.scaleFactor || 1))
    }), { width: 0, height: 0 });

    const freshSources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.round(maxMonitorSize.width),
        height: Math.round(maxMonitorSize.height)
      }
    });

    screenshotMap.clear();

    const screenshotsInfo = freshSources.map((source, index) => {
      const display = displays.find(d => 
        source.display_id === d.id.toString() || 
        source.name.includes(d.id.toString())
      ) || displays[index];
      
      const screenshotId = `screen-${index}-${Date.now()}`;
      screenshotMap.set(screenshotId, source.thumbnail);
      
      return {
        id: screenshotId,
        displayId: display.id,
        bounds: display.bounds,
        scaleFactor: display.scaleFactor
      };
    });

    // Send content and show windows
    snippingWindows.forEach((win, index) => {
      const display = displays[index];
      const info = screenshotsInfo.find(s => s.displayId === display.id) || screenshotsInfo[index];
      
      // Update position just in case
      win.setBounds({
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height
      });

      win.webContents.send('snip:screenshotData', {
        screenshot: info,
        allScreenshots: screenshotsInfo,
        display: {
          id: display.id,
          bounds: display.bounds,
          scaleFactor: display.scaleFactor
        },
        offset: { x: display.bounds.x, y: display.bounds.y }
      });

      win.show();
      win.focus();
    });

    console.log(`Snipping tool opened on ${displays.length} monitor(s)`);
  } catch (error) {
    console.error('Snipping tool error:', error);
    hideSnippingTool();
  }
}

// Token system constants
const TOKENS_PER_DOLLAR = 10000; // 10,000 tokens = $1 USD

// Store tokens in encrypted store
function storeTokens(accessToken, refreshToken) {
  try {
    const encryptedAccess = encryptData(accessToken);
    const encryptedRefresh = encryptData(refreshToken);

    if (encryptedAccess && encryptedRefresh) {
      store.set('auth_secure', {
        access_token: encryptedAccess,
        refresh_token: encryptedRefresh,
        stored_at: Date.now()
      });
      // Clear old legacy auth if it exists
      if (store.has('auth')) store.delete('auth');

      console.log('Tokens securely stored using safeStorage');
    } else {
      console.error('Failed to encrypt tokens, session will not be persisted');
    }
  } catch (error) {
    console.error('Error storing tokens:', error);
  }
}

// Get tokens from encrypted store
function getTokens() {
  try {
    // Try new secure storage first
    if (store.has('auth_secure')) {
      const data = store.get('auth_secure');
      return {
        access_token: decryptData(data.access_token),
        refresh_token: decryptData(data.refresh_token)
      };
    }

    // Fallback to old storage (will fail decryption if key changed, but good to check)
    if (store.has('auth')) {
      console.log('Migrating legacy auth token...');
      const legacyAuth = store.get('auth');
      return legacyAuth; // This might be raw or old-encrypted, but we rely on Supabase to validate
    }

    return null;
  } catch (error) {
    console.error('Error getting tokens:', error);
    return null;
  }
}

// Clear tokens
function clearTokens() {
  try {
    store.delete('auth');
    store.delete('auth_secure');
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
// Get model-specific pricing for cost estimation (per 1M tokens)
// Removed hardcoded pricing to reduce bloat and rely on API data
function getModelPricing(model) {
  // We now prefer to get actual cost from OpenRouter API
  return null;
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

  // Helper popup dimensions - 38% width, full height, right-aligned
  const windowWidth = Math.round(screenWidth * 0.38);
  const windowHeight = screenHeight;
  const windowX = workAreaX + screenWidth - windowWidth;
  const windowY = workAreaY;

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: windowX,
    y: windowY,
    minWidth: 360,
    minHeight: 400,
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

  // Set initial constraints for Chatta mode (standard)
  mainWindow.setMinimumSize(Math.round(screenWidth * 0.30), Math.round(screenHeight * 0.9));

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

// Set window mode (size and constraints)
ipcMain.handle('window:setMode', (event, mode) => {
  if (!mainWindow) return { success: false };

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  const { x: workAreaX, y: workAreaY } = primaryDisplay.workArea;

  // Always unmaximize first to ensure setBounds takes effect correctly
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  }

  if (mode === 'jobba') {
    console.log('Switching to Jobba mode (fullscreen)');
    // Jobba: Full screen by default (within work area)
    mainWindow.setBounds({
      x: workAreaX,
      y: workAreaY,
      width: screenWidth,
      height: screenHeight
    }, true);

    // Set Jobba limits: 50-100% width, 90-100% height
    mainWindow.setMinimumSize(Math.round(screenWidth * 0.5), Math.round(screenHeight * 0.9));
  } else {
    console.log('Switching to Chatta mode (standard)');
    // Chatta: "As it is now" by default
    mainWindow.setMinimumSize(Math.round(screenWidth * 0.30), Math.round(screenHeight * 0.9));

    const windowWidth = Math.round(screenWidth * 0.38);
    const windowHeight = screenHeight;
    const windowX = workAreaX + screenWidth - windowWidth;
    const windowY = workAreaY;

    mainWindow.setBounds({
      x: windowX,
      y: windowY,
      width: windowWidth,
      height: windowHeight
    }, true);
  }

  return { success: true };
});

// Open external URL in browser
ipcMain.handle('shell:openExternal', async (event, url) => {
  try {
    await shell.openExternal(url);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ===== CHAT HISTORY IPC HANDLERS =====
// Stores chat history locally using electron-store

// Function to filter out base64 images from messages to save space
function filterMessagesForStorage(messages) {
  if (!messages) return [];
  return messages.map(msg => {
    // If message has images (base64 or otherwise), remove them for now
    // as requested by the user, but keep the field for future support.
    if (msg.images && msg.images.length > 0) {
      return { ...msg, images: [] }; // Clear images but keep field for future extensibility
    }
    return msg;
  });
}

// Save a conversation to history
ipcMain.handle('chatHistory:save', async (event, conversation) => {
  try {
    if (!currentUser) {
      return { success: false, error: 'Du måste vara inloggad för att spara historik.' };
    }

    const messagesForStorage = filterMessagesForStorage(conversation.messages || []);
    
    // Create conversation entry with metadata
    const entry = {
      user_id: currentUser.id,
      title: conversation.title || 'Ny konversation',
      preview: conversation.preview || '',
      messages: messagesForStorage,
      updated_at: new Date().toISOString()
    };

    let result;
    // Check if ID is a valid UUID format (if so, it's an existing DB entry)
    const isUuid = conversation.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(conversation.id);

    if (isUuid) {
      // Update existing conversation
      result = await supabase
        .from('conversations')
        .update(entry)
        .eq('id', conversation.id)
        .eq('user_id', currentUser.id)
        .select()
        .single();
    } else {
      // Create new conversation
      result = await supabase
        .from('conversations')
        .insert([entry])
        .select()
        .single();
    }

    if (result.error) throw result.error;

    console.log(`Chat history saved to Supabase: ${result.data.id} - ${result.data.title}`);
    return { success: true, id: result.data.id };
  } catch (error) {
    console.error('Error saving chat history to Supabase:', error);
    return { success: false, error: error.message };
  }
});

// Load a specific conversation from history
ipcMain.handle('chatHistory:load', async (event, id) => {
  try {
    if (!currentUser) throw new Error('Not authenticated');

    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .eq('id', id)
      .eq('user_id', currentUser.id)
      .single();

    if (error) throw error;
    if (!data) return { success: false, error: 'Konversation hittades inte' };

    // Map DB fields back to what the frontend expects
    const conversation = {
      id: data.id,
      title: data.title,
      preview: data.preview,
      messages: data.messages,
      createdAt: data.created_at,
      updatedAt: data.updated_at
    };

    return { success: true, conversation };
  } catch (error) {
    console.error('Error loading chat history from Supabase:', error);
    return { success: false, error: error.message };
  }
});

// Delete a conversation from history
ipcMain.handle('chatHistory:delete', async (event, id) => {
  try {
    if (!currentUser) throw new Error('Not authenticated');

    const { error } = await supabase
      .from('conversations')
      .delete()
      .eq('id', id)
      .eq('user_id', currentUser.id);

    if (error) throw error;
    console.log(`Chat history deleted from Supabase: ${id}`);

    return { success: true };
  } catch (error) {
    console.error('Error deleting chat history from Supabase:', error);
    return { success: false, error: error.message };
  }
});

// List all conversations in history (with metadata only, not full messages)
ipcMain.handle('chatHistory:list', async () => {
  try {
    if (!currentUser) {
      return { success: true, conversations: [] }; // Return empty list if not logged in
    }

    const { data, error } = await supabase
      .from('conversations')
      .select('id, title, preview, created_at, updated_at, messages')
      .eq('user_id', currentUser.id)
      .order('updated_at', { ascending: false })
      .limit(100);

    if (error) throw error;

    // Return only metadata for the list view
    const summaries = data.map(h => ({
      id: h.id,
      title: h.title,
      preview: h.preview,
      createdAt: h.created_at,
      updatedAt: h.updated_at,
      messageCount: h.messages?.length || 0
    }));

    return { success: true, conversations: summaries };
  } catch (error) {
    console.error('Error listing chat history from Supabase:', error);
    return { success: false, error: error.message };
  }
});

// Clear all chat history
ipcMain.handle('chatHistory:clearAll', async () => {
  try {
    if (!currentUser) throw new Error('Not authenticated');

    const { error } = await supabase
      .from('conversations')
      .delete()
      .eq('user_id', currentUser.id);

    if (error) throw error;
    console.log('All chat history cleared from Supabase');
    return { success: true };
  } catch (error) {
    console.error('Error clearing chat history from Supabase:', error);
    return { success: false, error: error.message };
  }
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

// Helper to ask user for input via UI
function askUser(mainWindow, prompt, type = 'text', options = []) {
  return new Promise((resolve) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      resolve('User interface not available');
      return;
    }

    const requestId = Date.now().toString();

    // Listener for response
    const responseHandler = (event, response) => {
      // Only handle response for this request
      if (response.requestId === requestId) {
        ipcMain.removeListener('user_input:response', responseHandler);
        resolve(response.value);
      }
    };

    ipcMain.on('user_input:response', responseHandler);

    // Send request to renderer
    mainWindow.webContents.send('user_input:request', {
      requestId,
      prompt,
      type,
      options
    });

    // Bring window to front
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

// Helper to present info to user via UI
function presentInfo(mainWindow, data) {
  return new Promise((resolve) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      resolve();
      return;
    }

    const requestId = Date.now().toString();

    // Listener for acknowledgement
    const ackHandler = (event, response) => {
      if (response.requestId === requestId) {
        ipcMain.removeListener('user_interface:ack', ackHandler);
        resolve();
      }
    };

    ipcMain.on('user_interface:ack', ackHandler);

    // Send request to renderer
    mainWindow.webContents.send('user_interface:present', {
      requestId,
      ...data
    });

    // Bring window to front
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

// LLM Chat handler using LangGraph Agent
// Uses the new MCP/LangGraph tool system
ipcMain.handle('llm:chat', async (event, { messages, mode = 'jobba' }) => {
  try {
    // Ensure user is authenticated before allowing LLM access
    if (!currentUser) {
      return { success: false, error: 'Du måste vara inloggad för att använda AI-assistenten.' };
    }

    const allowedTools = mode === 'chatta' ? ['brave_search'] : null;
    const useTools = mode === 'jobba' || mode === 'chatta';
    const needsBraveSearch = !allowedTools || allowedTools.includes('brave_search');

    // Parallelize pre-flight checks to reduce latency
    console.log('Fetching pre-flight requirements in parallel...');
    const [model, apiKey, tokenData, braveApiKey] = await Promise.all([
      getActiveModel(),
      getOpenRouterApiKey(),
      getUserTokens(currentUser.id),
      needsBraveSearch ? getBraveSearchApiKey() : Promise.resolve(null)
    ]);

    console.log('Using model from Supabase:', model);

    if (!apiKey) {
      return { success: false, error: 'OpenRouter API-nyckel kunde inte hämtas. Kontakta support.' };
    }

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

    console.log('\n========== LANGGRAPH AGENT START ==========');
    console.log('Model:', model);
    console.log('Messages count:', messages.length);

    // Run the LangGraph agent
    const result = await runAgent({
      messages,
      apiKey,
      model,
      useTools,
      allowedTools,
      context: {
        user: currentUser,
        cwd: os.homedir(),
        braveApiKey: braveApiKey,
        openRouterApiKey: apiKey,
        askUser: (prompt, type, options) => askUser(mainWindow, prompt, type, options),
        presentInfo: (data) => presentInfo(mainWindow, data)
      },
      onToolProgress: (progress) => {
        // Send progress update to renderer
        if (event.sender && !event.sender.isDestroyed()) {
          event.sender.send('llm:toolProgress', progress);
        }
      },
      onToken: (token) => {
        // Send streaming token to renderer
        if (event.sender && !event.sender.isDestroyed()) {
          event.sender.send('llm:token', token);
        }
      }
    });

    console.log('========== LANGGRAPH AGENT COMPLETE ==========');
    console.log('Iterations:', result.iterations);
    console.log('Tool executions:', result.toolExecutions?.length || 0);

    // Get actual cost from OpenRouter
    let totalCost = 0;
    
    if (result.generationId) {
      console.log(`Fetching actual cost for generation ${result.generationId}...`);
      const actualCost = await getOpenRouterGenerationCost(result.generationId);
      if (actualCost !== null) {
        totalCost = actualCost;
      }
    }
    
    // Fallback to token estimation only if API cost fails (optional, as user wants to rely on API)
    if (totalCost === 0 && result.usage) {
      const promptTokens = result.usage.prompt_tokens || 0;
      const completionTokens = result.usage.completion_tokens || 0;
      const modelPricing = getModelPricing(model);
      
      if (modelPricing) {
        totalCost = (promptTokens * modelPricing.input / 1000000) +
          (completionTokens * modelPricing.output / 1000000);
      }
    }

    // Deduct tokens
    let tokenResult = { tokensDeducted: 0, newBalance: tokenData.tokens };
    if (totalCost > 0) {
      tokenResult = await deductTokens(currentUser.id, totalCost, model, 'AI inference');
    }

    // Notify renderer of token update
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('tokens:updated', {
        newBalance: tokenResult.newBalance,
        tokensDeducted: tokenResult.tokensDeducted,
        cost: totalCost
      });
    }

    return {
      success: true,
      message: result.message,
      model: model,
      usage: result.usage,
      toolExecutions: result.toolExecutions?.length > 0 ? result.toolExecutions : undefined,
      tokenUsage: {
        cost: totalCost,
        tokensDeducted: tokenResult.tokensDeducted,
        newBalance: tokenResult.newBalance
      }
    };

  } catch (error) {
    console.error('LLM chat error:', error);
    return { success: false, error: error.message };
  }
});

// Transcription handler using Groq Whisper
ipcMain.handle('llm:transcribe', async (event, { audioBuffer, prompt }) => {
  try {
    if (!currentUser) {
      return { success: false, error: 'Du måste vara inloggad för att använda röstinmatning.' };
    }

    const GROQ_API_KEY = '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';
    
    // Create form data for Groq API
    const formData = new FormData();
    const blob = new Blob([audioBuffer], { type: 'audio/webm' });
    formData.append('file', blob, 'recording.webm');
    formData.append('model', 'whisper-large-v3-turbo');
    
    // Add prompt if provided (helps with specific vocabulary and language focus)
    if (prompt) {
      formData.append('prompt', prompt);
    }

    console.log('Sending audio to Groq Whisper...');
    const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GROQ_API_KEY}`
      },
      body: formData
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Groq API Error:', errorData);
      throw new Error(errorData.error?.message || `Groq API error: ${response.statusText}`);
    }

    const result = await response.json();
    console.log('Transcription successful');
    return { success: true, text: result.text };
  } catch (error) {
    console.error('Transcription error:', error);
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

// Cache for the Brave Search API key (refreshed periodically)
let cachedBraveApiKey = null;
let braveApiKeyCacheTime = 0;
const BRAVE_API_KEY_CACHE_TTL = 300000; // Cache for 5 minutes

// Fetch Brave Search API key from Supabase app_settings
async function getBraveSearchApiKey() {
  try {
    // Return cached key if still valid
    const now = Date.now();
    if (cachedBraveApiKey && (now - braveApiKeyCacheTime) < BRAVE_API_KEY_CACHE_TTL) {
      return cachedBraveApiKey;
    }

    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'brave_search_api_key')
      .single();

    if (error) {
      console.error('Error fetching Brave Search API key from Supabase:', error);
      return cachedBraveApiKey;
    }

    if (data && data.value && data.value.key) {
      cachedBraveApiKey = data.value.key;
      braveApiKeyCacheTime = now;
      console.log('Brave Search API key fetched from Supabase');
      return cachedBraveApiKey;
    }

    return null;
  } catch (error) {
    console.error('Error in getBraveSearchApiKey:', error);
    return cachedBraveApiKey;
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
const DEFAULT_CHAT_SYSTEM_PROMPT = 'Du är Flyt Chat, en hjälpsam AI-assistent.'; // Minimal fallback

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

// Cache for the chat system prompt (refreshed periodically)
let cachedChatSystemPrompt = null;
let chatSystemPromptCacheTime = 0;
const CHAT_SYSTEM_PROMPT_CACHE_TTL = 60000; // Cache for 1 minute

// Fetch chat system prompt from Supabase app_settings
async function getChatSystemPrompt() {
  try {
    // Return cached prompt if still valid
    const now = Date.now();
    if (cachedChatSystemPrompt && (now - chatSystemPromptCacheTime) < CHAT_SYSTEM_PROMPT_CACHE_TTL) {
      return cachedChatSystemPrompt;
    }

    const { data, error } = await supabase
      .from('app_settings')
      .select('value')
      .eq('key', 'system_prompt_chatta')
      .single();

    if (error) {
      console.error('Error fetching chat system prompt from Supabase:', error);
      return cachedChatSystemPrompt || DEFAULT_CHAT_SYSTEM_PROMPT;
    }

    if (data && data.value && data.value.prompt) {
      cachedChatSystemPrompt = data.value.prompt;
      chatSystemPromptCacheTime = now;
      console.log('Chat system prompt fetched from Supabase');
      return cachedChatSystemPrompt;
    }

    return DEFAULT_CHAT_SYSTEM_PROMPT;
  } catch (error) {
    console.error('Error in getChatSystemPrompt:', error);
    return cachedChatSystemPrompt || DEFAULT_CHAT_SYSTEM_PROMPT;
  }
}

// IPC handler to get the system prompt (now includes dynamic tool documentation)
ipcMain.handle('settings:getSystemPrompt', async (event, { mode = 'jobba' } = {}) => {
  try {
    if (mode === 'chatta') {
      const prompt = await getChatSystemPrompt();
      const toolDocs = getToolDocumentation(['brave_search']);
      const searchGuidance = 'Use brave_search for any question that may require up-to-date or factual information. Always cite sources from search results.';
      const fullPrompt = `${prompt}\n\n${searchGuidance}\n\n${toolDocs}`.trim();
      return { success: true, prompt: fullPrompt };
    }
    const basePrompt = await getSystemPrompt();

    const toolDocs = getToolDocumentation();

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
    const tools = [
      {
        name: 'run_command',
        displayName: 'Run Command',
        description: 'Execute a shell command (PowerShell on Windows, bash on Unix).',
        category: 'shell',
        requiresConfirmation: false
      }
    ];

    return { success: true, tools, categories: ['shell'], count: 1 };
  } catch (error) {
    console.error('Error getting available tools:', error);
    return { success: false, error: error.message };
  }
});

// IPC handler to get tool execution history
ipcMain.handle('tools:getHistory', async (event, { limit = 20 }) => {
  return { success: true, history: [] };
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
        width: Math.max(...displays.map(d => d.size.width * (d.scaleFactor || 2))),
        height: Math.max(...displays.map(d => d.size.height * (d.scaleFactor || 2)))
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
        thumbnail: source.thumbnail.toJPEG(85), // Faster than PNG
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
  hideSnippingTool();
  return { success: true };
});

// Complete snipping with selected region
ipcMain.handle('snip:complete', async (event, { imageData, region }) => {
  try {
    // Hide all snipping windows and reset state
    hideSnippingTool();

    if (mainWindow) {
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

  // Register screenshot protocol for low-latency image loading
  protocol.handle('flyt-screenshot', (request) => {
    try {
      const url = new URL(request.url);
      const assetId = url.host + url.pathname.replace(/\/$/, '');
      const img = screenshotMap.get(assetId);
      
      if (img) {
        // img is a NativeImage. toPNG() is efficient.
        return new Response(img.toPNG());
      }
    } catch (e) {
      console.error('Protocol handler error:', e);
    }
    return new Response('Not Found', { status: 404 });
  });

  // Initialize the encrypted store (must be after app is ready)
  const fs = require('fs'); // Added for store cleanup

  // Initialize the store
  try {
    store = new Store({ name: 'auth-store' });
    // Test read to ensure validity (in case of old encrypted file)
    store.get('__test__');
  } catch (error) {
    console.warn('Could not load auth-store (likely encryption mismatch), attempting migration...');
    
    // Instead of deleting the whole file, we try to just reset specific auth keys if possible,
    // or at least log that we are resetting only the auth portion.
    // Future improvement: Separate history and auth into different store files.
    store = new Store({ name: 'auth-store' });
    try {
        store.delete('auth_secure');
        store.delete('auth');
    } catch (e) {
        // If even delete fails, we might need a reset
        const storePath = path.join(app.getPath('userData'), 'auth-store.json');
        if (fs.existsSync(storePath)) {
            // Backup before delete
            fs.copyFileSync(storePath, storePath + '.bak');
            fs.unlinkSync(storePath);
        }
        store = new Store({ name: 'auth-store' });
    }
  }

  // Set up auth listener to keep session in sync
  setupAuthListener();

  // Tool system now uses LangGraph (initialized on-demand)
  console.log('Tool system ready (LangGraph-based)');


  // Remove the application menu (File, Edit, View, etc.)
  Menu.setApplicationMenu(null);

  // Create system tray for background operation
  createTray();

  // Initialize snipping tool windows (hidden) for faster access
  await initSnippingWindows();

  // Listen for display changes to update snipping windows
  screen.on('display-added', () => initSnippingWindows());
  screen.on('display-removed', () => initSnippingWindows());
  screen.on('display-metrics-changed', () => initSnippingWindows());

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
