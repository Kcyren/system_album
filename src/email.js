'use strict';

// New-release emails through Resend (https://resend.com).
// Needs RESEND_API_KEY and EMAIL_FROM. Without a verified domain, Resend only
// delivers to the email address of the Resend account itself.

const config = require('./config');
const { db, must } = require('./supabase');
const { escapeHtml } = require('./util');

const emailsEnabled = () => Boolean(config.resendApiKey && config.emailFrom);

function siteUrl(req) {
  return config.publicUrl || `${req.protocol}://${req.get('host')}`;
}

function releaseEmail({ track, artist, base, unsubscribeUrl }) {
  const link = `${base}/track/${track.id}`;
  const cover = track.coverUrl
    ? `<img src="${escapeHtml(track.coverUrl)}" alt="" width="520" style="display:block;width:100%;max-width:520px;border-radius:10px;margin:0 0 22px">`
    : '';
  const about = track.description ? `<p style="margin:0 0 22px;color:#c3cde0;line-height:1.6">${escapeHtml(track.description)}</p>` : '';
  const html = `<!doctype html><html><body style="margin:0;background:#080b14;font-family:Arial,Helvetica,sans-serif;color:#f7f9ff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#080b14;padding:28px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#111728;border:1px solid #293452;border-radius:14px;padding:24px">
<tr><td>
<p style="margin:0 0 18px;font-size:12px;letter-spacing:2px;color:#9db4ff;font-weight:bold">SYSTEM.ALBUM · NEW ${escapeHtml(track.category.toUpperCase())}</p>
${cover}
<h1 style="margin:0 0 8px;font-size:28px;line-height:1.15">${escapeHtml(track.title)}</h1>
<p style="margin:0 0 18px;color:#a5afc7">New from ${escapeHtml(artist)}</p>
${about}
<a href="${escapeHtml(link)}" style="display:inline-block;background:#426bff;color:#ffffff;text-decoration:none;font-weight:bold;padding:13px 22px;border-radius:8px">▶ Listen now</a>
</td></tr></table>
<p style="max-width:560px;margin:18px auto 0;font-size:11px;color:#7d8bab;line-height:1.6">You're getting this because you followed ${escapeHtml(artist)} on System Album.
<a href="${escapeHtml(unsubscribeUrl)}" style="color:#9db4ff">Unsubscribe</a></p>
</td></tr></table></body></html>`;
  const text = `New from ${artist}: ${track.title}\n\n${track.description ? `${track.description}\n\n` : ''}Listen: ${link}\n\nUnsubscribe: ${unsubscribeUrl}`;
  return { html, text, subject: `New from ${artist}: ${track.title}` };
}

async function sendBatch(messages) {
  const response = await fetch('https://api.resend.com/emails/batch', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.resendApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(messages),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || `Resend error ${response.status}`);
  }
}

// Emails every follower about a published track. Returns { sent } or { error }.
async function announceTrack(req, track) {
  if (!emailsEnabled()) return { error: 'Email is not set up (RESEND_API_KEY / EMAIL_FROM).' };
  const base = siteUrl(req);
  const profile = must(await db.from('profile').select('artist_name').eq('id', 1).maybeSingle()) || {};
  const artist = profile.artist_name || 'Surgthflur';

  const subscribers = [];
  for (let from = 0; ; from += 1000) {
    const page = must(await db.from('subscribers').select('email,unsubscribe_token').order('id').range(from, from + 999));
    subscribers.push(...page);
    if (page.length < 1000) break;
  }
  if (!subscribers.length) return { sent: 0 };

  let sent = 0;
  let failure = null;
  try {
    for (let i = 0; i < subscribers.length; i += 100) {
      const chunk = subscribers.slice(i, i + 100);
      await sendBatch(chunk.map((s) => {
        const unsubscribeUrl = `${base}/unsubscribe?token=${s.unsubscribe_token}`;
        const { html, text, subject } = releaseEmail({ track, artist, base, unsubscribeUrl });
        return {
          from: config.emailFrom,
          to: [s.email],
          subject,
          html,
          text,
          headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>` },
        };
      }));
      sent += chunk.length;
    }
  } catch (error) {
    console.error('[email]', error.message);
    failure = error.message;
  }
  // Mark as announced once anyone got it, so a retry never emails people twice.
  if (sent > 0) must(await db.from('tracks').update({ announced_at: new Date().toISOString() }).eq('id', track.id));
  return failure ? { sent, error: failure } : { sent };
}

module.exports = { emailsEnabled, announceTrack };
