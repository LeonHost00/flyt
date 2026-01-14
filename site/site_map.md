# Site Directory Structure & Overview

This document provides a map of the `site` directory, detailing the file structure, key components, and important information for anyone editing the website.

## Directory Structure

```
site/
├── config.js          # Central Supabase configuration and client initialization.
├── theme.css          # Global design system (Nordic Night Sky theme), variables, and common utility classes.
├── header.js          # Dynamic header component script. Injects the navigation bar.
├── header.css         # Styles specific to the injected header component.
├── index.html         # Main landing page. Features hero, feature grid, and download CTAs.
├── login.html         # User authentication page (Login/Sign up).
├── login.js           # Authentication logic (Supabase Auth) for the login page.
├── dashboard.html     # User dashboard/control panel for logged-in users.
└── dashboard.js       # Logic for the dashboard (subscription management, token usage, etc.).
```

## detailed Component Analysis

### 1. Configuration (`config.js`)
- **Purpose**: Manages connection details for Supabase.
- **Key Exports**: Sets `window.SUPABASE_CONFIG` and `window.initSupabaseClient`.
- **Usage**: Must be included before other scripts that require database access.

### 2. Design System (`theme.css`)
- **Theme**: "Nordic Night Sky" (Deep blues, forest greens, orange accents).
- **Key Variables**:
    - `--bg-deep`, `--bg-primary`: Main background colors.
    - `--color-accent`: "Cloudberry Orange" for CTAs.
    - `--font-main`: 'Plus Jakarta Sans' (Headings).
    - `--font-body`: 'Inter' (Body).
- **Common Classes**:
    - `.container`: Center-aligned content wrapper (max-width 1200px).
    - `.section-badge`: Pill-shaped label for sections.
    - `.hero-cta`: Main call-to-action button style.

### 3. Header Component (`header.js` & `header.css`)
- **Mechanism**: `header.js` dynamically injects the navigation HTML into the page.
- **Editing**: To modify the navigation menu links or layout, edit `header.js`. The styles are isolated in `header.css`.

### 4. Pages

#### Landing Page (`index.html`)
- **Sections**: Hero, Features Grid, Snipping Tool Showcase, Capabilities List, CTA.
- **Dynamic Behavior**: Checks for an active Supabase session. If logged in, changes the Hero CTA to "Gå till Kontrollpanel" (Go to Dashboard).

#### Login Page (`login.html` & `login.js`)
- **Function**: Handles user sign-in.
- **Styling**: Inherits from `theme.css`.
- **Logic**: Uses `login.js` to interface with Supabase Auth.

#### Dashboard (`dashboard.html` & `dashboard.js`)
- **Function**: The protected area for users.
- **Features**: Token management, subscription status, file upload (if implemented).

## Developer Notes

- **Supabase Dependency**: The site currently relies on CDN-hosted Supabase JS (`https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2`). Ensure Internet access for development.
- **CSP**: `index.html` has a strict Content-Security-Policy. If adding new external resources (fonts, scripts), update the `<meta>` tag in the `<head>`.
- **Icons**: Icons are generally SVG strings embedded directly in the HTML or JS.
