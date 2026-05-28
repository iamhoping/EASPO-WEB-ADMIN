// /js/modules/students.js
import { supabase } from '../services/supabaseClient.js'
import { showToast } from '../ui/toast.js'
import { renderPagination } from '../ui/pagination.js';

let allStudents = []
let filtered    = []
let currentPage = 1
const PER_PAGE  = 10

// Valid grade levels — must match Supabase check constraint exactly
const VALID_GRADES = ['Grade 7','Grade 8','Grade 9','Grade 10','Grade 11','Grade 12']

const AV_COLORS = ['av-blue','av-green','av-yellow','av-purple','av-red','av-orange']
const initials  = n => (n||'').split(' ').map(w=>w[0]||'').join('').slice(0,2).toUpperCase()||'??'
const avColor   = n => { let s=0;for(const c of(n||''))s+=c.charCodeAt(0);return AV_COLORS[s%AV_COLORS.length] }
const val       = id => (document.getElementById(id)?.value||'').trim()
const openM     = id => document.getElementById(id)?.classList.remove('hidden')
const closeM    = id => document.getElementById(id)?.classList.add('hidden')

// Safely convert grade value: empty string → null, invalid → null
// This prevents the check_grade_level constraint violation
function safeGrade(raw) {
  const g = (raw||'').trim()
  return VALID_GRADES.includes(g) ? g : null
}

// ── Load ────────────────────────────────────────────────────
export async function loadStudents() {
  const tbody = document.getElementById('studentsTableBody')
  if (tbody) tbody.innerHTML = `<tr><td colspan="8"><div class="loader"><div class="spinner"></div></div></td></tr>`

  const { data, error } = await supabase
    .from('profiles')
    .select('id,name,email,contact,address,student_id,guardian_email,grade_level,status')
    .eq('role','STUDENT')
    .order('name',{ascending:true})

  if (error) { showToast('DB Error', error.message, 'error'); return }
  allStudents = data || []
  applyFilters()
}

// ── Filter ──────────────────────────────────────────────────
export function applyFilters() {
  const q  = val('studentSearch').toLowerCase()
  const gr = document.getElementById('gradeFilter')?.value || ''
  const st = document.getElementById('statusFilter')?.value || ''
  filtered = allStudents.filter(s =>
    (!q  || (s.name||'').toLowerCase().includes(q)||(s.student_id||'').toLowerCase().includes(q)||(s.email||'').toLowerCase().includes(q)) &&
    (!gr || s.grade_level===gr) &&
    (!st || (s.status||'active')===st)
  )
  currentPage = 1
  render()
}

// ── Render ──────────────────────────────────────────────────
function render() {
  const tbody   = document.getElementById('studentsTableBody')
  const countEl = document.getElementById('studentsCount')
  const total   = filtered.length
  if (!tbody) return

  if (!total) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">🎒</div><div class="empty-title">No students found</div><div class="empty-sub">Adjust your search or add a new student.</div></div></td></tr>`
    if(countEl) countEl.textContent = '0 students'
    document.getElementById('studentsPagination').innerHTML = ''
    return
  }

  const start = (currentPage-1)*PER_PAGE
  const slice = filtered.slice(start, start+PER_PAGE)
  const pages = Math.ceil(total/PER_PAGE)

  tbody.innerHTML = slice.map(s => {
    const st = s.status||'active'
    return `
    <tr>
      <td class="cb-cell"><input type="checkbox"/></td>
      <td><div class="ent-row">
        <div class="av ${avColor(s.name)}">${initials(s.name)}</div>
        <div><div class="ent-name">${s.name||'—'}</div><div class="ent-sub">${s.email||'—'}</div></div>
      </div></td>
      <td><code style="font-size:.78rem;color:var(--text3)">${s.student_id||'—'}</code></td>
      <td><span class="pill pill-blue">${s.grade_level||'—'}</span></td>
      <td>${s.contact||'—'}</td>
      <td>${s.guardian_email||'—'}</td>
      <td><span class="pill ${st==='active'?'pill-green':'pill-grey'}">${st[0].toUpperCase()+st.slice(1)}</span></td>
      <td><div class="row-acts">
        <button class="act-btn" title="Edit"   onclick="openEditStudentModal('${s.id}')">✏️</button>
        <button class="act-btn danger" title="Delete" onclick="confirmDeleteStudent('${s.id}','${(s.name||'').replace(/'/g,"\\'")}')">🗑</button>
      </div></td>
    </tr>`
  }).join('')

  if(countEl) countEl.textContent = `Showing ${start+1}–${Math.min(start+PER_PAGE,total)} of ${total} students`
  renderPages('studentsPagination', currentPage, pages, p => { currentPage=p; render() })
}

// ── ID gen ──────────────────────────────────────────────────
export function generateStudentId() {
  const el = document.getElementById('studentId')
  if (el) el.value = 'STD-'+Math.random().toString(36).slice(2,10).toUpperCase()
}

// ── Add ─────────────────────────────────────────────────────
export async function submitAddStudent() {
  const name         = val('studentName')
  const email        = val('studentEmail')
  const password     = val('studentPassword')
  const student_id   = val('studentId')
  const grade_level  = val('studentGrade')
  const contact      = val('studentContact')
  const address      = val('studentAddress')
  const guardian_email = val('guardianEmail')

  if (!name||!email||!password||!student_id||!grade_level)
    return showToast('Missing fields','Fill all required fields','warning')
  if (password.length<6)
    return showToast('Weak password','Min 6 characters','warning')

  try {
    const {data:auth, error:ae} = await supabase.auth.signUp({email,password,options:{data:{name}}})
    if(ae) throw ae
    const {error:pe} = await supabase.from('profiles').insert([{
      id:auth.user.id, name, email, student_id, grade_level,
      contact:contact||null, address:address||null,
      guardian_email:guardian_email||null, role:'STUDENT', status:'active'
    }])
    if(pe) throw pe
    showToast('Student Added', `${name} enrolled`, 'success')
    closeM('addStudentModal')
    document.getElementById('addStudentForm').reset()
    loadStudents()
  } catch(e) { showToast('Error', e.message, 'error') }
}

// ── Edit ─────────────────────────────────────────────────────
export async function openEditStudentModal(id) {
  const {data:s,error} = await supabase.from('profiles').select('*').eq('id',id).single()
  if(error) return showToast('Error','Could not load student','error')
  document.getElementById('editStudentId').value       = s.id
  document.getElementById('editStudentName').value     = s.name||''
  document.getElementById('editStudentEmail').value    = s.email||''
  document.getElementById('editStudentIdField').value  = s.student_id||''
  document.getElementById('editStudentGrade').value    = s.grade_level||''
  document.getElementById('editStudentContact').value  = s.contact||''
  document.getElementById('editStudentAddress').value  = s.address||''
  document.getElementById('editGuardianEmail').value    = s.guardian_email||''
  document.getElementById('editStudentStatus').value   = s.status||'' 
  openM('editStudentModal')
}

export async function submitEditStudent() {
  const id   = val('editStudentId')
  const name = val('editStudentName')
  const email= val('editStudentEmail')
  if(!name||!email) return showToast('Missing fields','Name and email required','warning')

  const {error} = await supabase.from('profiles').update({
    name, email,
    grade_level   : val('editStudentGrade')||null,
    contact       : val('editStudentContact')||null,
    address       : val('editStudentAddress')||null,
    guardian_email : val('editGuardianEmail')||null,
    status        : val('editStudentStatus')||null,
  }).eq('id',id)

  if(error) return showToast('Error',error.message,'error')
  showToast('Saved',`${name} updated`,'success')
  closeM('editStudentModal')
  loadStudents()
}

// ── Delete Student ───────────────────────────────────────────
window.confirmDeleteStudent = async function(id, name) {

  if (!confirm(`Delete student "${name}"? This cannot be undone.`)) return

  try {

    const { error } = await supabase.functions.invoke('delete-user', {
      body: {
        userId: id
      }
    })

    if (error) throw error

    showToast('Deleted', `${name} removed`, 'success')

    // Refresh UI
    await loadStudents()

  } catch (e) {

    showToast('Error', e.message, 'error')

  }

}

// ── Export ───────────────────────────────────────────────────
function exportCSV() {
  if(!allStudents.length) return showToast('Empty','Nothing to export','warning')
  const h = ['Name','Email','Student ID','Grade Level','Contact','Guardian Email','Address']
  const r = allStudents.map(s=>[s.name,s.email,s.student_id,s.grade_level,s.contact,s.guardian_email,s.address].map(x=>`"${x||''}"`).join(','))
  const a = Object.assign(document.createElement('a'),{
    href:URL.createObjectURL(new Blob([[h,...r].join('\n')],{type:'text/csv'})),download:'students.csv'
  }); a.click()
}

// ── Init ─────────────────────────────────────────────────────
export function initStudentsSection() {
  document.getElementById('addStudentBtn')?.addEventListener('click',()=>{ openM('addStudentModal'); generateStudentId() })
  document.getElementById('studentSearch')?.addEventListener('input', applyFilters)
  document.getElementById('gradeFilter')?.addEventListener('change', applyFilters)
  document.getElementById('statusFilter')?.addEventListener('change', applyFilters)
  document.getElementById('exportStudentsBtn')?.addEventListener('click', exportCSV)
  loadStudents()
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

// expose for inline onclick
window.openEditStudentModal = openEditStudentModal