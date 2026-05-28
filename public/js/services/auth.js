// /js/services/auth.js
import { supabase } from './supabaseClient.js'

export async function login(email, password) {
  return await supabase.auth.signInWithPassword({ email, password })
}

export async function logout() {
  await supabase.auth.signOut()
  window.location.href = 'index.html'
}

export async function getCurrentUser() {
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

export async function getUserProfile(userId) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single()
  return { data, error }
}