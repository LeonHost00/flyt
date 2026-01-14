-- User File Storage System
-- Creates storage bucket, tracking table, and RPC functions for tier-based file storage
-- Free tier: 1MB, Pro tier: 20MB

-- ═══════════════════════════════════════════════════════════════════════════
-- STORAGE LIMITS IN SUBSCRIPTION_TIERS
-- Add storage_limit_bytes to the features JSONB column
-- ═══════════════════════════════════════════════════════════════════════════

UPDATE public.subscription_tiers 
SET features = COALESCE(features, '{}'::jsonb) || '{"storage_limit_bytes": 1048576}'::jsonb
WHERE id = 'free';

UPDATE public.subscription_tiers 
SET features = COALESCE(features, '{}'::jsonb) || '{"storage_limit_bytes": 20971520}'::jsonb
WHERE id = 'pro';

-- ═══════════════════════════════════════════════════════════════════════════
-- USER STORAGE USAGE TABLE
-- Tracks how much storage each user has consumed
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.user_storage_usage (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    storage_used_bytes BIGINT NOT NULL DEFAULT 0,
    file_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_storage_usage_user_id ON public.user_storage_usage(user_id);

-- Enable RLS
ALTER TABLE public.user_storage_usage ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own storage usage
CREATE POLICY "Users can view own storage usage"
    ON public.user_storage_usage
    FOR SELECT
    USING (auth.uid() = user_id);

-- Policy: Users can update their own storage usage
CREATE POLICY "Users can update own storage usage"
    ON public.user_storage_usage
    FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Policy: Users can insert their own storage usage
CREATE POLICY "Users can insert own storage usage"
    ON public.user_storage_usage
    FOR INSERT
    WITH CHECK (auth.uid() = user_id);

-- Policy: Service role can do everything
CREATE POLICY "Service role has full access to storage usage"
    ON public.user_storage_usage
    FOR ALL
    USING (auth.role() = 'service_role');

-- Trigger to update updated_at
DROP TRIGGER IF EXISTS update_user_storage_usage_updated_at ON public.user_storage_usage;
CREATE TRIGGER update_user_storage_usage_updated_at
    BEFORE UPDATE ON public.user_storage_usage
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- ═══════════════════════════════════════════════════════════════════════════
-- GET STORAGE INFO RPC FUNCTION
-- Returns user's current storage usage and limits
-- ═══════════════════════════════════════════════════════════════════════════

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
    SELECT COALESCE((features->>'storage_limit_bytes')::BIGINT, 1048576) INTO v_storage_limit
    FROM public.subscription_tiers
    WHERE id = v_tier;
    
    IF v_storage_limit IS NULL THEN
        v_storage_limit := 1048576; -- Default to 1MB
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

-- ═══════════════════════════════════════════════════════════════════════════
-- CHECK STORAGE LIMIT RPC FUNCTION
-- Validates if a file upload is allowed based on tier limits
-- ═══════════════════════════════════════════════════════════════════════════

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
    
    -- Get storage limit from tier
    SELECT COALESCE((features->>'storage_limit_bytes')::BIGINT, 1048576) INTO v_storage_limit
    FROM public.subscription_tiers
    WHERE id = v_tier;
    
    IF v_storage_limit IS NULL THEN
        v_storage_limit := 1048576;
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

-- ═══════════════════════════════════════════════════════════════════════════
-- UPDATE STORAGE USAGE RPC FUNCTION
-- Updates storage usage after upload or delete
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.update_storage_usage(
    p_size_delta BIGINT,
    p_file_delta INTEGER
)
RETURNS JSONB AS $$
DECLARE
    v_user_id UUID;
    v_new_storage BIGINT;
    v_new_count INTEGER;
BEGIN
    v_user_id := auth.uid();
    
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
    END IF;
    
    -- Upsert storage usage
    INSERT INTO public.user_storage_usage (user_id, storage_used_bytes, file_count)
    VALUES (v_user_id, GREATEST(0, p_size_delta), GREATEST(0, p_file_delta))
    ON CONFLICT (user_id) DO UPDATE SET
        storage_used_bytes = GREATEST(0, public.user_storage_usage.storage_used_bytes + p_size_delta),
        file_count = GREATEST(0, public.user_storage_usage.file_count + p_file_delta),
        updated_at = NOW()
    RETURNING storage_used_bytes, file_count INTO v_new_storage, v_new_count;
    
    RETURN jsonb_build_object(
        'success', true,
        'new_storage_bytes', v_new_storage,
        'new_file_count', v_new_count
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ═══════════════════════════════════════════════════════════════════════════
-- STORAGE BUCKET POLICIES (Applied via Supabase Dashboard or SQL)
-- These policies ensure users can only access their own files
-- The bucket must be created named 'user-files' in Supabase Dashboard
-- ═══════════════════════════════════════════════════════════════════════════

-- Note: Storage bucket and policies are typically created via Supabase Dashboard
-- or using the storage-api. The following comments show the expected policies:

-- INSERT policy: Users can upload to their own folder (user_id/filename)
-- ((bucket_id = 'user-files') AND ((auth.uid())::text = (storage.foldername(name))[1]))

-- SELECT policy: Users can read their own files
-- ((bucket_id = 'user-files') AND ((auth.uid())::text = (storage.foldername(name))[1]))

-- UPDATE policy: Users can update their own files
-- ((bucket_id = 'user-files') AND ((auth.uid())::text = (storage.foldername(name))[1]))

-- DELETE policy: Users can delete their own files
-- ((bucket_id = 'user-files') AND ((auth.uid())::text = (storage.foldername(name))[1]))

-- Create storage usage records for existing users
INSERT INTO public.user_storage_usage (user_id, storage_used_bytes, file_count)
SELECT id, 0, 0
FROM auth.users
ON CONFLICT (user_id) DO NOTHING;
