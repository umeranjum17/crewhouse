// This phone's own IPv4 addresses (Android; elsewhere none, so the offline words stay general).
import { requireOptionalNativeModule } from 'expo';

const net = requireOptionalNativeModule<{ addresses(): Promise<string[]> }>('CrewhouseNet');
export const addresses = (): Promise<string[]> => net?.addresses().catch(() => []) ?? Promise.resolve([]);
