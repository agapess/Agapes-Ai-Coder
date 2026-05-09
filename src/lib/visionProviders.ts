import type { ProviderType } from '../types';

export const VISION_PROVIDERS: ProviderType[] = ['anthropic', 'openai', 'gemini'];

export function supportsVision(provider: ProviderType): boolean {
  return VISION_PROVIDERS.includes(provider);
}
