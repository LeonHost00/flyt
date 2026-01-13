// Tab switching
const tabs = document.querySelectorAll('.tab');
const loginForm = document.getElementById('login-form');
const signupForm = document.getElementById('signup-form');
const messageEl = document.getElementById('message');

tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        // Update active tab
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        // Show corresponding form
        const tabName = tab.dataset.tab;
        if (tabName === 'login') {
            loginForm.classList.add('active');
            signupForm.classList.remove('active');
        } else {
            signupForm.classList.add('active');
            loginForm.classList.remove('active');
        }

        // Clear messages
        hideMessage();
    });
});

// Show message helper
function showMessage(text, type) {
    messageEl.textContent = text;
    messageEl.className = `message ${type}`;
}

function hideMessage() {
    messageEl.className = 'message';
    messageEl.textContent = '';
}

// Set button loading state
function setLoading(button, loading) {
    if (loading) {
        button.disabled = true;
        button.dataset.originalText = button.textContent;
        button.innerHTML = '<span class="loading-spinner"></span>Vänta...';
    } else {
        button.disabled = false;
        button.textContent = button.dataset.originalText;
    }
}

// Login form submission
document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideMessage();

    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    const button = document.getElementById('login-btn');

    if (!email || !password) {
        showMessage('Vänligen fyll i alla fält.', 'error');
        return;
    }

    setLoading(button, true);

    try {
        const result = await window.authAPI.login(email, password);

        if (result.success) {
            showMessage('Inloggning lyckades! Laddar appen...', 'success');
            // Signal main process to open main window
            setTimeout(async () => {
                await window.authAPI.complete();
            }, 500);
        } else {
            showMessage(result.error || 'Inloggningen misslyckades. Försök igen.', 'error');
        }
    } catch (error) {
        showMessage('Ett fel uppstod. Försök igen.', 'error');
    } finally {
        setLoading(button, false);
    }
});

// Signup form submission
document.getElementById('signupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideMessage();

    const email = document.getElementById('signup-email').value.trim();
    const password = document.getElementById('signup-password').value;
    const confirm = document.getElementById('signup-confirm').value;
    const button = document.getElementById('signup-btn');

    if (!email || !password || !confirm) {
        showMessage('Vänligen fyll i alla fält.', 'error');
        return;
    }

    if (password.length < 6) {
        showMessage('Lösenordet måste vara minst 6 tecken.', 'error');
        return;
    }

    if (password !== confirm) {
        showMessage('Lösenorden matchar inte.', 'error');
        return;
    }

    setLoading(button, true);

    try {
        const result = await window.authAPI.signup(email, password);

        if (result.success) {
            if (result.requiresConfirmation) {
                showMessage(result.message || 'Kontrollera din e-post för att bekräfta ditt konto.', 'success');
                // Switch to login tab
                tabs[0].click();
            } else {
                showMessage('Konto skapat! Laddar appen...', 'success');
                setTimeout(async () => {
                    await window.authAPI.complete();
                }, 500);
            }
        } else {
            showMessage(result.error || 'Registreringen misslyckades. Försök igen.', 'error');
        }
    } catch (error) {
        showMessage('Ett fel uppstod. Försök igen.', 'error');
    } finally {
        setLoading(button, false);
    }
});

// Forgot password modal
const resetModal = document.getElementById('reset-modal');
const forgotLink = document.getElementById('forgot-link');
const resetCancel = document.getElementById('reset-cancel');
const resetMessage = document.getElementById('reset-message');

forgotLink.addEventListener('click', (e) => {
    e.preventDefault();
    // Pre-fill email if available
    const loginEmail = document.getElementById('login-email').value;
    if (loginEmail) {
        document.getElementById('reset-email').value = loginEmail;
    }
    resetModal.classList.add('active');
});

resetCancel.addEventListener('click', () => {
    resetModal.classList.remove('active');
    resetMessage.className = 'message';
});

// Close modal on outside click
resetModal.addEventListener('click', (e) => {
    if (e.target === resetModal) {
        resetModal.classList.remove('active');
        resetMessage.className = 'message';
    }
});

// Reset password form
document.getElementById('resetForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    resetMessage.className = 'message';

    const email = document.getElementById('reset-email').value.trim();
    const button = e.target.querySelector('.submit-btn');

    if (!email) {
        resetMessage.textContent = 'Vänligen ange din e-post.';
        resetMessage.className = 'message error';
        return;
    }

    setLoading(button, true);

    try {
        const result = await window.authAPI.resetPassword(email);

        if (result.success) {
            resetMessage.textContent = 'E-post för lösenordsåterställning skickad! Kontrollera din inkorg.';
            resetMessage.className = 'message success';
            setTimeout(() => {
                resetModal.classList.remove('active');
            }, 2000);
        } else {
            resetMessage.textContent = result.error || 'Kunde inte skicka återställningsmail.';
            resetMessage.className = 'message error';
        }
    } catch (error) {
        resetMessage.textContent = 'Ett fel uppstod. Försök igen.';
        resetMessage.className = 'message error';
    } finally {
        setLoading(button, false);
    }
});

// Google OAuth Login
async function handleGoogleLogin(button) {
    button.disabled = true;
    const originalText = button.innerHTML;
    button.innerHTML = '<span class="loading-spinner"></span>Connecting to Google...';
    hideMessage();

    try {
        const result = await window.authAPI.googleLogin();
        
        if (!result.success) {
            showMessage(result.error || 'Kunde inte starta Google-inloggning.', 'error');
            button.disabled = false;
            button.innerHTML = originalText;
        }
        // If successful, an OAuth window will open and handle the rest
        // The button stays disabled until the OAuth flow completes or fails
        
        // Re-enable after a timeout in case OAuth window is closed without completing
        setTimeout(() => {
            button.disabled = false;
            button.innerHTML = originalText;
        }, 30000);
    } catch (error) {
        showMessage('Ett fel uppstod. Försök igen.', 'error');
        button.disabled = false;
        button.innerHTML = originalText;
    }
}

// Google login button (on login tab)
document.getElementById('google-login-btn').addEventListener('click', function() {
    handleGoogleLogin(this);
});

// Google signup button (on signup tab)
document.getElementById('google-signup-btn').addEventListener('click', function() {
    handleGoogleLogin(this);
});

// ===== WINDOW CONTROLS =====
const minimizeBtn = document.getElementById('minimize-btn');
const closeBtn = document.getElementById('close-btn');

// Minimize button - minimize window
minimizeBtn.addEventListener('click', async () => {
    await window.windowAPI.minimize();
});

// Close button - close to tray
closeBtn.addEventListener('click', async () => {
    await window.windowAPI.close();
});

// Auto-focus email field when window gains focus
window.addEventListener('focus', () => {
    const loginEmail = document.getElementById('login-email');
    const signupEmail = document.getElementById('signup-email');
    
    if (loginForm && loginForm.classList.contains('active') && loginEmail) {
        loginEmail.focus();
    } else if (signupForm && signupForm.classList.contains('active') && signupEmail) {
        signupEmail.focus();
    }
});
