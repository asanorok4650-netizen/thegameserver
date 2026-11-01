import { useCallback, useEffect, useState } from 'react';
import { listServers, describeError } from '../servers/api.js';

export function useServers() {
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setServers(await listServers());
    } catch (e) {
      setServers([]);
      setError(describeError(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  return { servers, loading, error, refresh };
}
