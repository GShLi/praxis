import { useEffect, useRef, useState } from 'react';
import type { AvailableModel, ModelDiscoveryInput } from '@praxis/model-core/provider';
import type { PraxisClient } from '../client-types.ts';
import { errorText } from './controls.tsx';

export function useProviderCatalog(client: PraxisClient) {
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [state, setState] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [error, setError] = useState('');
  const [checkedAt, setCheckedAt] = useState('');
  const version = useRef(0);
  useEffect(
    () => () => {
      version.current++;
    },
    [],
  );
  const invalidate = () => {
    version.current++;
    setModels([]);
    setState('idle');
    setError('');
    setCheckedAt('');
  };
  const fetch = async (input: ModelDiscoveryInput) => {
    const request = ++version.current;
    setState('loading');
    setError('');
    try {
      const result = await client.discoverModels(input);
      if (version.current !== request) return;
      setModels(result);
      setState('success');
      setCheckedAt(new Date().toLocaleTimeString());
    } catch (failure) {
      if (version.current !== request) return;
      setState('error');
      setError(errorText(failure));
    }
  };
  return { models, state, error, checkedAt, invalidate, fetch };
}
