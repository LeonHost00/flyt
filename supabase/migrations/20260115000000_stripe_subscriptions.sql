-- Add Stripe subscription tracking columns to user_profiles
-- This migration adds fields to track Stripe customer and subscription IDs

-- Add Stripe-related columns to user_profiles
ALTER TABLE public.user_profiles
ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT,
ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'none';

-- Create index for faster lookups by Stripe customer ID
CREATE INDEX IF NOT EXISTS idx_user_profiles_stripe_customer_id 
ON public.user_profiles(stripe_customer_id) 
WHERE stripe_customer_id IS NOT NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.user_profiles.stripe_customer_id IS 'Stripe customer ID for payment processing';
COMMENT ON COLUMN public.user_profiles.stripe_subscription_id IS 'Active Stripe subscription ID';
COMMENT ON COLUMN public.user_profiles.subscription_status IS 'Stripe subscription status: none, active, canceled, past_due, etc.';
