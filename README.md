# Flyt - AI-Powered Desktop Assistant

Flyt is a modular, agentic desktop assistant built with Electron and integrated with LLMs via OpenRouter. It features a robust tool system, secure authentication with Supabase, and a token-based usage model.

## 🏗️ Architecture Overview

The application follows the standard Electron architecture:
- **Main Process (`main.js`)**: Orchestrates the application, manages windows, handles IPC, and runs the **Agent Loop**.
- **Preload Script (`preload.js`)**: Bridges the Main and Renderer processes securely.
- **Renderer Process (`renderer.js`)**: Powers the chat UI, system monitoring, and user interactions.

## 📂 Project Structure

```text
Flyt/
├── main.js             # Main process & Agent Loop logic
├── preload.js          # IPC bridge definitions
├── renderer.js         # Primary UI logic (Chat, Tokens, System Info)
├── auth-renderer.js    # Authentication UI logic
├── index.html          # Main application window
├── auth.html           # Login/Signup window
├── snipping.html       # Snipping tool overlay
├── theme.css           # Global styling
├── tools/              # Modular Agent Tool System
│   ├── index.js        # Tool registration entry point
│   ├── registry.js     # Central tool registry & documentation generator
│   ├── base.js         # Base classes for Tools and ToolResults
│   ├── filesystem.js   # File operations (Read, Write, Edit, List, Search)
│   ├── shell.js        # Terminal operations (Command execution)
│   ├── system.js       # System utilities (Clipboard, URL, System Info)
│   └── image.js        # Image processing (WASM-based Magick)
├── supabase/           # Database configuration & migrations
│   └── migrations/     # SQL schemas for user profiles, tokens, and settings
└── assets/             # Branding and UI icons
```
*Note: `dist/`, `email/`, and `site/` directories are ignored as they contain build artifacts or static web content.*

## 🤖 The Agent System

Flyt is designed to be "agentic," meaning the AI can perform actions on your computer using tools.

### 🔄 The Agent Loop (`main.js`)
When a user sends a message:
1. The app fetches the **System Prompt** and **Active Model** from Supabase.
2. It appends **System Context** (OS version, shell, current time, dev tools) to the prompt.
3. It sends the request to OpenRouter.
4. If the LLM responds with a `tool_call` (either via JSON in text or native function calling):
   - The **Tool Registry** validates and executes the requested tool.
   - The result is sent back to the LLM.
   - This continues until a final response is generated or a limit (15 iterations) is reached.

### 🛠️ Tool System (`tools/`)
Tools are modular classes extending `BaseTool`. Each tool defines:
- `name`: Unique identifier.
- `parameters`: JSON Schema of required/optional arguments.
- `execute()`: The actual logic (Node.js/Electron code).

The `ToolRegistry` automatically generates documentation for these tools, which is injected into the AI's system prompt so it knows exactly how to use them.

## 🔑 Core Services

### Authentication & Database (Supabase)
- **Auth**: Email/Password and Google OAuth.
- **Profiles**: Stores user token balances and tiers.
- **Transactions**: Tracks every AI interaction and its associated cost.
- **Settings**: Remote control over the active model and system prompt.

### Token Management
- Usage is billed in "tokens" (10,000 tokens = $1 USD).
- The app calculates the real cost of each LLM generation via OpenRouter and deducts it from the user's profile.

### Snipping Tool
A custom transparent overlay (`snipping.html`) allows users to capture screen regions, which are then passed to vision-capable models (like GPT-4o or Claude 3.5) for analysis.

## 🛠️ Development & Environment
- **Node.js**: Backend logic and tool execution.
- **Electron**: Window management and native APIs.
- **Tailwind-like CSS**: The UI uses custom CSS variables and utility classes defined in `theme.css`.
- **Global Shortcuts**:
  - `Ctrl+Shift+C`: Toggle App Visibility
  - `Ctrl+Shift+V`: Open Snipping Tool


