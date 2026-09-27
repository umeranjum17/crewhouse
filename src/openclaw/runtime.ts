import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { GatewayClient } from '@openclaw/gateway-client';
import type { AgentRuntime, RunEnd, RunEvent, RunSpec, ToolHost } from '../runtime.ts';
import { OpenClawGateway } from './gateway.ts';
import { ToolBridge } from './bridge.ts';

export class OpenClawRuntime implements AgentRuntime {
  private gateway: OpenClawGateway;
  private bridge?: ToolBridge;
  private client?: GatewayClient;
  private agents = new Set<number>();
  readonly stateDir: string;
  constructor(stateDir: string) { this.stateDir = stateDir; this.gateway = new OpenClawGateway(stateDir); }
  async start(host: ToolHost) {
    this.bridge = new ToolBridge(this.stateDir, host);
    await this.bridge.start();
    try { this.client = await this.gateway.start(); }
    catch (error) { this.bridge.stop(); throw error; }
  }
  async stop() { await this.gateway.stop(); this.bridge?.stop(); this.client = undefined; }
  private connected() { if (!this.client) throw new Error('Crewhouse engine is not ready'); return this.client; }
  private async agent(member: number) {
    if (this.agents.has(member)) return `m${member}`;
    const id = `m${member}`;
    const client = this.connected();
    const existing = await client.request<{ agents: { id: string }[] }>('agents.list');
    if (!existing.agents?.some((agent) => agent.id === id))
      await client.request('agents.create', { name: id, workspace: join(this.stateDir, 'openclaw/workspaces', id) });
    this.agents.add(member);
    return id;
  }
  async run(spec: RunSpec, on: (event: RunEvent) => void): Promise<RunEnd> {
    const client = this.connected();
    const agentId = await this.agent(spec.member);
    this.bridge?.register(spec);
    let runId: string | undefined;
    let text = '';
    const unsubscribe = this.gateway.onEvent((event) => {
      const payload = event.payload;
      if (event.event !== 'agent' || !runId || payload?.runId !== runId) return;
      if (payload.stream === 'assistant' && typeof payload.data?.text === 'string') {
        text = payload.data.text;
        on({ type: 'text', text });
      } else if (payload.stream === 'tool' && typeof payload.data?.name === 'string') {
        on({ type: 'tool', name: payload.data.name, phase: payload.data.phase === 'end' ? 'end' : 'start' });
      }
    });
    try {
      const started = await client.request<{ runId: string }>('agent', {
        agentId, sessionKey: spec.key, message: spec.message,
        extraSystemPrompt: spec.system, idempotencyKey: randomUUID(),
        ...(spec.images?.length ? { attachments: spec.images.map((image) => ({ type: 'image', mimeType: image.mimeType, content: image.data })) } : {}),
        ...(spec.thinking ? { thinking: spec.thinking } : {}),
      });
      runId = started.runId;
      const done = await client.request<any>('agent.wait', { runId, timeoutMs: 3_600_000 }, { timeoutMs: 3_610_000 });
      text = String(done.terminalReply?.text ?? text);
      if (done.status === 'ok') { on({ type: 'text', text }); return { ok: true, text }; }
      if (done.stopReason === 'aborted') return { ok: false, aborted: true };
      return { ok: false, kind: 'other', message: String(done.error ?? done.status ?? 'Engine stopped') };
    } catch (error) { return { ok: false, kind: 'other', message: String(error) }; }
    finally { unsubscribe(); this.bridge?.unregister(spec.key); }
  }
  async signedIn(member: number, _account: string) { await this.agent(member); return false; }
  signIn(_member: number, _account: string, _via: 'browser' | 'code', _on: (step: any) => void): { paste(text: string): void; cancel(): void } {
    throw new Error('Sign-in is not connected yet');
  }
  async signOut(_member: number, _account: string) { throw new Error('Sign-out is not connected yet'); }
  async steer(key: string, text: string) { await this.connected().request('sessions.steer', { sessionKey: key, message: text }); }
  async abort(key: string) { await this.connected().request('chat.abort', { sessionKey: key }); }
  async trail(_key: string) { return []; }
  async ask(member: number, prompt: string) {
    const end = await this.run({ key: `agent:m${member}:crewhouse:route:${randomUUID()}`, member, bot: 'chief', task: 0, account: 'chatgpt',
      cwd: '', system: 'You route requests in a family\'s crew of helpers. Answer with one JSON object and nothing else.', message: prompt, builtins: [] }, () => {});
    if (!end.ok) throw new Error('Routing unavailable');
    return end.text;
  }
  async learned(_member: number) { return []; }
  async forget(_member: number, _id: string) { throw new Error('Learning is not connected yet'); }
}
