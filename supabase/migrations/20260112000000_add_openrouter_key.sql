-- Add OpenRouter API key to app_settings for secure storage
-- This allows changing the API key without app updates

INSERT INTO public.app_settings (key, value, description) VALUES 
(
    'openrouter_api_key',
    '{"key": "edited"}'::jsonb,
    'OpenRouter API key for LLM requests. Update this value to change the key for all users.'
)
ON CONFLICT (key) DO UPDATE SET
    value = EXCLUDED.value,
    description = EXCLUDED.description,
    updated_at = NOW();
