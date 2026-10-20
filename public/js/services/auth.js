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

export async function createAccount(role, profile) {
  const { data, error } = await supabase.functions.invoke('create-school-account', {
    body: { role, profile },
  })
  if (error) {
    const response = error.context
    if (response && typeof response.clone === 'function') {
      let body = null
      try {
        body = await response.clone().json()
      } catch {
        body = null
      }
      if (typeof body?.error === 'string' && body.error.trim()) {
        throw new Error(body.error)
      }
    }
    throw error
  }
  if (!data?.userId) throw new Error('The account was created without a user ID.')
  return data.userId
}

export async function setAccountStatus(userId, role, status) {
  if (!['STUDENT', 'TEACHER', 'PARENT'].includes(role) || !['active', 'inactive'].includes(status)) {
    throw new Error('Invalid account status change.')
  }
  const { error } = await supabase.functions.invoke('set-school-account-status', {
    body: { userId, role, status },
  })
  if (error) throw error
}