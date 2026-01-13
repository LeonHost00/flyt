-- Create app_settings table for server-controlled configuration
-- This allows you to control which model users use without app updates

CREATE TABLE IF NOT EXISTS public.app_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    key TEXT UNIQUE NOT NULL,
    value JSONB NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

-- Policy: Everyone can read settings (needed for app to fetch model config)
CREATE POLICY "Anyone can view app settings"
    ON public.app_settings
    FOR SELECT
    USING (true);

-- Policy: Only admins/service role can modify settings
CREATE POLICY "Service role can manage settings"
    ON public.app_settings
    FOR ALL
    USING (auth.role() = 'service_role');

-- Trigger for updated_at
DROP TRIGGER IF EXISTS update_app_settings_updated_at ON public.app_settings;
CREATE TRIGGER update_app_settings_updated_at
    BEFORE UPDATE ON public.app_settings
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- Insert default model configuration
-- The 'active_model' setting controls which model all users use
-- You can update this from Supabase dashboard to change the model for everyone
INSERT INTO public.app_settings (key, value, description) VALUES 
(
    'active_model',
    '{
        "model_id": "google/gemini-2.5-flash",
        "model_name": "Gemini 2.5 Flash",
        "fallback_model_id": "openai/gpt-4o-mini"
    }'::jsonb,
    'The active AI model for all users. Change model_id to switch models. Fallback is used if primary fails.'
),
(
    'available_models',
    '[
        {"id": "google/gemini-2.5-flash", "name": "Gemini 2.5 Flash (Snabb, Vision ✓)", "vision": true},
        {"id": "z-ai/glm-4.7", "name": "GLM-4.7 (Vision ✓)", "vision": true},
        {"id": "openai/gpt-4o-mini", "name": "GPT-4o Mini (Snabb, Vision ✓)", "vision": true},
        {"id": "openai/gpt-4o", "name": "GPT-4o (Vision ✓)", "vision": true},
        {"id": "anthropic/claude-3.5-sonnet", "name": "Claude 3.5 Sonnet (Vision ✓)", "vision": true},
        {"id": "anthropic/claude-3-haiku", "name": "Claude 3 Haiku (Snabb, Vision ✓)", "vision": true}
    ]'::jsonb,
    'List of all available models for reference. Update active_model.model_id to one of these.'
),
(
    'model_selection_mode',
    '{
        "mode": "global",
        "description": "global = same model for all users, tier_based = model based on user tier, random = randomly select from pool"
    }'::jsonb,
    'How the model is selected. Currently only global is implemented.'
)
ON CONFLICT (key) DO NOTHING;

-- Create an index for fast key lookups
CREATE INDEX IF NOT EXISTS idx_app_settings_key ON public.app_settings(key);

-- Optional: Create a function to get active model easily
CREATE OR REPLACE FUNCTION public.get_active_model()
RETURNS JSONB AS $$
DECLARE
    model_config JSONB;
BEGIN
    SELECT value INTO model_config
    FROM public.app_settings
    WHERE key = 'active_model';
    
    RETURN model_config;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
