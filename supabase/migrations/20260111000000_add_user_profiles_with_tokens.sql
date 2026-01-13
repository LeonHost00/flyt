-- Create user_profiles table to store token balances and user data
-- Tokens are the internal currency: 10,000 tokens = $1 USD equivalent

CREATE TABLE IF NOT EXISTS public.user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT,
    tokens INTEGER NOT NULL DEFAULT 10000, -- Start with 10,000 tokens ($1 equivalent) for new users
    tokens_used INTEGER NOT NULL DEFAULT 0, -- Track total tokens spent
    tier TEXT NOT NULL DEFAULT 'free', -- Tier for future subscription logic: 'free', 'basic', 'pro', 'enterprise'
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON public.user_profiles(email);
CREATE INDEX IF NOT EXISTS idx_user_profiles_tier ON public.user_profiles(tier);

-- Enable Row Level Security
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only read their own profile
CREATE POLICY "Users can view own profile"
    ON public.user_profiles
    FOR SELECT
    USING (auth.uid() = id);

-- Policy: Users can update their own profile (but not tokens - that's done server-side)
CREATE POLICY "Users can update own profile"
    ON public.user_profiles
    FOR UPDATE
    USING (auth.uid() = id)
    WITH CHECK (auth.uid() = id);

-- Policy: Service role can do everything (for server-side operations)
CREATE POLICY "Service role has full access"
    ON public.user_profiles
    FOR ALL
    USING (auth.role() = 'service_role');

-- Function to automatically create user profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.user_profiles (id, email, tokens)
    VALUES (NEW.id, NEW.email, 10000) -- 10,000 tokens = $1 starting balance
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create profile on new user signup
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW
    EXECUTE FUNCTION public.handle_new_user();

-- Function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for updated_at
DROP TRIGGER IF EXISTS update_user_profiles_updated_at ON public.user_profiles;
CREATE TRIGGER update_user_profiles_updated_at
    BEFORE UPDATE ON public.user_profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at_column();

-- Create a token_transactions table to track usage history
CREATE TABLE IF NOT EXISTS public.token_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    amount INTEGER NOT NULL, -- Negative for usage, positive for additions
    balance_after INTEGER NOT NULL,
    transaction_type TEXT NOT NULL, -- 'usage', 'purchase', 'bonus', 'tier_refill'
    description TEXT,
    model TEXT, -- Which AI model was used (for usage transactions)
    openrouter_cost DECIMAL(10, 6), -- Actual cost from OpenRouter in USD
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_token_transactions_user_id ON public.token_transactions(user_id);
CREATE INDEX IF NOT EXISTS idx_token_transactions_created_at ON public.token_transactions(created_at);

-- Enable RLS on token_transactions
ALTER TABLE public.token_transactions ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only view their own transactions
CREATE POLICY "Users can view own transactions"
    ON public.token_transactions
    FOR SELECT
    USING (auth.uid() = user_id);

-- Policy: Service role can insert transactions
CREATE POLICY "Service role can insert transactions"
    ON public.token_transactions
    FOR INSERT
    WITH CHECK (auth.role() = 'service_role');

-- Create profiles for any existing users
INSERT INTO public.user_profiles (id, email, tokens)
SELECT id, email, 10000
FROM auth.users
ON CONFLICT (id) DO NOTHING;
