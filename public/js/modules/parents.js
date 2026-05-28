// /js/modules/parents.js
import { supabase } from '../services/supabaseClient.js'
import { showToast } from '../ui/toast.js'
import { renderPagination } from '../ui/pagination.js';

let allParents  = []
let allStudents = []   // for dropdowns
let filtered    = []
let currentPage = 1
const PER_PAGE  = 10

const AV_COLORS = ['av-blue','av-green','av-yellow','av-purple','av-red','av-orange']
const initials  = n => (n||'').split(' ').map(w=>w[0]||'').join('').slice(0,2).toUpperCase()||'??'
const avColor   = n => { let s=0;for(const c of(n||''))s+=c.charCodeAt(0);return AV_COLORS[s%AV_COLORS.length] }
const val       = id => (document.getElementById(id)?.value||'').trim()
const openM     = id => document.getElementById(id)?.classList.remove('hidden')
const closeM    = id => document.getElementById(id)?.classList.add('hidden')

const RELATION_PILL = {
  'Father'      : 'pill-blue',
  'Mother'      : 'pill-purple',
  'Guardian'    : 'pill-yellow',
  'Grandparent' : 'pill-green',
  'Sibling'     : 'pill-orange',
  'Other'       : 'pill-grey',
}

// ── Fetch students list (for dropdowns) ───────────────────────
async function fetchParents() {
  const { data } = await supabase
    .from('profiles')
    .select('id,name,student_id,grade_level')
    .eq('role','STUDENT')
    .order('name',{ascending:true})
  allStudents = data || []
}

// ── Populate student dropdowns ────────────────────────────────
function populateStudentDropdowns() {
  const opts = `<option value="">None / Unlinked</option>` +
    allStudents.map(s=>`<option value="${s.id}">${s.name} (${s.student_id||'—'})</option>`).join('')
  ;['parentLinkedStudent','editParentLinkedStudent','gradeStudent'].forEach(id=>{
    const el = document.getElementById(id)
    if(el) el.innerHTML = opts
  })
}

// ── Load ──────────────────────────────────────────────────────
export async function loadParents() {
  const tbody = document.getElementById('parentsTableBody')
  if (tbody) tbody.innerHTML = `<tr><td colspan="8"><div class="loader">...</div></td></tr>`

  // Fix: Changed fetchStudents() to fetchParents() to match your definition
  await fetchParents() 
  populateStudentDropdowns()

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('role', 'PARENT') // This matches the role we set in submitAddParent
    .order('name', { ascending: true })

  if (error) {
    console.error('Fetch error:', error.message)
    allParents = []
  } else {
    allParents = data || []
  }
  
  applyFilters()
}

// ── Filter ────────────────────────────────────────────────────
export function applyFilters() {
  const q  = val('parentSearch').toLowerCase()
  const rl = document.getElementById('relationFilter')?.value || ''
  filtered = allParents.filter(p =>
    (!q  || (p.name||'').toLowerCase().includes(q)||(p.parent_id||'').toLowerCase().includes(q)||(p.email||'').toLowerCase().includes(q)) &&
    (!rl || p.relation===rl)
  )
  currentPage = 1
  render()
}

// ── Render ────────────────────────────────────────────────────
function render() {
  const tbody   = document.getElementById('parentsTableBody')
  const countEl = document.getElementById('parentsCount')
  const total   = filtered.length
  if (!tbody) return

  if (!total) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">👨‍👩‍👧</div><div class="empty-title">No parents found</div><div class="empty-sub">Add a parent or guardian to get started.</div></div></td></tr>`
    if(countEl) countEl.textContent = '0 parents'
    document.getElementById('parentsPagination').innerHTML = ''
    return
  }

  const start = (currentPage-1)*PER_PAGE
  const slice = filtered.slice(start, start+PER_PAGE)
  const pages = Math.ceil(total/PER_PAGE)

  tbody.innerHTML = slice.map(p => {
    const rel      = p.relation || 'Other'
    const pillCls  = RELATION_PILL[rel] || 'pill-grey'
    const student  = allStudents.find(s=>s.id===p.linked_student_id)
    const studentDisplay = student
      ? `<div class="ent-row"><div class="av av-blue" style="width:26px;height:26px;font-size:.65rem">${initials(student.name)}</div><div><div style="font-size:.82rem;font-weight:600;color:var(--text)">${student.name}</div><div style="font-size:.72rem;color:var(--text3)">${student.grade_level||''}</div></div></div>`
      : '<span style="color:var(--text3)">—</span>'

    return `
    <tr>
      <td class="cb-cell"><input type="checkbox"/></td>
      <td><div class="ent-row">
        <div class="av ${avColor(p.name)}">${initials(p.name)}</div>
        <div><div class="ent-name">${p.name||'—'}</div>
      </div></td>
      <td><code style="font-size:.78rem;color:var(--text3)">${p.address||'—'}</code></td>
      <td><span class="pill ${pillCls}">${rel}</span></td>
      <td>${p.contact||'—'}</td>
      <td>${studentDisplay}</td>
      <td style="font-size:.82rem">${p.email||'—'}</td>
      <td><div class="row-acts">
        <button class="act-btn" title="Edit"   onclick="openEditParentModal('${p.id}')">✏️</button>
        <button class="act-btn danger" title="Delete" onclick="confirmDeleteParent('${p.id}','${(p.name||'').replace(/'/g,"\\'")}')">🗑</button>
      </div></td>
    </tr>`
  }).join('')

  if(countEl) countEl.textContent = `Showing ${start+1}–${Math.min(start+PER_PAGE,total)} of ${total} parents`
  renderPages('parentsPagination', currentPage, pages, p => { currentPage=p; render() })
}

// ── ID gen ────────────────────────────────────────────────────
export function generateParentId() {
  const el = document.getElementById('parentId')
  if(el) el.value = 'PAR-'+Math.random().toString(36).slice(2,10).toUpperCase()
}

// ── Add ───────────────────────────────────────────────────────
export async function submitAddParent() {
  const name       = val('parentName')
  const email      = val('parentEmail')
  const password   = val('parentPassword')
  const relation   = val('parentRelation')
  const contact    = val('parentContact')
  const address    = val('parentAddress')

  try {
    // 1. Create auth account
    const { data: auth, error: ae } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { name } }
    })
    
    if (ae) throw ae
    if (!auth.user) throw new Error("Sign up failed")

    // 2. Single insert into profiles table
    const { error: pe } = await supabase.from('profiles').insert([{
      id: auth.user.id,
      name, 
      email, 
      relation,
      contact: contact || null,
      address: address || null,
      role: 'PARENT' // CRITICAL: This ensures it shows up in loadParents()
    }])

    if (pe) throw pe

    showToast('Parent Added', `${name} registered`, 'success')
    closeM('addParentModal')
    document.getElementById('addParentForm').reset()
    
    // Refresh the list
    await loadParents() 
    
  } catch (e) { 
    showToast('Error', e.message, 'error') 
  }
}

// ── Edit ──────────────────────────────────────────────────────
export async function openEditParentModal(id) {
  const {data:p,error} = await supabase.from('profiles').select('*').eq('id',id).single()
  if(error) return showToast('Error','Could not load parent','error')

  document.getElementById('editParentName').value            = p.name||''
  document.getElementById('editParentEmail').value           = p.email||''
  document.getElementById('editParentRelation').value        = p.relation||''
  document.getElementById('editParentContact').value         = p.contact||''
  document.getElementById('editParentAddress').value         = p.address||''
  openM('editParentModal')
}

export async function submitEditParent() {
  const id   = val('editParentId')
  const name = val('editParentName')
  const email= val('editParentEmail')
  if(!name||!email) return showToast('Missing fields','Name and email required','warning')

  const {error} = await supabase.from('profiles').update({
    name, email,
    relation           : val('editParentRelation')||null,
    contact            : val('editParentContact')||null,
    address            : val('editParentAddress')||null,
  }).eq('id',id)

  if(error) return showToast('Error',error.message,'error')
  showToast('Saved',`${name} updated`,'success')
  closeM('editParentModal')
  loadParents()
}

// ── Delete ────────────────────────────────────────────────────
window.confirmDeleteParent = async function(id, name) {

  if (!confirm(`Delete parent "${name}"? This cannot be undone.`)) return

  try {

    const { error } = await supabase.functions.invoke('delete-user', {
      body: {
        userId: id
      }
    })

    if (error) throw error

    showToast('Deleted', `${name} removed`, 'success')

    await loadParents()

  } catch (e) {

    showToast('Error', e.message, 'error')

  }
}

// ── Export ────────────────────────────────────────────────────
function exportCSV() {
  if(!allParents.length) return showToast('Empty','Nothing to export','warning')
  const h = ['Name','Email','Parent ID','Relation','Contact','Address']
  const r = allParents.map(p=>[p.name,p.email,p.parent_id,p.relation,p.contact,p.address].map(x=>`"${x||''}"`).join(','))
  const a = Object.assign(document.createElement('a'),{
    href:URL.createObjectURL(new Blob([[h,...r].join('\n')],{type:'text/csv'})),download:'parents.csv'
  }); a.click()
}

// ── Public getter (for other modules) ────────────────────────
export function getStudentsList() { return allStudents }

// ── Init ──────────────────────────────────────────────────────
export function initParentsSection() {
  document.getElementById('addParentBtn')?.addEventListener('click',()=>{ openM('addParentModal'); generateParentId() })
  document.getElementById('parentSearch')?.addEventListener('input', applyFilters)
  document.getElementById('relationFilter')?.addEventListener('change', applyFilters)
  document.getElementById('exportParentsBtn')?.addEventListener('click', exportCSV)
  loadParents()
}

// ── Pagination util ───────────────────────────────────────────
function renderPages(id, cur, total, onChange) {
  const el = document.getElementById(id);

  if (!el || total <= 1) {
    if (el) el.innerHTML = '';
    return;
  }

  const pages = [];

  // Previous
  if (cur > 1) {
    pages.push({ label: '‹', page: cur - 1 });
  }

  // Numbers
  for (let i = 1; i <= total; i++) {
    if (i === 1 || i === total || Math.abs(i - cur) <= 1) {
      pages.push({
        label: i,
        page: i,
        active: i === cur
      });
    } else if (pages[pages.length - 1]?.label !== '…') {
      pages.push({
        label: '…',
        page: null
      });
    }
  }

  // Next
  if (cur < total) {
    pages.push({ label: '›', page: cur + 1 });
  }

  // Render buttons
  el.innerHTML = pages.map(p => `
    <button
      class="page-btn ${p.active ? 'active' : ''}"
      data-page="${p.page || ''}"
      ${p.page === null ? 'disabled' : ''}
    >
      ${p.label}
    </button>
  `).join('');

  // Click handler
  el.onclick = (e) => {
    const btn = e.target.closest('.page-btn');

    if (!btn) return;

    const page = Number(btn.dataset.page);

    if (!isNaN(page) && page !== cur) {
      onChange(page);
    }
  };
}

window.openEditParentModal = openEditParentModal