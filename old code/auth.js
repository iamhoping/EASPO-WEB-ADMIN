// /js/auth.js

import { supabase } from './supabaseClient.js'

/**
 * 🔐 Login with email and password
 * Authenticates user against Supabase Auth
 * @param {string} email - User email
 * @param {string} password - User password
 * @returns {Promise} Auth response with user data or error
 */
export async function login(email, password) {
  return await supabase.auth.signInWithPassword({ email, password })
}

/**
 * 🚪 Logout user
 * Signs out current user and redirects to login page
 * @returns {Promise} Void
 */
export async function logout() {
  await supabase.auth.signOut()
  window.location.href = "index.html"
}