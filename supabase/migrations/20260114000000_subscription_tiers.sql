-- Subscription Tiers and Token Management Functions
-- This migration adds flexible tier configuration and secure RPC functions
-- for token management and tier changes.

-- ═══════════════════════════════════════════════════════════════════════════
-- SUBSCRIPTION TIERS TABLE
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.subscription_tiers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    monthly_tokens INTEGER NOT NULL,
    price_monthly DECIMAL(10, 2) DEFAULT 0, -- For future payment integration
    features JSONB DEFAULT '[]'::jsonb,     -- For future feature flags
    is_active BOOLEAN DEFAULT true,
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.subscription_tiers ENABLE ROW LEVEL SECURITY;

-- Everyone can view tiers (needed for displaying options)
CREATE POLICY "Anyone can view subscription tiers"
    ON public.subscription_tiers
    FOR SELECT
    USING (true);

-- Only service role can manage tiers
CREATE POLICY "Service role can manage tiers"
    ON public.subscription_tiers
    FOR ALL
    USING (auth.role() = 'service_role');

-- Insert default tiers
INSERT INTO public.subscription_tiers (id, name, monthly_tokens, price_monthly, sort_order) VALUES
    ('free', 'Free', 10000, 0, 1),
    ('pro', 'Pro', 200000, 0, 2)  -- Price 0 for now, will be updated when payments are added
ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    monthly_tokens = EXCLUDED.monthly_tokens,
    updated_at = NOW();

-- ═══════════════════════════════════════════════════════════════════════════
-- ADD TOKENS RPC FUNCTION
-- Securely adds tokens to a user's balance
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.add_tokens(
    p_amount INTEGER,
    p_description TEXT DEFAULT 'Token addition'
)
RETURNS JSONB AS $$
DECLARE
    v_user_id UUID;
    v_current_tokens INTEGER;
    v_new_balance INTEGER;
BEGIN
    -- Get the current user's ID
    v_user_id := auth.uid();
    
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
    END IF;
    
    IF p_amount <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Amount must be positive');
    END IF;
    
    -- Get current token balance
    SELECT tokens INTO v_current_tokens
    FROM public.user_profiles
    WHERE id = v_user_id;
    
    IF v_current_tokens IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'User profile not found');
    END IF;
    
    -- Calculate new balance
    v_new_balance := v_current_tokens + p_amount;
    
    -- Update user's token balance
    UPDATE public.user_profiles
    SET tokens = v_new_balance,
        updated_at = NOW()
    WHERE id = v_user_id;
    
    -- Log the transaction
    INSERT INTO public.token_transactions (
        user_id,
        amount,
        balance_after,
        transaction_type,
        description
    ) VALUES (
        v_user_id,
        p_amount,
        v_new_balance,
        'bonus',
        p_description
    );
    
    RETURN jsonb_build_object(
        'success', true,
        'new_balance', v_new_balance,
        'amount_added', p_amount
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ═══════════════════════════════════════════════════════════════════════════
-- CHANGE USER TIER RPC FUNCTION
-- Changes a user's subscription tier and adjusts tokens accordingly
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.change_user_tier(
    p_new_tier TEXT
)
RETURNS JSONB AS $$
DECLARE
    v_user_id UUID;
    v_current_tier TEXT;
    v_current_tokens INTEGER;
    v_new_tier_tokens INTEGER;
    v_old_tier_tokens INTEGER;
    v_token_adjustment INTEGER;
    v_new_balance INTEGER;
    v_tier_exists BOOLEAN;
BEGIN
    -- Get the current user's ID
    v_user_id := auth.uid();
    
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
    END IF;
    
    -- Check if the new tier exists
    SELECT EXISTS(
        SELECT 1 FROM public.subscription_tiers WHERE id = p_new_tier AND is_active = true
    ) INTO v_tier_exists;
    
    IF NOT v_tier_exists THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid tier');
    END IF;
    
    -- Get current user profile
    SELECT tier, tokens INTO v_current_tier, v_current_tokens
    FROM public.user_profiles
    WHERE id = v_user_id;
    
    IF v_current_tier IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'User profile not found');
    END IF;
    
    -- Check if already on this tier
    IF v_current_tier = p_new_tier THEN
        RETURN jsonb_build_object('success', false, 'error', 'Already on this tier');
    END IF;
    
    -- Get tier token allocations
    SELECT monthly_tokens INTO v_new_tier_tokens
    FROM public.subscription_tiers WHERE id = p_new_tier;
    
    SELECT monthly_tokens INTO v_old_tier_tokens
    FROM public.subscription_tiers WHERE id = v_current_tier;
    
    -- If old tier doesn't exist in table, default to 10000 (free)
    IF v_old_tier_tokens IS NULL THEN
        v_old_tier_tokens := 10000;
    END IF;
    
    -- Calculate token adjustment (difference in monthly allocation)
    -- On upgrade: add the difference
    -- On downgrade: we don't remove tokens, just change the tier
    IF v_new_tier_tokens > v_old_tier_tokens THEN
        v_token_adjustment := v_new_tier_tokens - v_old_tier_tokens;
        v_new_balance := v_current_tokens + v_token_adjustment;
    ELSE
        -- Downgrade: cap tokens at new tier's monthly limit if over
        v_token_adjustment := 0;
        v_new_balance := LEAST(v_current_tokens, v_new_tier_tokens);
    END IF;
    
    -- Update user's tier and tokens
    UPDATE public.user_profiles
    SET tier = p_new_tier,
        tokens = v_new_balance,
        updated_at = NOW()
    WHERE id = v_user_id;
    
    -- Log the transaction
    INSERT INTO public.token_transactions (
        user_id,
        amount,
        balance_after,
        transaction_type,
        description
    ) VALUES (
        v_user_id,
        v_token_adjustment,
        v_new_balance,
        'tier_refill',
        'Tier change: ' || v_current_tier || ' → ' || p_new_tier
    );
    
    RETURN jsonb_build_object(
        'success', true,
        'old_tier', v_current_tier,
        'new_tier', p_new_tier,
        'new_balance', v_new_balance,
        'token_adjustment', v_token_adjustment
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ═══════════════════════════════════════════════════════════════════════════
-- GET USER SUBSCRIPTION INFO FUNCTION
-- Returns user's current tier info including monthly allocation
-- ═══════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_subscription_info()
RETURNS JSONB AS $$
DECLARE
    v_user_id UUID;
    v_user_tier TEXT;
    v_user_tokens INTEGER;
    v_tier_info RECORD;
BEGIN
    v_user_id := auth.uid();
    
    IF v_user_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
    END IF;
    
    -- Get user's current tier and tokens
    SELECT tier, tokens INTO v_user_tier, v_user_tokens
    FROM public.user_profiles
    WHERE id = v_user_id;
    
    -- Get tier info
    SELECT * INTO v_tier_info
    FROM public.subscription_tiers
    WHERE id = v_user_tier;
    
    RETURN jsonb_build_object(
        'success', true,
        'tier', v_user_tier,
        'tier_name', COALESCE(v_tier_info.name, 'Free'),
        'tokens', v_user_tokens,
        'monthly_tokens', COALESCE(v_tier_info.monthly_tokens, 10000)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
