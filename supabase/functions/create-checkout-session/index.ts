// Supabase Edge Function: Create Stripe Checkout Session
// This function creates a checkout session for Pro tier upgrades

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@15.8.0?target=deno'

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders })
    }

    try {
        // Initialize Stripe
        const stripeSecretKey = Deno.env.get('STRIPE_SECRET_KEY')
        if (!stripeSecretKey) {
            throw new Error('STRIPE_SECRET_KEY not configured')
        }
        const stripe = new Stripe(stripeSecretKey, {
            apiVersion: '2024-06-20',
        })

        // Initialize Supabase client with service role for database access
        // Initialize Supabase client
        // Use custom secret names to bypass CLI restrictions on "SUPABASE_" prefix
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!
        const supabaseAnonKey = Deno.env.get('APP_ANON_KEY') || Deno.env.get('SUPABASE_ANON_KEY')!

        const authHeader = req.headers.get('Authorization')
        if (!authHeader) {
            return new Response(
                JSON.stringify({ error: 'Saknar Authorization-header' }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Create a client with the user's focus
        const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
            global: { headers: { Authorization: authHeader } },
        })

        // Verify user token by getting the user object
        const { data: { user }, error: authError } = await supabaseClient.auth.getUser()

        if (authError || !user) {
            console.error('Auth error verifying token:', authError)
            return new Response(
                JSON.stringify({
                    error: `Ogiltig eller utgången token: ${authError?.message || 'Ingen användare hittades'}`,
                    code: 'AUTH_VERIFICATION_FAILED',
                    details: authError,
                    hint: 'Kontrollera att SUPABASE_KEY i config.js är uppdaterad om du nyligen roterat JWT-nycklar.'
                }),
                { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Initialize service role client for database operations that need bypass RLS
        const supabaseServiceKey = Deno.env.get('APP_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        const adminClient = createClient(supabaseUrl, supabaseServiceKey)

        // Check if user is already Pro
        const { data: profile } = await adminClient
            .from('user_profiles')
            .select('tier, stripe_customer_id')
            .eq('id', user.id)
            .single()

        if (profile?.tier === 'pro') {
            return new Response(
                JSON.stringify({ error: 'Du har redan Pro-planen' }),
                { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
            )
        }

        // Get or create Stripe customer
        let customerId = profile?.stripe_customer_id

        if (!customerId) {
            // Search for existing customer by email
            const existingCustomers = await stripe.customers.list({
                email: user.email,
                limit: 1,
            })

            if (existingCustomers.data.length > 0) {
                customerId = existingCustomers.data[0].id
            } else {
                // Create new customer
                const customer = await stripe.customers.create({
                    email: user.email,
                    metadata: {
                        supabase_user_id: user.id,
                    },
                })
                customerId = customer.id
            }

            // Store customer ID in database
            await adminClient
                .from('user_profiles')
                .update({ stripe_customer_id: customerId })
                .eq('id', user.id)
        }

        // Use the direct Price ID for Pro subscription (179 kr/month)
        const priceId = 'price_1SpUWoFTI39zpyFdlnG5q18f'

        // Create subscription directly
        const subscription = await stripe.subscriptions.create({
            customer: customerId,
            items: [{
                price: priceId,
            }],
            payment_behavior: 'default_incomplete',
            payment_settings: {
                save_default_payment_method: 'on_subscription',
                payment_method_types: ['card', 'klarna']
            },
            expand: ['latest_invoice.payment_intent'],
            metadata: {
                supabase_user_id: user.id,
            },
        })

        // Extract client secret from the latest invoice's payment intent
        // Use type assertion to handle the expanded object
        const invoice = subscription.latest_invoice as Stripe.Invoice
        const paymentIntent = invoice.payment_intent as Stripe.PaymentIntent

        return new Response(
            JSON.stringify({
                subscriptionId: subscription.id,
                clientSecret: paymentIntent.client_secret
            }),
            {
                status: 200,
                headers: { ...corsHeaders, 'Content-Type': 'application/json' }
            }
        )

    } catch (error) {
        console.error('Checkout session error:', error)

        // Extract detailed error message
        let errorMessage = 'Internal server error'
        if (error instanceof Error) {
            errorMessage = error.message
            // Log Stripe-specific error details if available
            if ('type' in error) {
                console.error('Stripe error type:', (error as any).type)
            }
            if ('code' in error) {
                console.error('Stripe error code:', (error as any).code)
            }
        }

        return new Response(
            JSON.stringify({ error: errorMessage }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
    }
})
