// Email Service Integration Examples
// These functions can be used to replace the placeholder sendGuardianEmail function

// ================== SENDGRID INTEGRATION ==================
async function sendGuardianEmailSendGrid(
  guardianEmail: string,
  studentName: string,
  scheduleTime: string,
  attendanceDate: string
): Promise<boolean> {
  try {
    if (!guardianEmail?.trim()) {
      console.log(`[EMAIL] No guardian email for student ${studentName}`)
      return false
    }

    const sendgridApiKey = Deno.env.get('SENDGRID_API_KEY')
    if (!sendgridApiKey) {
      console.log('[EMAIL] SendGrid API key not configured')
      return false
    }

    const [year, month, day] = attendanceDate.split('-')
    const dateObj = new Date(Number(year), Number(month) - 1, Number(day))
    const formattedDate = dateObj.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })

    const htmlBody = `
      <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto;">
            <p>Good day,</p>
            <p>This is to inform you that your child, <strong>${studentName}</strong>, was marked <strong>Absent</strong> today, <strong>${formattedDate}</strong>, for their scheduled class at <strong>${scheduleTime}</strong>.</p>
            <p>If your child arrives later and scans their student ID/QR code, their attendance will be updated to <strong>Present</strong> and their actual arrival time will be recorded.</p>
            <p>Thank you.</p>
          </div>
        </body>
      </html>
    `

    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${sendgridApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [
          {
            to: [{ email: guardianEmail }],
            subject: 'Student Attendance Notification',
          },
        ],
        from: {
          email: Deno.env.get('EMAIL_FROM') || 'noreply@school.edu',
          name: 'School Attendance System',
        },
        content: [
          {
            type: 'text/html',
            value: htmlBody,
          },
        ],
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[EMAIL] SendGrid error ${response.status}: ${errorText}`)
      return false
    }

    console.log(`[EMAIL] Sent to ${guardianEmail} via SendGrid`)
    return true
  } catch (error) {
    console.error(`[EMAIL] SendGrid error: ${error}`)
    return false
  }
}

// ================== BREVO (SENDINBLUE) INTEGRATION ==================
async function sendGuardianEmailBrevo(
  guardianEmail: string,
  studentName: string,
  scheduleTime: string,
  attendanceDate: string
): Promise<boolean> {
  try {
    if (!guardianEmail?.trim()) {
      console.log(`[EMAIL] No guardian email for student ${studentName}`)
      return false
    }

    const brevoApiKey = Deno.env.get('BREVO_API_KEY')
    if (!brevoApiKey) {
      console.log('[EMAIL] Brevo API key not configured')
      return false
    }

    const [year, month, day] = attendanceDate.split('-')
    const dateObj = new Date(Number(year), Number(month) - 1, Number(day))
    const formattedDate = dateObj.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })

    const htmlBody = `
      <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto;">
            <p>Good day,</p>
            <p>This is to inform you that your child, <strong>${studentName}</strong>, was marked <strong>Absent</strong> today, <strong>${formattedDate}</strong>, for their scheduled class at <strong>${scheduleTime}</strong>.</p>
            <p>If your child arrives later and scans their student ID/QR code, their attendance will be updated to <strong>Present</strong> and their actual arrival time will be recorded.</p>
            <p>Thank you.</p>
          </div>
        </body>
      </html>
    `

    const response = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': brevoApiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        to: [{ email: guardianEmail }],
        sender: {
          email: Deno.env.get('EMAIL_FROM') || 'noreply@school.edu',
          name: 'School Attendance System',
        },
        subject: 'Student Attendance Notification',
        htmlContent: htmlBody,
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[EMAIL] Brevo error ${response.status}: ${errorText}`)
      return false
    }

    console.log(`[EMAIL] Sent to ${guardianEmail} via Brevo`)
    return true
  } catch (error) {
    console.error(`[EMAIL] Brevo error: ${error}`)
    return false
  }
}

// ================== MAILGUN INTEGRATION ==================
async function sendGuardianEmailMailgun(
  guardianEmail: string,
  studentName: string,
  scheduleTime: string,
  attendanceDate: string
): Promise<boolean> {
  try {
    if (!guardianEmail?.trim()) {
      console.log(`[EMAIL] No guardian email for student ${studentName}`)
      return false
    }

    const mailgunApiKey = Deno.env.get('MAILGUN_API_KEY')
    const mailgunDomain = Deno.env.get('MAILGUN_DOMAIN')

    if (!mailgunApiKey || !mailgunDomain) {
      console.log('[EMAIL] Mailgun credentials not configured')
      return false
    }

    const [year, month, day] = attendanceDate.split('-')
    const dateObj = new Date(Number(year), Number(month) - 1, Number(day))
    const formattedDate = dateObj.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    })

    const htmlBody = `
      <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
          <div style="max-width: 600px; margin: 0 auto;">
            <p>Good day,</p>
            <p>This is to inform you that your child, <strong>${studentName}</strong>, was marked <strong>Absent</strong> today, <strong>${formattedDate}</strong>, for their scheduled class at <strong>${scheduleTime}</strong>.</p>
            <p>If your child arrives later and scans their student ID/QR code, their attendance will be updated to <strong>Present</strong> and their actual arrival time will be recorded.</p>
            <p>Thank you.</p>
          </div>
        </body>
      </html>
    `

    const formData = new FormData()
    formData.append('from', `School <noreply@${mailgunDomain}>`)
    formData.append('to', guardianEmail)
    formData.append('subject', 'Student Attendance Notification')
    formData.append('html', htmlBody)

    const response = await fetch(
      `https://api.mailgun.net/v3/${mailgunDomain}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`api:${mailgunApiKey}`)}`,
        },
        body: formData,
      }
    )

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[EMAIL] Mailgun error ${response.status}: ${errorText}`)
      return false
    }

    console.log(`[EMAIL] Sent to ${guardianEmail} via Mailgun`)
    return true
  } catch (error) {
    console.error(`[EMAIL] Mailgun error: ${error}`)
    return false
  }
}

// ================== USAGE ==================
// Replace the sendGuardianEmail function in auto-mark-absent/index.ts
// with one of the above implementations.
//
// Set environment variables based on your chosen service:
//
// SendGrid:
// - SENDGRID_API_KEY=your-api-key
// - EMAIL_FROM=noreply@school.edu
//
// Brevo:
// - BREVO_API_KEY=your-api-key
// - EMAIL_FROM=noreply@school.edu
//
// Mailgun:
// - MAILGUN_API_KEY=your-api-key
// - MAILGUN_DOMAIN=mg.school.edu
// - EMAIL_FROM is constructed automatically
