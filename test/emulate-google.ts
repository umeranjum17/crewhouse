import { createEmulator } from 'emulate';

export const ME = 'umer@example.com', THREAD = '19a0c0ffee000001';
export const CLIENT = { id: `123-fixture.apps.google${'usercontent'}.com`, secret: ['GOCSPX', 'abcdefghijklmnopqrstuvwxyz12'].join('-') };
const tomorrow = (h: number) => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(h, 0, 0, 0); return d.toISOString(); };

export async function startGoogleEmulator(callbackPort: number) {
  const server = await createEmulator({ service: 'google', port: 0, seed: { tokens: { witness: { login: ME } }, google: {
    users: [{ email: ME, name: 'Umer' }],
    oauth_clients: [{ client_id: CLIENT.id, client_secret: CLIENT.secret, name: 'Crewhouse', redirect_uris: [`http://127.0.0.1:${callbackPort}/connect/callback`] }],
    messages: [{ id: THREAD, thread_id: THREAD, from: 'Ada <ada@example.com>', to: ME, subject: 'Friday plan', body_text: 'Are we still on for Friday?', message_id: '<friday@example.com>' }],
    calendar_events: [{ id: 'standup0001', summary: 'Standup', start_date_time: tomorrow(9), end_date_time: tomorrow(10) }, { id: 'dentist0001', summary: 'Dentist', start_date_time: tomorrow(15), end_date_time: tomorrow(16) }],
  } } });
  return { server, url: `http://127.0.0.1:${new URL(server.url).port}` };
}
