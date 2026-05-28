// /js/services/supabaseClient.js
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

const SUPABASE_URL = 'https://sbizrtjugvtcajdkkiak.supabase.co'
const SUPABASE_KEY = 'sb_publishable_c9uXXvtiT1W0hLdnzwltXg_qpadPcmb'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)