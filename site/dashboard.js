// Use shared Supabase Client from config.js
const supabaseClient = window.initSupabaseClient ? window.initSupabaseClient() :
    supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.key);

// Initialize Stripe
const stripe = window.Stripe ? Stripe(window.SUPABASE_CONFIG.stripePublishableKey) : null;
let stripeCheckout = null; // Store checkout instance for cleanup

// Tier Configuration
const TIER_CONFIG = {
    free: { name: 'Free', monthlyTokens: 10000, badgeClass: 'free' },
    pro: { name: 'Pro', monthlyTokens: 200000, badgeClass: 'pro' }
};

// Storage Configuration
const STORAGE_CONFIG = {
    free: { limit: 1048576, limitDisplay: '1 MB' },
    pro: { limit: 20971520, limitDisplay: '20 MB' }
};
const STORAGE_BUCKET = 'user-files';

// Current state
let currentTier = 'free';
let pendingTierChange = null;

// DOM Elements
const welcomeMsgEl = document.getElementById('welcome-msg');
const tokenBalanceEl = document.getElementById('token-balance');
const tokenSubtitleEl = document.getElementById('token-subtitle');
const userTierEl = document.getElementById('user-tier');
const memberSinceEl = document.getElementById('member-since');
const profileEmailEl = document.getElementById('profile-email');
const authProviderEl = document.getElementById('auth-provider');
const emailVerifiedEl = document.getElementById('email-verified');

// Subscription UI Elements
const tierBadgeEl = document.getElementById('tier-badge');
const monthlyTokensEl = document.getElementById('monthly-tokens');
const upgradeTierBtn = document.getElementById('upgrade-tier-btn');
const downgradeTierBtn = document.getElementById('downgrade-tier-btn');

// Modal Elements
const passwordModal = document.getElementById('password-modal');
const deleteModal = document.getElementById('delete-modal');
const addTokensModal = document.getElementById('add-tokens-modal');
const tierModal = document.getElementById('tier-modal');
const toast = document.getElementById('toast');

// File Storage Elements
const storageFillEl = document.getElementById('storage-fill');
const storageUsedEl = document.getElementById('storage-used');
const storageLimitEl = document.getElementById('storage-limit');
const storageSubtitleEl = document.getElementById('storage-subtitle');
const uploadLimitTextEl = document.getElementById('upload-limit-text');
const uploadZoneEl = document.getElementById('upload-zone');
const fileInputEl = document.getElementById('file-input');
const fileListEl = document.getElementById('file-list');
const fileEmptyEl = document.getElementById('file-empty');
const fileCountEl = document.getElementById('file-count');
const uploadProgressEl = document.getElementById('upload-progress');
const uploadProgressFillEl = document.getElementById('upload-progress-fill');
const uploadProgressTextEl = document.getElementById('upload-progress-text');

// Check Session & Load Data
async function initDashboard() {
    const { data: { session }, error } = await supabaseClient.auth.getSession();

    if (error || !session) {
        console.error('No active session, redirecting to login...');
        window.location.href = 'login';
        return;
    }

    const user = session.user;
    const displayName = user.email.split('@')[0];

    // Update welcome message
    if (welcomeMsgEl) {
        welcomeMsgEl.textContent = `Välkommen, ${displayName}!`;
    }

    // Update profile section
    if (profileEmailEl) {
        profileEmailEl.textContent = user.email;
    }

    // Update auth provider
    if (authProviderEl) {
        const provider = user.app_metadata?.provider || 'email';
        authProviderEl.textContent = provider === 'google' ? 'Google' : 'E-post';
    }

    // Update email verified status
    if (emailVerifiedEl) {
        if (user.email_confirmed_at) {
            emailVerifiedEl.innerHTML = '<span class="status-badge verified">Verifierad</span>';
        } else {
            emailVerifiedEl.innerHTML = '<span class="status-badge" style="background: rgba(255, 140, 66, 0.15); color: #FFA366; border: 1px solid rgba(255, 140, 66, 0.3);">Ej verifierad</span>';
        }
    }

    // Update member since
    if (memberSinceEl) {
        const createdAt = new Date(user.created_at);
        memberSinceEl.textContent = `Medlem sedan ${createdAt.toLocaleDateString('sv-SE', { year: 'numeric', month: 'long' })}`;
    }

    // Handle payment redirect URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const paymentStatus = urlParams.get('payment');
    const sessionId = urlParams.get('session_id');

    if (paymentStatus === 'success') {
        handlePostPaymentPolling(user.id);
        // Clean URL immediately
        window.history.replaceState({}, document.title, window.location.pathname);
    } else if (sessionId) {
        // Legacy Support or fallback for checkout sessions
        setTimeout(() => {
            showToast('Välkommen till Pro! 🎉 Din betalning lyckades.', 'success');
        }, 500);
        window.history.replaceState({}, document.title, window.location.pathname);
    } else if (paymentStatus === 'cancelled') {
        setTimeout(() => {
            showToast('Betalningen avbröts. Du kan försöka igen när som helst.', 'error');
        }, 500);
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    loadUserData(user.id);
    loadStorageInfo();
    loadUserFiles();
    setupEventListeners();
    setupFileStorageListeners();
}

// Polling logic for tier change after payment
async function handlePostPaymentPolling(userId) {
    const overlay = document.getElementById('success-overlay');
    const title = document.getElementById('success-title');
    const msg = document.getElementById('success-msg');

    if (overlay) overlay.classList.add('active', 'processing');

    let attempts = 0;
    const maxAttempts = 15; // ~22 seconds total

    const checkTier = async () => {
        try {
            const { data, error } = await supabaseClient
                .from('user_profiles')
                .select('tier')
                .eq('id', userId)
                .single();

            if (!error && data?.tier === 'pro') {
                // Success!
                if (overlay) {
                    overlay.classList.remove('processing');
                    overlay.classList.add('complete');
                }
                if (title) title.textContent = 'Uppgradering klar!';
                if (msg) msg.textContent = 'Välkommen till Pro-planen. Nu kör vi!';

                // Refresh all UI data
                await loadUserData(userId);
                await loadStorageInfo();

                // Wait a bit to show success state then fade out
                setTimeout(() => {
                    if (overlay) overlay.style.opacity = '0';
                    setTimeout(() => {
                        if (overlay) overlay.classList.remove('active', 'complete');
                        showToast('Din prenumeration är nu aktiv! 🎉', 'success');
                    }, 500);
                }, 2500);

                return true;
            }
        } catch (e) {
            console.warn('Polling error:', e);
        }
        return false;
    };

    // Start polling
    const pollInterval = setInterval(async () => {
        attempts++;
        const finished = await checkTier();

        if (finished || attempts >= maxAttempts) {
            clearInterval(pollInterval);
            if (!finished) {
                // Timeout
                if (overlay) overlay.classList.remove('active');
                showToast('Betalningen behandlas. Det kan ta en liten stund innan Pro visas.', 'info');
                loadUserData(userId);
            }
        }
    }, 1500);
}

// Fetch user profile data (tokens, tier)
async function loadUserData(userId) {
    try {
        const { data, error } = await supabaseClient
            .from('user_profiles')
            .select('tokens, tier')
            .eq('id', userId)
            .single();

        if (error) {
            console.warn('Could not fetch user profile:', error);
            // Fallback for new users or if profile doesn't exist yet
            if (tokenBalanceEl) tokenBalanceEl.textContent = '10 000';
            if (tokenSubtitleEl) tokenSubtitleEl.textContent = 'Välkomstbonus installerad';
            if (userTierEl) userTierEl.textContent = 'Free';
            updateTierUI('free');
            return;
        }

        // Store current tier
        currentTier = data.tier || 'free';

        // Update UI with real data
        if (tokenBalanceEl) tokenBalanceEl.textContent = new Intl.NumberFormat('sv-SE').format(data.tokens);
        if (tokenSubtitleEl) tokenSubtitleEl.textContent = 'Tillgängliga tokens';
        if (userTierEl) userTierEl.textContent = TIER_CONFIG[currentTier]?.name || 'Free';

        // Update subscription UI
        updateTierUI(currentTier);

    } catch (err) {
        console.error('Error loading user data:', err);
        if (tokenBalanceEl) tokenBalanceEl.textContent = 'Error';
        if (tokenSubtitleEl) tokenSubtitleEl.textContent = 'Kunde inte hämta saldo';
    }
}

// Update tier-related UI elements
function updateTierUI(tier) {
    const tierInfo = TIER_CONFIG[tier] || TIER_CONFIG.free;

    // Update tier badge
    if (tierBadgeEl) {
        tierBadgeEl.textContent = tierInfo.name;
        tierBadgeEl.className = `status-badge ${tierInfo.badgeClass}`;
    }

    // Update monthly tokens display
    if (monthlyTokensEl) {
        monthlyTokensEl.textContent = new Intl.NumberFormat('sv-SE').format(tierInfo.monthlyTokens) + ' tokens';
    }

    // Show/hide appropriate tier action buttons
    if (tier === 'pro') {
        if (upgradeTierBtn) upgradeTierBtn.style.display = 'none';
        if (downgradeTierBtn) downgradeTierBtn.style.display = 'inline-flex';
    } else {
        if (upgradeTierBtn) upgradeTierBtn.style.display = 'inline-flex';
        if (downgradeTierBtn) downgradeTierBtn.style.display = 'none';
    }
}

// Setup event listeners for account management
function setupEventListeners() {
    // Password change buttons
    const changePasswordBtn = document.getElementById('change-password-btn');
    const changePasswordBtn2 = document.getElementById('change-password-btn-2');
    const cancelPassword = document.getElementById('cancel-password');
    const savePassword = document.getElementById('save-password');

    if (changePasswordBtn) {
        changePasswordBtn.addEventListener('click', () => openModal(passwordModal));
    }
    if (changePasswordBtn2) {
        changePasswordBtn2.addEventListener('click', () => openModal(passwordModal));
    }
    if (cancelPassword) {
        cancelPassword.addEventListener('click', () => closeModal(passwordModal));
    }
    if (savePassword) {
        savePassword.addEventListener('click', handlePasswordChange);
    }

    // Delete account buttons
    const deleteAccountBtn = document.getElementById('delete-account-btn');
    const cancelDelete = document.getElementById('cancel-delete');
    const confirmDelete = document.getElementById('confirm-delete');

    if (deleteAccountBtn) {
        deleteAccountBtn.addEventListener('click', () => openModal(deleteModal));
    }
    if (cancelDelete) {
        cancelDelete.addEventListener('click', () => closeModal(deleteModal));
    }
    if (confirmDelete) {
        confirmDelete.addEventListener('click', handleDeleteAccount);
    }

    // Close modals on overlay click
    [passwordModal, deleteModal].forEach(modal => {
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) closeModal(modal);
            });
        }
    });

    // Close modals on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeModal(passwordModal);
            closeModal(deleteModal);
            closeModal(addTokensModal);
            closeModal(tierModal);
        }
    });

    // Add Tokens button and modal
    const addTokensBtn = document.getElementById('add-tokens-btn');
    const cancelAddTokens = document.getElementById('cancel-add-tokens');
    const confirmAddTokens = document.getElementById('confirm-add-tokens');

    if (addTokensBtn) {
        addTokensBtn.addEventListener('click', () => openModal(addTokensModal));
    }
    if (cancelAddTokens) {
        cancelAddTokens.addEventListener('click', () => closeModal(addTokensModal));
    }
    if (confirmAddTokens) {
        confirmAddTokens.addEventListener('click', handleAddTokens);
    }

    // Tier change buttons and modal
    const cancelTierChange = document.getElementById('cancel-tier-change');
    const confirmTierChange = document.getElementById('confirm-tier-change');

    if (upgradeTierBtn) {
        upgradeTierBtn.addEventListener('click', () => openTierChangeModal('pro'));
    }
    if (downgradeTierBtn) {
        downgradeTierBtn.addEventListener('click', () => openTierChangeModal('free'));
    }
    if (cancelTierChange) {
        cancelTierChange.addEventListener('click', () => closeModal(tierModal));
    }
    if (confirmTierChange) {
        confirmTierChange.addEventListener('click', handleTierChange);
    }

    // Close new modals on overlay click
    [addTokensModal, tierModal].forEach(modal => {
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) closeModal(modal);
            });
        }
    });
}

// Modal functions
function openModal(modal) {
    if (modal) modal.classList.add('active');
}

function closeModal(modal) {
    if (modal) {
        modal.classList.remove('active');
        // Clear inputs
        const inputs = modal.querySelectorAll('input');
        inputs.forEach(input => input.value = '');

        // Clean up checkout if closing tier modal
        if (modal.id === 'tier-modal') {
            cleanupCheckout();
        }
    }
}

// Toast notification
function showToast(message, type = 'success') {
    if (!toast) return;

    toast.textContent = message;
    toast.className = `message-toast ${type}`;
    toast.classList.add('show');

    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// Handle password change
async function handlePasswordChange() {
    const newPassword = document.getElementById('new-password')?.value;
    const confirmPassword = document.getElementById('confirm-password')?.value;

    if (!newPassword || newPassword.length < 6) {
        showToast('Lösenordet måste vara minst 6 tecken', 'error');
        return;
    }

    if (newPassword !== confirmPassword) {
        showToast('Lösenorden matchar inte', 'error');
        return;
    }

    try {
        const { error } = await supabaseClient.auth.updateUser({
            password: newPassword
        });

        if (error) throw error;

        closeModal(passwordModal);
        showToast('Lösenordet har ändrats!', 'success');
    } catch (err) {
        console.error('Error changing password:', err);
        showToast('Kunde inte ändra lösenord: ' + err.message, 'error');
    }
}

// Handle account deletion
async function handleDeleteAccount() {
    const confirmInput = document.getElementById('delete-confirm')?.value;

    if (confirmInput !== 'RADERA') {
        showToast('Du måste skriva RADERA för att bekräfta', 'error');
        return;
    }

    try {
        // Note: Account deletion requires server-side handling with service role
        // For now, we'll sign out and show a message
        showToast('Kontakta support för att radera ditt konto', 'error');
        closeModal(deleteModal);

        // In a full implementation, you would call a server function here:
        // const { error } = await supabaseClient.rpc('delete_user_account');

    } catch (err) {
        console.error('Error deleting account:', err);
        showToast('Kunde inte radera konto: ' + err.message, 'error');
    }
}

// Handle adding tokens
async function handleAddTokens() {
    const tokenAmountInput = document.getElementById('token-amount');
    const amount = parseInt(tokenAmountInput?.value, 10);

    if (!amount || amount <= 0) {
        showToast('Ange ett giltigt antal tokens', 'error');
        return;
    }

    try {
        const { data, error } = await supabaseClient.rpc('add_tokens', {
            p_amount: amount,
            p_description: 'Manuell påfyllning via kontrollpanel'
        });

        if (error) throw error;

        if (data.success) {
            closeModal(addTokensModal);
            showToast(`${new Intl.NumberFormat('sv-SE').format(amount)} tokens har lagts till!`, 'success');

            // Update token balance in UI
            if (tokenBalanceEl) {
                tokenBalanceEl.textContent = new Intl.NumberFormat('sv-SE').format(data.new_balance);
            }
        } else {
            throw new Error(data.error || 'Kunde inte lägga till tokens');
        }
    } catch (err) {
        console.error('Error adding tokens:', err);
        showToast('Kunde inte lägga till tokens: ' + err.message, 'error');
    }
}

// Open tier change modal with appropriate messaging
function openTierChangeModal(newTier) {
    pendingTierChange = newTier;
    const tierInfo = TIER_CONFIG[newTier];

    // Elements for legacy modal (used for downgrades)
    const modalTitle = document.getElementById('tier-modal-title');
    const modalDesc = document.getElementById('tier-modal-description');
    const confirmBtn = document.getElementById('confirm-tier-change');
    const tierModalActions = document.getElementById('tier-modal-actions');

    // Elements for new Payment Overlay
    const paymentOverlay = document.getElementById('payment-overlay');
    const paymentCloseBtn = document.getElementById('close-payment-overlay');

    if (newTier === 'pro') {
        // Use Full Screen Payment Overlay for Upgrades
        if (paymentOverlay) {
            paymentOverlay.classList.add('active');

            // Setup close button for overlay
            if (paymentCloseBtn) {
                paymentCloseBtn.onclick = () => {
                    cleanupCheckout();
                };
            }

            // Start Checkout Process immediately
            initiateStripeCheckout();
        }
    } else {
        // Use legacy modal for Downgrades
        if (modalTitle) modalTitle.textContent = 'Nedgradera till Free';
        if (modalDesc) modalDesc.innerHTML = `
            Är du säker på att du vill nedgradera till Free-planen?<br><br>
            <strong>Free-planen inkluderar:</strong><br>
            • ${new Intl.NumberFormat('sv-SE').format(TIER_CONFIG.free.monthlyTokens)} tokens/månad<br><br>
            <em style="color: var(--text-muted);">Dina tokens kommer att begränsas till ${new Intl.NumberFormat('sv-SE').format(TIER_CONFIG.free.monthlyTokens)}.</em>
        `;
        if (confirmBtn) {
            confirmBtn.className = 'modal-btn danger';
            confirmBtn.textContent = 'Nedgradera';
        }
        if (tierModalActions) tierModalActions.style.display = 'flex';

        openModal(tierModal);
    }
}

// Initiate Stripe Checkout for Pro Upgrade
async function initiateStripeCheckout() {
    const checkoutContainer = document.getElementById('checkout-container');
    const checkoutElement = document.getElementById('checkout-element');
    const checkoutLoading = document.getElementById('checkout-loading');
    const submitBtn = document.getElementById('checkout-submit');

    try {
        if (!stripe) {
            throw new Error('Stripe kunde inte initialiseras');
        }

        // Show loading state
        if (checkoutContainer) checkoutContainer.classList.add('active');
        if (checkoutLoading) checkoutLoading.classList.remove('hidden');

        // Get session token for Edge Function auth
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) {
            throw new Error('Du måste vara inloggad');
        }

        // Call Edge Function
        const response = await fetch(
            `${window.SUPABASE_CONFIG.url}/functions/v1/create-checkout-session`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${session.access_token}`,
                    'apikey': window.SUPABASE_CONFIG.key,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    return_url: window.location.origin + '/dashboard?session_id={CHECKOUT_SESSION_ID}',
                }),
            }
        );

        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(result.error || result.message || 'Kunde inte skapa betalningssession');
        }

        if (!result.clientSecret) {
            throw new Error('Ingen checkout-session mottogs');
        }

        // Clean up previous checkout if exists
        stripeCheckout = null;

        // Initialize Stripe Elements with Custom Appearance
        const appearance = {
            theme: 'night',
            variables: {
                colorPrimary: '#FF8C42',
                colorBackground: '#0d1b2a',
                colorText: '#f0f4f8',
                colorDanger: '#e63232',
                fontFamily: 'Inter, system-ui, sans-serif',
                spacingUnit: '5px',
                borderRadius: '16px',
            },
            rules: {
                '.Input': {
                    backgroundColor: '#1b263b',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    color: '#f0f4f8',
                    paddingTop: '16px',
                    paddingBottom: '16px',
                },
                '.Input:focus': {
                    border: '1px solid #FF8C42',
                    boxShadow: 'none'
                },
                '.Label': {
                    color: '#b0c4de',
                    marginBottom: '8px',
                    fontWeight: '500'
                },
                '.Tab': {
                    backgroundColor: '#1b263b',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                },
                '.Tab--selected': {
                    backgroundColor: '#0d1b2a',
                    border: '1px solid #FF8C42',
                    color: '#FF8C42'
                }
            }
        };

        const elements = stripe.elements({
            clientSecret: result.clientSecret,
            appearance
        });

        // Create and mount the Payment Element
        const paymentElement = elements.create('payment', {
            layout: 'tabs',
            wallets: {
                applePay: 'auto',
                googlePay: 'auto'
            }
        });

        stripeCheckout = elements; // Store for cleanup
        paymentElement.mount('#checkout-element');

        // Handle loading state
        paymentElement.on('ready', () => {
            if (checkoutLoading) checkoutLoading.classList.add('hidden');
            if (submitBtn) {
                submitBtn.style.display = 'block';
                submitBtn.textContent = 'Starta prenumeration (179 kr/mån)';
            }
        });

        // Handle submit
        submitBtn.onclick = async () => {
            submitBtn.disabled = true;
            submitBtn.textContent = 'Behandlar...';

            const { error } = await stripe.confirmPayment({
                elements,
                confirmParams: {
                    return_url: window.location.origin + '/dashboard?payment=success',
                },
            });

            if (error) {
                const errorDiv = document.getElementById('checkout-error');
                errorDiv.textContent = error.message;
                errorDiv.style.display = 'block';
                submitBtn.disabled = false;
                submitBtn.textContent = 'Starta prenumeration (179 kr/mån)';
            }
        };

    } catch (err) {
        console.error('Error initiating checkout:', err);
        showToast('Kunde inte starta betalning: ' + err.message, 'error');
        cleanupCheckout();
    }
}
// Handle tier change (Downgrades only)
async function handleTierChange() {
    if (!pendingTierChange || pendingTierChange === 'pro') {
        return; // Pro is handled via initiateStripeCheckout
    }

    const confirmBtn = document.getElementById('confirm-tier-change');

    try {
        if (confirmBtn) {
            confirmBtn.disabled = true;
            confirmBtn.textContent = 'Bearbetar...';
        }

        // Call RPC to change tier
        const { data, error } = await supabaseClient.rpc('change_user_tier', {
            p_new_tier: pendingTierChange
        });

        if (error) throw error;

        if (data.success) {
            closeModal(tierModal);
            currentTier = data.new_tier;

            // Update UI
            updateTierUI(currentTier);
            if (userTierEl) userTierEl.textContent = TIER_CONFIG[currentTier]?.name || 'Free';
            if (tokenBalanceEl) {
                tokenBalanceEl.textContent = new Intl.NumberFormat('sv-SE').format(data.new_balance);
            }

            showToast('Din plan har ändrats till Free', 'success');

            // Update storage limits display
            currentStorageLimit = STORAGE_CONFIG[currentTier]?.limit || 1048576;
            updateStorageUI();
        } else {
            throw new Error(data.error || 'Kunde inte ändra plan');
        }

    } catch (err) {
        console.error('Error changing tier:', err);
        showToast('Kunde inte ändra plan: ' + err.message, 'error');
    } finally {
        if (confirmBtn) {
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Bekräfta'; // Reset button text
        }
        pendingTierChange = null;
    }
}

// Clean up checkout when modal is closed
function cleanupCheckout() {
    const checkoutContainer = document.getElementById('checkout-container');
    const checkoutLoading = document.getElementById('checkout-loading');
    const tierModalActions = document.getElementById('tier-modal-actions');
    const confirmBtn = document.getElementById('confirm-tier-change');
    const submitBtn = document.getElementById('checkout-submit');
    const errorDiv = document.getElementById('checkout-error');
    const paymentOverlay = document.getElementById('payment-overlay');

    // Destroy elements group if it exists (stripeCheckout stores 'elements' now)
    if (stripeCheckout) {
        // There isn't a simple destroy() on the elements group instance in v3
        // We'll just clear the HTML container which unmounts it effectively
        const elementDiv = document.getElementById('checkout-element');
        if (elementDiv) elementDiv.innerHTML = '';
        stripeCheckout = null;
    }

    if (checkoutContainer) checkoutContainer.classList.remove('active');
    if (tierModal) tierModal.classList.remove('expanded');
    if (checkoutLoading) checkoutLoading.classList.remove('hidden');
    if (tierModalActions) tierModalActions.style.display = 'flex';
    if (paymentOverlay) paymentOverlay.classList.remove('active');

    if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = 'Bekräfta';
    }

    // Reset specific payment element UI
    if (submitBtn) {
        submitBtn.style.display = 'none';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Starta prenumeration';
    }
    if (errorDiv) {
        errorDiv.style.display = 'none';
        errorDiv.textContent = '';
    }

    pendingTierChange = null;
}

// ═══════════════════════════════════════════════════════════════════════════
// FILE STORAGE FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

// Sanitize filename for Supabase Storage
function sanitizeFilename(filename) {
    if (!filename) return 'unnamed_file';

    // Split name and extension
    const parts = filename.split('.');
    const ext = parts.length > 1 ? parts.pop() : '';
    let name = parts.join('.');

    // Replace problematic characters with underscores
    // Allowed: alphanumeric, underscores, hyphens, periods (but not as first char)
    // Supabase keys can be tricky with non-ASCII or certain symbols
    name = name
        .replace(/[^\w\s\-\.]/gi, '_') // Replace non-alphanumeric (except space, dash, dot)
        .replace(/\s+/g, '_')          // Replace spaces with underscores
        .trim();                       // Trim ends

    if (!name) name = 'file';

    return ext ? `${name}.${ext}` : name;
}

// Current storage state
let currentStorageUsed = 0;
let currentStorageLimit = 1048576;

// Load storage info from database
async function loadStorageInfo() {
    try {
        const { data, error } = await supabaseClient.rpc('get_storage_info');

        if (error) throw error;

        if (data.success) {
            currentStorageUsed = data.storage_used_bytes || 0;
            currentStorageLimit = data.storage_limit_bytes || STORAGE_CONFIG[currentTier]?.limit || 1048576;

            updateStorageUI();
        }
    } catch (err) {
        console.warn('Could not load storage info:', err);
        // Use defaults based on tier
        currentStorageLimit = STORAGE_CONFIG[currentTier]?.limit || 1048576;
        updateStorageUI();
    }
}

// Update storage UI elements
function updateStorageUI() {
    const percentage = currentStorageLimit > 0 ? (currentStorageUsed / currentStorageLimit) * 100 : 0;
    const tierConfig = STORAGE_CONFIG[currentTier] || STORAGE_CONFIG.free;

    if (storageFillEl) {
        storageFillEl.style.width = `${Math.min(percentage, 100)}%`;
        storageFillEl.className = 'storage-fill';
        if (percentage > 90) {
            storageFillEl.classList.add('critical');
        } else if (percentage > 70) {
            storageFillEl.classList.add('warning');
        }
    }

    if (storageUsedEl) {
        storageUsedEl.textContent = formatFileSize(currentStorageUsed);
    }

    if (storageLimitEl) {
        // Use actual limit from database, not hardcoded config
        storageLimitEl.textContent = formatFileSize(currentStorageLimit);
    }

    if (storageSubtitleEl) {
        const remaining = currentStorageLimit - currentStorageUsed;
        storageSubtitleEl.textContent = `${formatFileSize(remaining)} ledigt utrymme`;
    }

    if (uploadLimitTextEl) {
        // Use actual limit from database
        uploadLimitTextEl.textContent = `Max ${formatFileSize(currentStorageLimit)} totalt (${TIER_CONFIG[currentTier]?.name || 'Free'})`;
    }
}

// Format bytes to human readable
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Load user's files from storage
async function loadUserFiles() {
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session) return;

        const userId = session.user.id;
        const { data: files, error } = await supabaseClient.storage
            .from(STORAGE_BUCKET)
            .list(userId, {
                limit: 100,
                sortBy: { column: 'created_at', order: 'desc' }
            });

        if (error) {
            console.warn('Could not load files:', error);
            return;
        }

        renderFileList(files || []);
    } catch (err) {
        console.error('Error loading files:', err);
    }
}

// Render file list
function renderFileList(files) {
    if (!fileListEl) return;

    // Filter out .emptyFolderPlaceholder files
    const realFiles = files.filter(f => f.name !== '.emptyFolderPlaceholder');

    if (fileCountEl) {
        fileCountEl.textContent = `${realFiles.length} fil${realFiles.length !== 1 ? 'er' : ''}`;
    }

    if (realFiles.length === 0) {
        if (fileEmptyEl) fileEmptyEl.style.display = 'block';
        // Remove file items but keep empty state
        const fileItems = fileListEl.querySelectorAll('.file-item');
        fileItems.forEach(item => item.remove());
        return;
    }

    if (fileEmptyEl) fileEmptyEl.style.display = 'none';

    // Remove existing file items
    const existingItems = fileListEl.querySelectorAll('.file-item');
    existingItems.forEach(item => item.remove());

    // Add new file items
    realFiles.forEach(file => {
        const fileItem = createFileItem(file);
        fileListEl.appendChild(fileItem);
    });
}

// Create file item element
function createFileItem(file) {
    const div = document.createElement('div');
    div.className = 'file-item';
    div.dataset.fileName = file.name;

    const extension = file.name.split('.').pop()?.toLowerCase() || '';
    const iconSvg = getFileIcon(extension);

    const created = file.created_at ? new Date(file.created_at).toLocaleDateString('sv-SE') : '';
    const size = formatFileSize(file.metadata?.size || 0);

    // File Icon Container
    const iconContainer = document.createElement('div');
    iconContainer.className = 'file-icon';
    iconContainer.innerHTML = iconSvg; // Safe as getFileIcon returns hardcoded SVG strings

    // File Info Container
    const infoContainer = document.createElement('div');
    infoContainer.className = 'file-info';

    const fileNameEl = document.createElement('div');
    fileNameEl.className = 'file-name';
    fileNameEl.title = file.name;
    fileNameEl.textContent = file.name;

    const metaContainer = document.createElement('div');
    metaContainer.className = 'file-meta';

    const sizeSpan = document.createElement('span');
    sizeSpan.textContent = size;
    metaContainer.appendChild(sizeSpan);

    if (created) {
        const dateSpan = document.createElement('span');
        dateSpan.textContent = created;
        metaContainer.appendChild(dateSpan);
    }

    infoContainer.appendChild(fileNameEl);
    infoContainer.appendChild(metaContainer);

    // Delete Button
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'file-delete-btn';
    deleteBtn.title = 'Radera fil';
    deleteBtn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
    `; // Safe hardcoded SVG

    deleteBtn.addEventListener('click', () => deleteFile(file.name, file.metadata?.size || 0));

    // Assemble
    div.appendChild(iconContainer);
    div.appendChild(infoContainer);
    div.appendChild(deleteBtn);

    return div;
}

// Get appropriate file icon based on extension
function getFileIcon(extension) {
    const docTypes = ['doc', 'docx', 'pdf', 'txt', 'rtf', 'odt'];
    const imageTypes = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'];
    const codeTypes = ['js', 'ts', 'py', 'html', 'css', 'json', 'xml', 'md'];

    if (docTypes.includes(extension)) {
        return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>`;
    }
    if (imageTypes.includes(extension)) {
        return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>`;
    }
    if (codeTypes.includes(extension)) {
        return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" /></svg>`;
    }
    // Default file icon
    return `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>`;
}

// Setup file storage event listeners
function setupFileStorageListeners() {
    if (!uploadZoneEl || !fileInputEl) return;

    // Click to upload
    uploadZoneEl.addEventListener('click', () => fileInputEl.click());

    // File input change
    fileInputEl.addEventListener('change', (e) => {
        if (e.target.files?.length > 0) {
            handleFileUpload(Array.from(e.target.files));
        }
    });

    // Drag and drop
    uploadZoneEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadZoneEl.classList.add('dragover');
    });

    uploadZoneEl.addEventListener('dragleave', (e) => {
        e.preventDefault();
        uploadZoneEl.classList.remove('dragover');
    });

    uploadZoneEl.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadZoneEl.classList.remove('dragover');
        if (e.dataTransfer?.files?.length > 0) {
            handleFileUpload(Array.from(e.dataTransfer.files));
        }
    });
}

// Handle file upload
async function handleFileUpload(files) {
    if (files.length === 0) return;

    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) {
        showToast('Du måste vara inloggad för att ladda upp filer', 'error');
        return;
    }

    const userId = session.user.id;
    let successCount = 0;
    let totalSizeUploaded = 0;

    // Show progress
    if (uploadProgressEl) uploadProgressEl.classList.add('active');

    for (let i = 0; i < files.length; i++) {
        const file = files[i];

        // Update progress text
        if (uploadProgressTextEl) {
            uploadProgressTextEl.textContent = `Laddar upp ${file.name} (${i + 1}/${files.length})...`;
        }
        if (uploadProgressFillEl) {
            uploadProgressFillEl.style.width = `${((i) / files.length) * 100}%`;
        }

        // Check storage limit
        try {
            const { data: checkResult, error: checkError } = await supabaseClient.rpc('check_storage_limit', {
                p_file_size: file.size
            });

            if (checkError) throw checkError;

            if (!checkResult.allowed) {
                showToast(`"${file.name}" är för stor. Lagringsgränsen skulle överskridas.`, 'error');
                continue;
            }
        } catch (err) {
            // If RPC fails, do a basic check
            if (currentStorageUsed + file.size > currentStorageLimit) {
                showToast(`"${file.name}" är för stor. Uppgradera till Pro för mer lagring.`, 'error');
                continue;
            }
        }

        // Sanitize filename
        const sanitizedName = sanitizeFilename(file.name);
        const filePath = `${userId}/${sanitizedName}`;

        try {
            const { error: uploadError } = await supabaseClient.storage
                .from(STORAGE_BUCKET)
                .upload(filePath, file, {
                    cacheControl: '3600',
                    upsert: true
                });

            if (uploadError) {
                console.error('Upload error:', uploadError);
                showToast(`Kunde inte ladda upp "${file.name}": ${uploadError.message}`, 'error');
                continue;
            }

            // Update storage usage in database
            try {
                await supabaseClient.rpc('update_storage_usage', {
                    p_size_delta: file.size,
                    p_file_delta: 1
                });
            } catch (rpcErr) {
                console.warn('Could not update storage usage:', rpcErr);
            }

            successCount++;
            totalSizeUploaded += file.size;

        } catch (err) {
            console.error('Upload error:', err);
            showToast(`Kunde inte ladda upp "${file.name}"`, 'error');
        }
    }

    // Hide progress
    if (uploadProgressEl) uploadProgressEl.classList.remove('active');
    if (uploadProgressFillEl) uploadProgressFillEl.style.width = '0%';

    // Clear file input
    if (fileInputEl) fileInputEl.value = '';

    if (successCount > 0) {
        showToast(`${successCount} fil${successCount > 1 ? 'er' : ''} uppladdade!`, 'success');
        currentStorageUsed += totalSizeUploaded;
        updateStorageUI();
        loadUserFiles();
    }
}

// Delete a file
async function deleteFile(fileName, fileSize) {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (!session) return;

    const userId = session.user.id;
    const filePath = `${userId}/${fileName}`;

    try {
        const { error } = await supabaseClient.storage
            .from(STORAGE_BUCKET)
            .remove([filePath]);

        if (error) throw error;

        // Update storage usage
        try {
            await supabaseClient.rpc('update_storage_usage', {
                p_size_delta: -fileSize,
                p_file_delta: -1
            });
        } catch (rpcErr) {
            console.warn('Could not update storage usage:', rpcErr);
        }

        currentStorageUsed = Math.max(0, currentStorageUsed - fileSize);
        updateStorageUI();

        // Remove from UI
        const fileItem = fileListEl?.querySelector(`[data-file-name="${fileName}"]`);
        if (fileItem) {
            fileItem.remove();
        }

        showToast('Fil raderad', 'success');
        loadUserFiles();

    } catch (err) {
        console.error('Error deleting file:', err);
        showToast('Kunde inte radera filen: ' + err.message, 'error');
    }
}

// Start
initDashboard();
