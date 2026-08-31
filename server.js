const express = require('express');
const path = require('path');
const https = require('https');

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Serve frontend files
app.use(express.static(path.join(__dirname, 'public')));

// Default page
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function invokeAutoAbsent() {
    return new Promise((resolve, reject) => {
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
        if (!supabaseUrl || !supabaseKey) return reject(new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured'));
        const url = new URL('/functions/v1/auto-mark-absent', supabaseUrl);
        const request = https.request(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${supabaseKey}`,
                'Content-Type': 'application/json',
                ...(process.env.AUTO_ABSENT_TRIGGER_SECRET ? { 'x-auto-absent-secret': process.env.AUTO_ABSENT_TRIGGER_SECRET } : {}),
            },
        }, response => {
            let data = '';
            response.on('data', (chunk) => { data += chunk; });
            response.on('end', () => {
                let body;
                try { body = JSON.parse(data); } catch { body = { error: data || 'Invalid function response' }; }
                if (response.statusCode >= 200 && response.statusCode < 300) resolve(body);
                else reject(Object.assign(new Error(body.error || `Edge Function returned ${response.statusCode}`), { statusCode: response.statusCode }));
            });
        });
        request.setTimeout(15000, () => request.destroy(new Error('Auto-absent request timed out')));
        request.on('error', reject);
        request.end();
    });
}

// Auto-absent scheduler endpoint.  Set AUTO_ABSENT_TRIGGER_SECRET in production.
app.post('/api/trigger-auto-absent', async (req, res) => {
    try {
        const triggerSecret = process.env.AUTO_ABSENT_TRIGGER_SECRET;
        if (triggerSecret && req.get('x-auto-absent-secret') !== triggerSecret) {
            return res.status(401).json({ error: 'Unauthorized auto-absent trigger' });
        }
        const result = await invokeAutoAbsent();
        console.log('[AUTO-ABSENT] Result:', result);
        res.json(result);
    } catch (error) {
        console.error('[AUTO-ABSENT] Error:', error);
        res.status(error.statusCode || 500).json({ error: error.message });
    }
});

// Useful only for an explicitly managed Node host. Production scheduling belongs
// in Supabase Cron (see supabase/migrations/20240101000001_schedule_auto_mark_absent.sql).
function startAutoAbsentScheduler() {
    if (process.env.AUTO_ABSENT_LOCAL_SCHEDULER !== 'true') {
        console.log('[SCHEDULER] Local scheduler disabled; use Supabase Cron in production');
        return;
    }
    const intervalMinutes = 5;
    const intervalMs = intervalMinutes * 60 * 1000;

    console.log(`[SCHEDULER] Auto-absent check will run every ${intervalMinutes} minutes`);

    setInterval(() => {
        const now = new Date();
        console.log(`[SCHEDULER] Running auto-absent check at ${now.toISOString()}`);

        invokeAutoAbsent()
            .then(() => console.log('[SCHEDULER] Auto-absent check completed successfully'))
            .catch(error => console.error('[SCHEDULER] Auto-absent check error:', error.message));
    }, intervalMs);
}

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running at http://localhost:${PORT}`);
    // Start the auto-absent scheduler
    startAutoAbsentScheduler();
});
