import type { PraxisClient } from '../client-types.ts';
import { useSettingsResource } from './useSettingsResource.ts';

export function useSettingsProfile(client: PraxisClient) {
  const resource = useSettingsResource(
    client,
    client.profile ? () => client.profile!() : undefined,
  );
  return { profile: resource.data, profileError: resource.error, reloadProfile: resource.reload };
}
