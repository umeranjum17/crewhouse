export const DOOR: string;
export const MODEL_URL: string;
export default function door(): void;
export function openDoor(sock: string, provider: { baseUrl: string; apiKey: string }): Promise<{ close(): void }>;
