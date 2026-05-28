// /js/ui/modal.js

export function openModal(id) {
  const el = document.getElementById(id)
  if (el) el.classList.remove('hidden')
}

export function closeModal(id) {
  const el = document.getElementById(id)
  if (el) el.classList.add('hidden')
}

// Close on backdrop click
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.add('hidden')
  }
})