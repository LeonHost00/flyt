-- Fix storage limits in subscription_tiers
-- Previous updates via broken migration might have failed or set incorrect values.
-- This migration explicitly sets the features JSONB.

-- Fix Free Tier (1MB)
UPDATE public.subscription_tiers 
SET features = '{"storage_limit_bytes": 1048576}'::jsonb
WHERE id = 'free';

-- Fix Pro Tier (20MB)
UPDATE public.subscription_tiers 
SET features = '{"storage_limit_bytes": 20971520}'::jsonb
WHERE id = 'pro';

-- Also ensure the get_storage_info RPC handles missing values gracefully
-- by recreating it with explicit fallbacks

CREATE OR REPLACE FUNCTION public.get_storage_info()
RETURNS JSONB AS $$
DECLARE
    v_user_id UUID;
    v_tier TEXT;
    v_storage_used BIGINT;
    v_file_count INTEGER;
    v_storage_limit BIGINT;
BEGIN
    v_user_id := auth.uid();
    
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
    END IF;
    
    -- Get user tier
    SELECT tier INTO v_tier
    FROM public.user_profiles
    WHERE id = v_user_id;
    
    IF v_tier IS NULL THEN
        v_tier := 'free';
    END IF;
    
    -- Get storage limit from tier
    -- Explicitly check for pro/free ID to have hardcoded fallbacks if DB is empty/null
    SELECT COALESCE((features->>'storage_limit_bytes')::BIGINT, 
        CASE 
            WHEN v_tier = 'pro' THEN 20971520 
            ELSE 1048576 
        END
    ) INTO v_storage_limit
    FROM public.subscription_tiers
    WHERE id = v_tier;
    
    -- Final fallback
    IF v_storage_limit IS NULL THEN
        IF v_tier = 'pro' THEN
            v_storage_limit := 20971520;
        ELSE
            v_storage_limit := 1048576;
        END IF;
    END IF;
    
    -- Get current usage, create record if doesn't exist
    SELECT storage_used_bytes, file_count INTO v_storage_used, v_file_count
    FROM public.user_storage_usage
    WHERE user_id = v_user_id;
    
    IF v_storage_used IS NULL THEN
        -- Create initial record
        INSERT INTO public.user_storage_usage (user_id, storage_used_bytes, file_count)
        VALUES (v_user_id, 0, 0)
        ON CONFLICT (user_id) DO NOTHING;
        v_storage_used := 0;
        v_file_count := 0;
    END IF;
    
    RETURN jsonb_build_object(
        'success', true,
        'storage_used_bytes', v_storage_used,
        'storage_limit_bytes', v_storage_limit,
        'file_count', v_file_count,
        'tier', v_tier
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update check_storage_limit as well to match
CREATE OR REPLACE FUNCTION public.check_storage_limit(p_file_size BIGINT)
RETURNS JSONB AS $$
DECLARE
    v_user_id UUID;
    v_tier TEXT;
    v_storage_used BIGINT;
    v_storage_limit BIGINT;
    v_new_total BIGINT;
BEGIN
    v_user_id := auth.uid();
    
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'allowed', false, 'error', 'Not authenticated');
    END IF;
    
    IF p_file_size <= 0 THEN
        RETURN jsonb_build_object('success', false, 'allowed', false, 'error', 'Invalid file size');
    END IF;
    
    -- Get user tier
    SELECT tier INTO v_tier
    FROM public.user_profiles
    WHERE id = v_user_id;
    
    IF v_tier IS NULL THEN
        v_tier := 'free';
    END IF;
    
    -- Get storage limit from tier with fallbacks
    SELECT COALESCE((features->>'storage_limit_bytes')::BIGINT, 
        CASE 
            WHEN v_tier = 'pro' THEN 20971520 
            ELSE 1048576 
        END
    ) INTO v_storage_limit
    FROM public.subscription_tiers
    WHERE id = v_tier;
    
    IF v_storage_limit IS NULL THEN
        IF v_tier = 'pro' THEN
            v_storage_limit := 20971520;
        ELSE
            v_storage_limit := 1048576;
        END IF;
    END IF;
    
    -- Get current usage
    SELECT COALESCE(storage_used_bytes, 0) INTO v_storage_used
    FROM public.user_storage_usage
    WHERE user_id = v_user_id;
    
    IF v_storage_used IS NULL THEN
        v_storage_used := 0;
    END IF;
    
    v_new_total := v_storage_used + p_file_size;
    
    IF v_new_total > v_storage_limit THEN
        RETURN jsonb_build_object(
            'success', true,
            'allowed', false,
            'current_usage', v_storage_used,
            'limit', v_storage_limit,
            'file_size', p_file_size,
            'would_exceed_by', v_new_total - v_storage_limit
        );
    END IF;
    
    RETURN jsonb_build_object(
        'success', true,
        'allowed', true,
        'current_usage', v_storage_used,
        'limit', v_storage_limit,
        'remaining_after', v_storage_limit - v_new_total
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
