/**
 * Flyt Shared Header Component
 * Provides consistent navigation across all site pages with auth state management
 */

(function () {
    'use strict';

    // Configuration
    const DOWNLOAD_BASE_URL = 'https://flytapp.se/download/windows/';
    const LATEST_YML_URL = DOWNLOAD_BASE_URL + 'latest.yml';
    const BRANDING_BASE = 'https://cddircpnawvpryttmpel.supabase.co/storage/v1/object/public/Branding/';

    // Store the latest download URL (default to base directory)
    let latestDownloadUrl = DOWNLOAD_BASE_URL;

    // HTML Escaping Utility
    function escapeHTML(str) {
        if (!str) return '';
        const escapeMap = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
            '/': '&#x2F;'
        };
        return String(str).replace(/[&<>"'/]/g, s => escapeMap[s]);
    }

    // Header HTML Template
    function getHeaderHTML(isLoggedIn, userEmail = null) {
        const userInitial = userEmail ? escapeHTML(userEmail.charAt(0).toUpperCase()) : '';
        const displayName = userEmail ? escapeHTML(userEmail.split('@')[0]) : '';
        const escapedEmail = userEmail ? escapeHTML(userEmail) : '';

        return `
        <nav class="flyt-nav" id="main-nav">
            <div class="nav-content">
                <a href="index" class="nav-logo">
                    <img src="${BRANDING_BASE}name.svg" alt="Flyt" height="20">
                </a>

                <!-- Desktop Menu -->
                <div class="nav-links desktop-only">
                    <a href="index#features" class="nav-link">Funktioner</a>
                    <a href="index#tools" class="nav-link">Verktyg</a>
                    <a href="pricing" class="nav-link">Priser</a>
                    <a href="business" class="nav-link">Företag</a>
                    ${isLoggedIn ? `
                        <a href="dashboard" class="nav-link">Kontrollpanel</a>
                        <div class="nav-user-section">
                            <div class="user-badge" title="${userEmail}">
                                <span class="user-initial">${userInitial}</span>
                                <span class="user-name">${displayName}</span>
                            </div>
                            <button class="nav-btn logout-btn" id="header-logout-btn">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" width="16" height="16">
                                    <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
                                </svg>
                                Logga ut
                            </button>
                        </div>
                    ` : `
                        <a href="login" class="nav-link">Logga in</a>
                    `}
                    <a href="${latestDownloadUrl}" class="nav-cta download-link-windows">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" width="16" height="16">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                        </svg>
                        Ladda ner
                    </a>
                </div>

                <!-- Mobile Menu Button -->
                <button class="mobile-menu-btn" id="mobile-menu-toggle" aria-label="Toggle menu">
                    <span class="hamburger-line"></span>
                    <span class="hamburger-line"></span>
                    <span class="hamburger-line"></span>
                </button>
            </div>

            <!-- Mobile Menu Overlay -->
            <div class="mobile-menu" id="mobile-menu">
                <div class="mobile-menu-content">
                    <a href="index#features" class="mobile-nav-link">Funktioner</a>
                    <a href="index#tools" class="mobile-nav-link">Verktyg</a>
                    <a href="pricing" class="mobile-nav-link">Priser</a>
                    <a href="business" class="mobile-nav-link">Företag</a>
                    
                    ${isLoggedIn ? `
                        <div class="mobile-divider"></div>
                        <a href="dashboard" class="mobile-nav-link">Kontrollpanel</a>
                        <div class="mobile-user-info">
                            <span class="user-initial">${userInitial}</span>
                            <span class="user-email">${userEmail}</span>
                        </div>
                        <button class="mobile-nav-btn logout-btn" id="mobile-logout-btn">
                            Logga ut
                        </button>
                    ` : `
                        <div class="mobile-divider"></div>
                        <a href="login" class="mobile-nav-link">Logga in</a>
                    `}
                    
                    <a href="${latestDownloadUrl}" class="mobile-cta download-link-windows">
                        Ladda ner för Windows
                    </a>
                </div>
            </div>
        </nav>
        `;
    }

    // Header CSS is now loaded from header.css

    // Fetch latest download URL
    async function updateDownloadUrl() {
        try {
            const response = await fetch(LATEST_YML_URL);
            if (!response.ok) throw new Error('Failed to fetch latest.yml');
            const text = await response.text();

            const pathMatch = text.match(/path:\s*(.*)/);
            if (pathMatch && pathMatch[1]) {
                const latestFilename = pathMatch[1].trim();
                latestDownloadUrl = DOWNLOAD_BASE_URL + encodeURIComponent(latestFilename);

                // Update all download links on the page (desktop and mobile)
                document.querySelectorAll('.download-link-windows').forEach(link => {
                    link.href = latestDownloadUrl;
                });
                console.log('[FlytHeader] Download links updated to:', latestFilename);
            }
        } catch (error) {
            console.warn('[FlytHeader] Could not update download links:', error);
        }
    }

    // Initialize header
    async function initHeader() {

        // Check if Supabase is available and get session
        let isLoggedIn = false;
        let userEmail = null;

        if (typeof supabase !== 'undefined' && window.SUPABASE_CONFIG) {
            try {
                // Use shared Supabase client
                const supabaseClient = window.initSupabaseClient ? window.initSupabaseClient() :
                    supabase.createClient(window.SUPABASE_CONFIG.url, window.SUPABASE_CONFIG.key);
                const { data: { session } } = await supabaseClient.auth.getSession();

                if (session && session.user) {
                    isLoggedIn = true;
                    userEmail = session.user.email;

                    // Store client for logout functionality
                    window._flytSupabaseClient = supabaseClient;
                }
            } catch (error) {
                console.warn('[FlytHeader] Could not check auth state:', error);
            }
        }

        // Find or create header container
        let headerContainer = document.getElementById('flyt-header');
        if (!headerContainer) {
            headerContainer = document.createElement('div');
            headerContainer.id = 'flyt-header';
            document.body.insertBefore(headerContainer, document.body.firstChild);
        }

        // Inject header HTML
        headerContainer.innerHTML = getHeaderHTML(isLoggedIn, userEmail);

        // Logic for landing page transparency
        const isLandingPage = window.location.pathname.endsWith('index') || window.location.pathname.endsWith('index.html') || window.location.pathname === '/';
        const navEl = document.getElementById('main-nav');

        if (isLandingPage) {
            navEl.classList.add('transparent');
            document.body.classList.add('has-flyt-nav', 'transparent-header');

            // Scroll handler
            window.addEventListener('scroll', () => {
                if (window.scrollY > 50) {
                    navEl.classList.remove('transparent');
                    navEl.classList.add('scrolled');
                } else {
                    navEl.classList.add('transparent');
                    navEl.classList.remove('scrolled');
                }
            });
        } else {
            document.body.classList.add('has-flyt-nav');
        }

        // Setup logout handler (Desktop)
        const logoutBtn = document.getElementById('header-logout-btn');
        if (logoutBtn && window._flytSupabaseClient) {
            logoutBtn.addEventListener('click', handleLogout);
        }

        // Setup logout handler (Mobile)
        const mobileLogoutBtn = document.getElementById('mobile-logout-btn');
        if (mobileLogoutBtn && window._flytSupabaseClient) {
            mobileLogoutBtn.addEventListener('click', handleLogout);
        }

        // Mobile Menu Toggle Logic
        const menuBtn = document.getElementById('mobile-menu-toggle');
        const mobileMenu = document.getElementById('mobile-menu');

        if (menuBtn && mobileMenu) {
            menuBtn.addEventListener('click', () => {
                menuBtn.classList.toggle('active');
                mobileMenu.classList.toggle('active');
                document.body.classList.toggle('menu-open');
            });

            // Close menu when clicking a link
            mobileMenu.querySelectorAll('a').forEach(link => {
                link.addEventListener('click', () => {
                    menuBtn.classList.remove('active');
                    mobileMenu.classList.remove('active');
                    document.body.classList.remove('menu-open');
                });
            });
        }

        // Update download links
        await updateDownloadUrl();
    }

    // Helper for logout
    async function handleLogout() {
        try {
            await window._flytSupabaseClient.auth.signOut();
            window.location.href = 'index';
        } catch (error) {
            console.error('[FlytHeader] Logout error:', error);
            alert('Kunde inte logga ut. Försök igen.');
        }
    }

    // Wait for DOM and dependencies
    function waitForDependencies() {
        return new Promise((resolve) => {
            const checkDependencies = () => {
                // Check if config is loaded
                if (window.SUPABASE_CONFIG || document.readyState === 'complete') {
                    resolve();
                } else {
                    setTimeout(checkDependencies, 50);
                }
            };

            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', checkDependencies);
            } else {
                checkDependencies();
            }
        });
    }

    // Start initialization
    waitForDependencies().then(initHeader);

    // Export for external use
    window.FlytHeader = {
        refresh: initHeader,
        updateDownloadUrl: updateDownloadUrl
    };
})();
