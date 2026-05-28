// /js/modules/teachers.js
import { supabase } from '../services/supabaseClient.js'
import { showToast } from '../ui/toast.js'
import { renderPagination } from '../ui/pagination.js';

let allTeachers = []
let filtered    = []
let currentPage = 1
const PER_PAGE  = 10

const AV_COLORS = ['av-blue','av-green','av-yellow','av-purple','av-red','av-orange']
const initials  = n => (n||'').split(' ').map(w=>w[0]||'').join('').slice(0,2).toUpperCase()||'??'
const avColor   = n => { let s=0;for(const c of(n||''))s+=c.charCodeAt(0);return AV_COLORS[s%AV_COLORS.length] }
const val       = id => (document.getElementById(id)?.value||'').trim()
const openM     = id => document.getElementById(id)?.classList.remove('hidden')
const closeM    = id => document.getElementById(id)?.classList.add('hidden')

const DEPT_SUBJECTS = {
  'Science'          : ['Biology','Chemistry','Physics','Earth Science'],
  'Mathematics'      : ['Algebra','Calculus','Geometry','Statistics'],
  'Arts & Humanities': ['English','History','Literature','Filipino'],
  'Physical Education': ['Sports','Fitness','Health','Dance'],
  'Technology'       : ['Computer Science','ICT','Programming','Robotics'],
}

// ── Load ─────────────────────────────────────────────────────
export async function loadTeachers() {
  const tbody = document.getElementById('teachersTableBody')
  if (tbody) tbody.innerHTML = `<tr><td colspan="8"><div class="loader"><div class="spinner"></div></div></td></tr>`

  const { data, error } = await supabase
    .from('profiles')
    .select('id,name,email,contact,teacher_id,department,status')
    .eq('role','TEACHER')
    .order('name',{ascending:true})

  if (error) { showToast('DB Error', error.message, 'error'); return }
  allTeachers = data || []
  applyFilters()
}

// ── Filter ────────────────────────────────────────────────────
export function applyFilters() {
  const q  = val('teacherSearch').toLowerCase()
  const dp = document.getElementById('deptFilter')?.value || ''
  const tc = document.getElementById('TeacherstatusFilter')?.value || ''

  filtered = allTeachers.filter(t =>
    (!q ||
      (t.name || '').toLowerCase().includes(q) ||
      (t.teacher_id || '').toLowerCase().includes(q) ||
      (t.email || '').toLowerCase().includes(q)
    ) &&

    (!dp || t.department === dp) &&

    (!tc || (t.status || '').toLowerCase() === tc.toLowerCase())
  )

  currentPage = 1
  render()
}

// ── Render ────────────────────────────────────────────────────
function render() {
  const tbody   = document.getElementById('teachersTableBody')
  const countEl = document.getElementById('teachersCount')
  const total   = filtered.length
  if (!tbody) return

  if (!total) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">🧑‍🏫</div><div class="empty-title">No teachers found</div><div class="empty-sub">Adjust your search or add a new teacher.</div></div></td></tr>`
    if(countEl) countEl.textContent = '0 teachers'
    document.getElementById('teachersPagination').innerHTML = ''
    return
  }

  const start = (currentPage-1)*PER_PAGE
  const slice = filtered.slice(start, start+PER_PAGE)
  const pages = Math.ceil(total/PER_PAGE)

  tbody.innerHTML = slice.map(t => {
    const dept     = t.department || 'Unassigned'
    const subjects = (DEPT_SUBJECTS[dept] || []).slice(0,2)
    const st       = t.status || 'active'
    const pillCls  = st==='active' ? 'pill-green' : st==='on leave' ? 'pill-yellow' : 'pill-grey'
    const pillLbl  = st.split(' ').map(w=>w[0].toUpperCase()+w.slice(1)).join(' ')

    return `
    <tr>
      <td class="cb-cell"><input type="checkbox"/></td>
      <td><div class="ent-row">
        <div class="av ${avColor(t.name)}">${initials(t.name)}</div>
        <div><div class="ent-name">${t.name||'—'}</div><div class="ent-sub">${t.email||'—'}</div></div>
      </div></td>
      <td><code style="font-size:.78rem;color:var(--text3)">${t.teacher_id||'—'}</code></td>
      <td><span class="pill pill-purple">${dept}</span></td>
      <td><div class="tag-row">${subjects.map(s=>`<span class="tag">${s}</span>`).join('')||'—'}</div></td>
      <td>${t.contact||'—'}</td>
      <td><span class="pill ${pillCls}">${pillLbl}</span></td>
      <td><div class="row-acts">
        <button class="act-btn" title="Edit"   onclick="openEditTeacherModal('${t.id}')">✏️</button>
        <button class="act-btn danger" title="Delete" onclick="confirmDeleteTeacher('${t.id}','${(t.name||'').replace(/'/g,"\\'")}')">🗑</button>
      </div></td>
    </tr>`
  }).join('')

  if(countEl) countEl.textContent = `Showing ${start+1}–${Math.min(start+PER_PAGE,total)} of ${total} teachers`
  renderPages('teachersPagination', currentPage, pages, p => { currentPage=p; render() })
}

// ── ID gen ────────────────────────────────────────────────────
export function generateTeacherId() {
  const el = document.getElementById('teacherId')
  if (el) el.value = 'TCH-'+Math.random().toString(36).slice(2,10).toUpperCase()
}

// ── Add ───────────────────────────────────────────────────────
export async function submitAddTeacher() {
  const name     = val('teacherName')
  const email    = val('teacherEmail')
  const password = val('teacherPassword')
  const tid      = val('teacherId')
  const dept     = val('teacherDept')
  const contact  = val('teacherContact')

  if (!name||!email||!password||!tid)
    return showToast('Missing fields','Fill all required fields','warning')
  if (password.length<6)
    return showToast('Weak password','Min 6 characters','warning')

  try {
    const {data:auth,error:ae} = await supabase.auth.signUp({email,password,options:{data:{name}}})
    if(ae) throw ae
    const {error:pe} = await supabase.from('profiles').insert([{
      id:auth.user.id, name, email,
      teacher_id : tid,
      department : dept||null,
      contact    : contact||null,
      role       : 'TEACHER',
      status     : 'active'
    }])
    if(pe) throw pe
    showToast('Teacher Added',`${name} added successfully`,'success')
    closeM('addTeacherModal')
    document.getElementById('addTeacherForm').reset()
    loadTeachers()
  } catch(e) { showToast('Error',e.message,'error') }
}

// ── Edit ──────────────────────────────────────────────────────
export async function openEditTeacherModal(id) {
  const {data:t,error} = await supabase.from('profiles').select('*').eq('id',id).single()
  if(error) return showToast('Error','Could not load teacher','error')
  document.getElementById('editTeacherId').value      = t.id
  document.getElementById('editTeacherName').value    = t.name||''
  document.getElementById('editTeacherEmail').value   = t.email||''
  document.getElementById('editTeacherContact').value = t.contact||''
  document.getElementById('editTeacherDept').value    = t.department||''
  document.getElementById('editTeacherGender').value  = t.gender||''
  document.getElementById('editTeacherStatus').value  = t.status||''
  openM('editTeacherModal')
}

export async function submitEditTeacher() {
  const id   = val('editTeacherId')
  const name = val('editTeacherName')
  const email= val('editTeacherEmail')
  if(!name||!email) return showToast('Missing fields','Name and email required','warning')

  const {error} = await supabase.from('profiles').update({
    name, email,
    contact    : val('editTeacherContact')||null,
    department : val('editTeacherDept')||null,
    gender     : val('editTeacherGender')||null,
    status     : val('editTeacherStatus')||null,
  }).eq('id',id)

  if(error) return showToast('Error',error.message,'error')
  showToast('Saved',`${name} updated`,'success')
  closeM('editTeacherModal')
  loadTeachers()
}

// ── Delete ────────────────────────────────────────────────────
window.confirmDeleteTeacher = async function(id, name) {

  if (!confirm(`Delete teacher "${name}"? This cannot be undone.`)) return

  try {

    const { error } = await supabase.functions.invoke('delete-user', {
      body: {
        userId: id
      }
    })

    if (error) throw error

    showToast('Deleted', `${name} removed`, 'success')

    await loadTeachers()

  } catch (e) {

    showToast('Error', e.message, 'error')

  }
}

// ── Export ────────────────────────────────────────────────────
function exportCSV() {
  if(!allTeachers.length) return showToast('Empty','Nothing to export','warning')
  const h = ['Name','Email','Teacher ID','Department','Contact']
  const r = allTeachers.map(t=>[t.name,t.email,t.teacher_id,t.department,t.contact].map(x=>`"${x||''}"`).join(','))
  const a = Object.assign(document.createElement('a'),{
    href:URL.createObjectURL(new Blob([[h,...r].join('\n')],{type:'text/csv'})),download:'teachers.csv'
  }); a.click()
}

// ── Init ──────────────────────────────────────────────────────
export function initTeachersSection() {
  // Listeners for buttons and inputs
  document.getElementById('addTeacherBtn')?.addEventListener('click',()=>{ openM('addTeacherModal'); generateTeacherId() })
  document.getElementById('teacherSearch')?.addEventListener('input', applyFilters)
  document.getElementById('deptFilter')?.addEventListener('change', applyFilters)
  document.getElementById('TeacherstatusFilter')?.addEventListener('change', applyFilters)
  document.getElementById('exportTeachersBtn')?.addEventListener('click', exportCSV)
  loadTeachers()
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

window.openEditTeacherModal = openEditTeacherModal