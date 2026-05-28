export function initProfileSection() {
  const editButtons = document.querySelectorAll('.inline-edit .edit-btn')
  editButtons.forEach(button => {
    button.addEventListener('click', () => {
      const input = button.previousElementSibling
      if (input && input.tagName === 'INPUT') {
        input.focus()
      }
    })
  })
}
