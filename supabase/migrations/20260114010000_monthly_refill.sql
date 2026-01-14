-- Monthly Token Refill System
-- This migration adds automated monthly token refills using pg_cron

-- 1. Add last_refill_at to user_profiles to track when a user's tokens were last resetted
ALTER TABLE public.user_profiles 
ADD COLUMN IF NOT EXISTS last_refill_at TIMESTAMPTZ DEFAULT NOW();

-- 2. Create the refill function
CREATE OR REPLACE FUNCTION public.refill_all_users_tokens()
RETURNS JSONB AS $$
DECLARE
    v_user RECORD;
    v_tier_info RECORD;
    v_refilled_count INTEGER := 0;
BEGIN
    -- Iterate through all users who have a tier defined
    FOR v_user IN SELECT id, tier, tokens FROM public.user_profiles LOOP
        
        -- Get the token limit for this user's tier
        SELECT monthly_tokens INTO v_tier_info
        FROM public.subscription_tiers
        WHERE id = v_user.tier;
        
        -- If tier not found (shouldn't happen with RLS/FK but being safe), default to 10000
        IF v_tier_info.monthly_tokens IS NULL THEN
            v_tier_info.monthly_tokens := 10000;
        END IF;
        
        -- Only refill if the user has fewer tokens than their monthly limit
        -- (This is the 'reset' logic: you get back to your limit each month)
        IF v_user.tokens < v_tier_info.monthly_tokens THEN
            
            -- Update user tokens and last_refill_at
            UPDATE public.user_profiles
            SET tokens = v_tier_info.monthly_tokens,
                last_refill_at = NOW(),
                updated_at = NOW()
            WHERE id = v_user.id;
            
            -- Log the transaction
            INSERT INTO public.token_transactions (
                user_id,
                amount,
                balance_after,
                transaction_type,
                description
            ) VALUES (
                v_user.id,
                v_tier_info.monthly_tokens - v_user.tokens,
                v_tier_info.monthly_tokens,
                'tier_refill',
                'Månadsvis automatisk påfyllning (' || v_user.tier || ')'
            );
            
            v_refilled_count := v_refilled_count + 1;
        END IF;
        
    END LOOP;
    
    RETURN jsonb_build_object(
        'success', true,
        'users_refilled', v_refilled_count,
        'timestamp', NOW()
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Enable pg_cron and schedule the job
-- Note: pg_cron requires being enabled in the Supabase dashboard (Database -> Extensions)
-- but we can attempt to create the job here. It will run in the 'cron' schema.

-- Create the extension if it doesn't exist (requires superuser, usually enabled in dashboard)
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule the job: At 00:00 on the 1st of every month
-- We use 'select public.refill_all_users_tokens()' as the command
-- The job name is 'monthly-token-refill'
SELECT cron.schedule(
    'monthly-token-refill',
    '0 0 1 * *',
    'SELECT public.refill_all_users_tokens()'
);

-- Note for future: You can check job status with:
-- SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
