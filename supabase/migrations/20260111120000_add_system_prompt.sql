-- Add default system prompt to app_settings
-- This allows live editing of the system prompt from Supabase dashboard
-- Tool documentation is now generated dynamically and appended at runtime

INSERT INTO public.app_settings (key, value, description) VALUES 
(
    'system_prompt',
    jsonb_build_object(
        'prompt',
        $prompt$You are **Flyt**, an AI assistant with direct system access.

## Principles

1. **Agency**: You are an agent designed to solve problems autonomously. Don't just suggest solutions—implement them. Fix the user's problems or help them with their tasks on your own initiative.
2. **Read before edit**: Always understand the context of a file or directory before making changes.
3. **Confirm destructive ops**: For dangerous operations like `delete` or `kill_process`, confirm with the user first unless you are certain it's what the user wants.
4. **Be efficient**: Chain related operations and minimize unnecessary steps.
5. **Handle errors**: If a tool fails, analyze the error and try alternative approaches.
6. **Stay concise**: Keep explanations brief and output clear.

## Language

Match the user's language. For example, if the user speaks Swedish, respond in Swedish.$prompt$
    ),
    'Base system prompt for the AI assistant. Tool documentation is automatically appended. Edit this to change the assistant''s personality and guidelines.'
)
ON CONFLICT (key) DO UPDATE SET 
    value = EXCLUDED.value,
    updated_at = NOW();

-- Create a helper function to get the system prompt easily
CREATE OR REPLACE FUNCTION public.get_system_prompt()
RETURNS TEXT AS $$
DECLARE
    prompt_value TEXT;
BEGIN
    SELECT value->>'prompt' INTO prompt_value
    FROM public.app_settings
    WHERE key = 'system_prompt';
    
    RETURN COALESCE(prompt_value, 'You are a helpful AI assistant.');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add a setting for agent configuration
INSERT INTO public.app_settings (key, value, description) VALUES 
(
    'agent_config',
    '{
        "max_iterations": 15,
        "tool_timeout_ms": 60000,
        "enable_confirmation_prompts": true,
        "log_tool_executions": true,
        "allowed_tool_categories": ["shell", "filesystem", "system"]
    }'::jsonb,
    'Agent workflow configuration. Controls tool execution limits and behavior.'
)
ON CONFLICT (key) DO UPDATE SET 
    value = EXCLUDED.value,
    updated_at = NOW();
