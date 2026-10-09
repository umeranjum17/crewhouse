// Person-only Gmail delivery. No agent tool, batch, standing approval or retry of an uncertain send.
import type { Store, Row } from './db.ts';
import type { Connections } from './connections.ts';
import { GMAIL } from './mail.ts';
import { receipt } from './crew.ts';
// Free-mail domains hold many people, so one mailbox on them is never a whole organisation: attesting them domain-wide would email sole traders.
const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'googlemail.co.uk', 'outlook.com', 'outlook.co.uk', 'hotmail.com', 'hotmail.co.uk', 'live.com', 'live.co.uk', 'msn.com', 'yahoo.com', 'yahoo.co.uk', 'ymail.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'aol.co.uk', 'proton.me', 'protonmail.com', 'gmx.com', 'gmx.co.uk', 'btinternet.com', 'btopenworld.com', 'blueyonder.co.uk', 'ntlworld.com', 'virginmedia.com', 'virgin.net', 'sky.com', 'talktalk.net']), INDIVIDUALS = "Sole traders and small partnerships count as individuals under UK email rules. This job will not email them.", fail = (message: string, status = 409) => Object.assign(new Error(message), { status });
const address = (raw: unknown) => {
  if (typeof raw !== 'string' || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(raw) || raw.length > 254) throw fail('Give one work email address, without names or extra recipients.', 400);
  return raw.toLowerCase();
};
export class MailSend {
  constructor(db: Store, connections: Connections) { this.db = db; this.connections = connections; }
  private db: Store;
  private connections: Connections;
  private record(key: string) { return JSON.parse(this.db.get('SELECT value FROM settings WHERE key = ?', key)?.value ?? 'null'); }
  private save(key: string, value: Row) { this.db.run('INSERT INTO settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, JSON.stringify(value)); }
  status(raw: unknown) {
    const to = address(raw), org = to.split('@')[1], rec = this.record(`mail.org.${org}`);
    return { to, org, eligibility: rec && { ...rec, phone: undefined }, suppressed: !!this.record(`mail.stop.${to}`) };
  }
  private eligible(to: string) {
    const s = this.status(to);
    if (s.suppressed) throw fail('This address is on your do-not-email list. Nothing was sent.');
    if (FREE_MAIL.has(s.org)) throw fail(INDIVIDUALS);
    if (s.eligibility?.kind !== 'corporate' || s.eligibility?.person !== 1) throw fail(s.eligibility?.kind === 'sole-trader' || s.eligibility?.kind === 'small-partnership'
      ? INDIVIDUALS
      : 'You have not marked this organisation as corporate-eligible. Unknown organisations cannot be emailed.');
  }
  set(raw: unknown, body: Row, phone: string) {
    const s = this.status(raw), at = Date.now();
    if (body.kind !== undefined && FREE_MAIL.has(s.org)) throw fail(INDIVIDUALS, 400);
    if (!['corporate', 'sole-trader', 'small-partnership', 'unknown'].includes(body.kind) && typeof body.suppressed !== 'boolean') throw fail('Choose an organisation type or change the do-not-email list.', 400);
    if (body.kind !== undefined && (!['corporate', 'sole-trader', 'small-partnership', 'unknown'].includes(body.kind) || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 160)) throw fail('Name the organisation you are marking.', 400);
    this.db.tx(() => {
      if (body.kind !== undefined) { const v = { org: s.org, name: body.name.trim(), kind: body.kind, person: 1, phone, at }; this.save(`mail.org.${s.org}`, v); this.db.event('mail.attested', null, { org: s.org, name: v.name, kind: body.kind, person: 1, at }); }
      if (typeof body.suppressed === 'boolean') {
        if (body.suppressed) this.save(`mail.stop.${s.to}`, { to: s.to, person: 1, phone, at });
        else this.db.run('DELETE FROM settings WHERE key = ?', `mail.stop.${s.to}`);
        this.db.event('mail.suppression', null, { to: s.to, suppressed: body.suppressed, person: 1, at });
      }
    });
    return this.status(s.to);
  }
  private async sender() {
    const token = await this.connections.token('gmailsend');
    if (!token) throw fail('Connect Gmail sending in Settings first. Reading Gmail alone cannot send.');
    const res = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw fail(`Gmail could not confirm your sending address (${res.status}). Nothing was sent.`);
    const who = await res.json() as Row;
    if (who.email_verified !== true) throw fail('Gmail has not confirmed your sending address. Nothing was sent.');
    return { token, from: address(who.email) };
  }
  private openDraft(id: number) {
    if (this.db.get("SELECT 1 FROM asks WHERE json_extract(detail,'$.send.draft')=? AND state IN ('sending','uncertain') OR json_extract(detail,'$.send.draft')=? AND answer='sent'", id, id)) throw fail('This message was already sent or attempted. Check Gmail; it will not be sent again.');
    const draft = this.db.get("SELECT asks.* FROM asks JOIN bots ON bots.id=asks.bot WHERE asks.id=? AND bots.template='tracer' AND asks.kind='propose' AND asks.state='open'", id), d = JSON.parse(draft?.detail ?? '{}');
    if (!draft || d.draft?.channel !== 'email' || typeof d.preview?.body !== 'string') throw fail('Open one of Tracer’s email drafts first.');
    return d;
  }
  async review(id: number) {
    const d = this.openDraft(id), to = address(d.draft.to), subject = d.draft.subject, body = d.preview.body;
    if (typeof subject !== 'string' || !subject.trim() || /[\r\n]/.test(subject) || subject.length > 160 || !body.trim() || body.length > 12000) throw fail('The email needs one subject and a complete body of at most 12,000 characters.');
    this.eligible(to);
    const { from } = await this.sender();
    this.eligible(to);
    this.openDraft(id);
    const open = this.db.get("SELECT * FROM asks WHERE json_extract(detail,'$.send.draft') = ? AND state = 'open'", id);
    if (open) return { id: open.id };
    const detail = { effect: 'send', send: { draft: id, from, to, subject, body }, preview: { body } }, r = this.db.run("INSERT INTO asks (bot,kind,title,detail,at) VALUES ('chief','mail','Send this one email from your Gmail?',?,?)", JSON.stringify(detail), Date.now());
    const ask = Number(r.lastInsertRowid); this.db.event('mail.review', 'chief', { ask, draft: id });
    return { id: ask };
  }
  private receiptOf(draft: number, kind: string) {
    const row = this.db.get('SELECT bot, detail FROM asks WHERE id = ?', draft)!, d = JSON.parse(row.detail);
    this.db.event(kind, row.bot, { ...receipt(d.draft, d.preview), task: d.task });
  }
  async answer(ask: Row, answer: string, phone: string) {
    if (!['allow', 'deny'].includes(answer)) throw fail('Choose Send or Not now.', 400);
    const m = JSON.parse(ask.detail).send, to = address(m.to);
    if (answer === 'deny') { this.db.run("UPDATE asks SET state='answered',answer='not now',answered_at=? WHERE id=? AND state='open'", Date.now(), ask.id); this.db.event('mail.declined', ask.bot, { ask: ask.id }); if (this.db.get("SELECT 1 FROM asks WHERE id=? AND state='open'", m.draft)) this.receiptOf(m.draft, 'draft.rejected'); return; }
    this.eligible(to);
    const { token, from } = await this.sender();
    if (from !== m.from) throw fail('Your Gmail account changed. Review a new email card before sending.');
    this.eligible(to);
    if (!this.db.get("SELECT 1 FROM devices WHERE id=? AND role='control'", phone)) throw fail('This phone no longer has permission to approve sending.', 403);
    this.db.tx(() => {
      const claimed = this.db.run("UPDATE asks SET state='sending',answer='approved once',answered_at=? WHERE id=? AND state='open'", Date.now(), ask.id), drafted = this.db.run("UPDATE asks SET state='answered',answer='Gmail sending attempted',answered_at=? WHERE id=? AND state='open'", Date.now(), m.draft);
      if (!claimed.changes) throw fail('This message was already attempted. Check Gmail; it will not be sent again.');
      if (!drafted.changes) throw fail('This message was already answered on its draft. Nothing was sent.');
      this.db.event('mail.approved', ask.bot, { ask: ask.id, person: 1, from, to });
    });
    const raw = Buffer.from(`From: ${from}\r\nTo: ${to}\r\nSubject: ${m.subject.match(/[\s\S]{1,10}/gu)!.map((s: string) => `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`).join('\r\n ')}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${Buffer.from(m.body).toString('base64').match(/.{1,76}/g)!.join('\r\n')}\r\n`).toString('base64url');
    try {
      const res = await fetch(`${GMAIL}/messages/send`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify({ raw }), redirect: 'error', signal: AbortSignal.timeout(20_000) });
      if (!res.ok) { const refused = res.status < 500; throw Object.assign(fail(refused ? `Gmail said ${res.status}. Nothing was sent; the draft is open again for a new review.` : `Gmail said ${res.status}.`), { refused }); }
      const sent = await res.json() as Row;
      if (typeof sent.id !== 'string' || !sent.id) throw fail('Gmail did not confirm delivery.');
      this.db.run("UPDATE asks SET state='answered',answer='sent' WHERE id=?", ask.id); this.db.event('mail.sent', ask.bot, { ask: ask.id, id: sent.id, from, to }); this.receiptOf(m.draft, 'draft.approved');
    } catch (e: any) {
      if (e.refused) {
        this.db.tx(() => {
          this.db.run("UPDATE asks SET state='answered',answer='not sent',answered_at=? WHERE id=?", Date.now(), ask.id);
          this.db.run("UPDATE asks SET state='open',answer=NULL,answered_at=NULL WHERE id=? AND answer='Gmail sending attempted'", m.draft);
          this.db.event('mail.refused', ask.bot, { ask: ask.id, to });
        });
        throw e;
      }
      this.db.run("UPDATE asks SET state='uncertain',answer='check Gmail' WHERE id=?", ask.id); this.db.event('mail.unsure', ask.bot, { ask: ask.id, to });
      throw fail(`Could not confirm sending: ${e.message} Check Gmail before doing anything else. This message will not be retried automatically.`);
    }
  }
  /** Clear a card stuck on "check Gmail": the person acknowledges it, whichever device they read it on. */
  dismiss(ask: Row) {
    const changed = this.db.run("UPDATE asks SET state='answered',answer='dismissed',answered_at=? WHERE id=? AND kind='mail' AND state='uncertain'", Date.now(), ask.id);
    if (!changed.changes) throw fail('This email is not waiting to be checked.');
    this.db.event('mail.dismissed', ask.bot, { ask: ask.id });
  }
}
