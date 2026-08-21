import { getApiKey, getSettings } from "./storage";
import { resolveAISelection } from "./model-registry";

export interface AISetupStatus {
  providerId: string;
  providerName: string;
  hasKey: boolean;
}

export function createAISetupStatus(
  provider: { id: string; name: string },
  apiKey: string,
): AISetupStatus {
  return {
    providerId: provider.id,
    providerName: provider.name,
    hasKey: Boolean(apiKey.trim()),
  };
}

/** Return only readiness metadata; API keys never cross into content scripts. */
export async function getActiveAISetupStatus(): Promise<AISetupStatus> {
  const settings = await getSettings();
  const { provider } = resolveAISelection(settings.provider, settings.model);
  const apiKey = await getApiKey(provider.id);
  return createAISetupStatus(provider, apiKey);
}
