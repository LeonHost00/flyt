// Use shared Supabase Client from config.js
const supabaseClient = window.initSupabaseClient ? window.initSupabaseClient() :
    supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.key);

// DOM Elements
const tabs = document.querySelectorAll('.tab');
const loginContainer = document.getElementById('login-container');
const signupContainer = document.getElementById('signup-container');
const loginForm = document.getElementById('login-form');
const signupForm = document.getElementById('signup-form');
const googleBtn = document.getElementById('google-btn');
const messageEl = document.getElementById('message');

// Tab Switching
tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        const tabName = tab.dataset.tab;
        if (tabName === 'login') {
            loginContainer.classList.add('active');
            signupContainer.classList.remove('active');
        } else {
            signupContainer.classList.add('active');
            loginContainer.classList.remove('active');
        }
        hideMessage();
    });
});

// Message Helpers
function showMessage(text, type) {
    messageEl.textContent = text;
    messageEl.className = `message ${type}`;
}

function hideMessage() {
    messageEl.className = 'message';
    messageEl.textContent = '';
}

// Loading State Helper
function setLoading(button, isLoading) {
    if (isLoading) {
        button.classList.add('loading');
        button.disabled = true;
    } else {
        button.classList.remove('loading');
        button.disabled = false;
    }
}

// Email/Password Login
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideMessage();

    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const btn = document.getElementById('login-btn');

    setLoading(btn, true);

    try {
        const { data, error } = await supabaseClient.auth.signInWithPassword({
            email,
            password,
        });

        if (error) throw error;

        showMessage('Inloggning lyckades! Omdirigerar...', 'success');
        setTimeout(() => {
            window.location.href = 'dashboard';
        }, 1500);
    } catch (error) {
        showMessage(error.message || 'Ett fel uppstod vid inloggning.', 'error');
    } finally {
        setLoading(btn, false);
    }
});

// Email/Password Signup
signupForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideMessage();

    const email = document.getElementById('signup-email').value;
    const password = document.getElementById('signup-password').value;
    const btn = document.getElementById('signup-btn');

    setLoading(btn, true);

    try {
        const { data, error } = await supabaseClient.auth.signUp({
            email,
            password,
        });

        if (error) throw error;

        if (data.user && data.session === null) {
            showMessage('Konto skapat! Kontrollera din e-post för bekräftelse.', 'success');
        } else {
            showMessage('Konto skapat! Omdirigerar...', 'success');
            setTimeout(() => {
                window.location.href = 'dashboard';
            }, 1500);
        }
    } catch (error) {
        showMessage(error.message || 'Ett fel uppstod vid registrering.', 'error');
    } finally {
        setLoading(btn, false);
    }
});

// Google Login
googleBtn.addEventListener('click', async () => {
    setLoading(googleBtn, true);
    try {
        const isLandingPage = window.location.pathname.endsWith('index') || window.location.pathname.endsWith('index.html') || window.location.pathname === '/';
        const currentPath = window.location.pathname.replace(/\.html$/, ''); // Remove .html if present
        const redirectTo = window.location.origin + currentPath.replace('login', 'dashboard');
        console.log('Redirecting to:', redirectTo);

        const { data, error } = await supabaseClient.auth.signInWithOAuth({
            provider: 'google',
            options: {
                redirectTo: redirectTo,
            },
        });

        if (error) throw error;
    } catch (error) {
        console.error('Google login error:', error);
        showMessage(error.message || 'Ett fel uppstod vid Google-inloggning.', 'error');
        setLoading(googleBtn, false);
    }
});

// Check if already logged in
async function checkSession() {
    try {
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (session) {
            window.location.href = 'dashboard';
        }
    } catch (err) {
        console.error('Error checking session:', err);
    }
}

checkSession();
