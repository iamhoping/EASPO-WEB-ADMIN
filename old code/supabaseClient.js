// /js/supabaseClient.js

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm'

export const supabase = createClient(
  "https://sbizrtjugvtcajdkkiak.supabase.co",
  "sb_publishable_c9uXXvtiT1W0hLdnzwltXg_qpadPcmb"
)