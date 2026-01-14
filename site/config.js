// Supabase Configuration
const SUPABASE_URL = 'https://cddircpnawvpryttmpel.supabase.co';
const SUPABASE_KEY = 'sb_publishable_lDoWq98zufz9gRxUCSl-3A_NXIWcpyJ';

// Export config and create shared client instance
if (typeof window !== 'undefined') {
    window.SUPABASE_CONFIG = {
        url: SUPABASE_URL,
        key: SUPABASE_KEY,
        stripePublishableKey: 'pk_test_51SpUN3FTI39zpyFdslphLitgiF5tUInke1ZEFX6AmGJY7BooDF4UDZ0dgWckAfITZcXz37tZyawWgrkQxothIOQO00rhzuA3kA'
    };

    // Create shared Supabase client (requires supabase-js to be loaded first)
    // This will be initialized after the Supabase library loads
    window.initSupabaseClient = function () {
        if (typeof supabase !== 'undefined' && !window.SUPABASE_CLIENT) {
            window.SUPABASE_CLIENT = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
        }
        return window.SUPABASE_CLIENT;
    };
}
