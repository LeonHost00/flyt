// Supabase Edge Function: Stripe Webhook Handler
// Handles subscription lifecycle events from Stripe

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe?target=deno'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, stripe-signature',
}

serve(async (req) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        // Initialize Stripe
        const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY')
        const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET')!.trim()

        if (!stripeSecretKey || !webhookSecret) {
            throw new Error('Stripe secrets not configured')
        }

        const stripe = new Stripe(stripeSecretKey, {
            apiVersion: '2025-10-16', // Updated to a more recent supported version
            httpClient: Stripe.createFetchHttpClient(),
        })

        // Initialize Supabase client with service role
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!
        const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        const supabaseClient = createClient(supabaseUrl, supabaseServiceKey)

        // Verify webhook signature
        const signature = req.headers.get('stripe-signature')
        if (!signature) {
            return new Response(
                JSON.stringify({ error: 'Missing stripe-signature header' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        const body = await req.text()
        let event: Stripe.Event

        try {
            event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret)
        } catch (err) {
            console.error('Webhook signature verification failed:', err.message)
            return new Response(
                JSON.stringify({ error: `Invalid signature: ${err.message}` }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        console.log(`Processing webhook event: ${event.type}`)

        // Handle different event types
        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object as Stripe.Checkout.Session
                await handleCheckoutCompleted(supabaseClient, stripe, session)
                break
            }

            case 'customer.subscription.created':
            case 'customer.subscription.updated': {
                const subscription = event.data.object as Stripe.Subscription
                await handleSubscriptionUpdate(supabaseClient, subscription)
                break
            }

            case 'customer.subscription.deleted': {
                const subscription = event.data.object as Stripe.Subscription
                await handleSubscriptionDeleted(supabaseClient, subscription)
                break
            }

            default:
                console.log(`Unhandled event type: ${event.type}`)
        }

        return new Response(
            JSON.stringify({ received: true }),
            { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )

    } catch (error) {
        console.error('Webhook error:', error)
        return new Response(
            JSON.stringify({ error: error.message || 'Internal server error' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})

// Handle successful checkout completion
async function handleCheckoutCompleted(
    supabase: any,
    stripe: Stripe,
    session: Stripe.Checkout.Session
) {
    const userId = session.metadata?.supabase_user_id
    const customerId = session.customer as string
    const subscriptionId = session.subscription as string

    if (!userId) {
        // Try to find user by customer email
        const customer = await stripe.customers.retrieve(customerId)
        if (customer.deleted) {
            console.error('Customer was deleted')
            return
        }

        const { data: profile } = await supabase
            .from('user_profiles')
            .select('id')
            .eq('stripe_customer_id', customerId)
            .single()

        if (!profile) {
            console.error('Could not find user for customer:', customerId)
            return
        }

        await upgradeUserToPro(supabase, profile.id, customerId, subscriptionId)
    } else {
        await upgradeUserToPro(supabase, userId, customerId, subscriptionId)
    }
}

// Handle subscription updates
async function handleSubscriptionUpdate(
    supabase: any,
    subscription: Stripe.Subscription
) {
    const customerId = subscription.customer as string
    const subscriptionId = subscription.id
    const status = subscription.status

    // Find user by customer ID
    const { data: profile } = await supabase
        .from('user_profiles')
        .select('id, tier')
        .eq('stripe_customer_id', customerId)
        .single()

    if (!profile) {
        console.error('Could not find user for customer:', customerId)
        return
    }

    // Update subscription status
    const updates: Record<string, any> = {
        stripe_subscription_id: subscriptionId,
        subscription_status: status,
        updated_at: new Date().toISOString(),
    }

    // If subscription is active, ensure user is Pro
    if (status === 'active' && profile.tier !== 'pro') {
        updates.tier = 'pro'

        // Add bonus tokens for upgrading
        const { data: tierInfo } = await supabase
            .from('subscription_tiers')
            .select('monthly_tokens')
            .eq('id', 'pro')
            .single()

        const { data: currentProfile } = await supabase
            .from('user_profiles')
            .select('tokens')
            .eq('id', profile.id)
            .single()

        if (tierInfo && currentProfile) {
            // Add the difference between Pro and Free monthly tokens
            const tokenBonus = tierInfo.monthly_tokens - 10000 // 200000 - 10000 = 190000
            updates.tokens = currentProfile.tokens + tokenBonus

            // Log the transaction
            await supabase
                .from('token_transactions')
                .insert({
                    user_id: profile.id,
                    amount: tokenBonus,
                    balance_after: updates.tokens,
                    transaction_type: 'tier_refill',
                    description: 'Uppgraderad till Pro via Stripe',
                })
        }
    }

    await supabase
        .from('user_profiles')
        .update(updates)
        .eq('id', profile.id)

    console.log(`Updated user ${profile.id} subscription status to ${status}`)
}

// Handle subscription cancellation
async function handleSubscriptionDeleted(
    supabase: any,
    subscription: Stripe.Subscription
) {
    const customerId = subscription.customer as string

    // Find user by customer ID
    const { data: profile } = await supabase
        .from('user_profiles')
        .select('id, tokens')
        .eq('stripe_customer_id', customerId)
        .single()

    if (!profile) {
        console.error('Could not find user for customer:', customerId)
        return
    }

    // Downgrade to free tier
    const freeTokenLimit = 10000
    const newTokens = Math.min(profile.tokens, freeTokenLimit)

    await supabase
        .from('user_profiles')
        .update({
            tier: 'free',
            tokens: newTokens,
            stripe_subscription_id: null,
            subscription_status: 'canceled',
            updated_at: new Date().toISOString(),
        })
        .eq('id', profile.id)

    // Log the transaction
    await supabase
        .from('token_transactions')
        .insert({
            user_id: profile.id,
            amount: newTokens - profile.tokens,
            balance_after: newTokens,
            transaction_type: 'tier_refill',
            description: 'Prenumeration avslutad - nedgraderad till Free',
        })

    console.log(`Downgraded user ${profile.id} to free tier`)
}

// Helper to upgrade user to Pro
async function upgradeUserToPro(
    supabase: any,
    userId: string,
    customerId: string,
    subscriptionId: string
) {
    // Get current tokens and tier info
    const { data: profile } = await supabase
        .from('user_profiles')
        .select('tokens, tier')
        .eq('id', userId)
        .single()

    const { data: tierInfo } = await supabase
        .from('subscription_tiers')
        .select('monthly_tokens')
        .eq('id', 'pro')
        .single()

    const tokenBonus = tierInfo?.monthly_tokens - 10000 || 190000
    const newTokens = (profile?.tokens || 0) + tokenBonus

    // Update user profile
    await supabase
        .from('user_profiles')
        .update({
            tier: 'pro',
            tokens: newTokens,
            stripe_customer_id: customerId,
            stripe_subscription_id: subscriptionId,
            subscription_status: 'active',
            updated_at: new Date().toISOString(),
        })
        .eq('id', userId)

    // Log the transaction
    await supabase
        .from('token_transactions')
        .insert({
            user_id: userId,
            amount: tokenBonus,
            balance_after: newTokens,
            transaction_type: 'tier_refill',
            description: 'Uppgraderad till Pro via Stripe',
        })

    console.log(`Upgraded user ${userId} to Pro tier with ${tokenBonus} bonus tokens`)
}
