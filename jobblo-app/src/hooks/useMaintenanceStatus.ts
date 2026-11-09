import { useQuery } from '@tanstack/react-query';
import apiClient from '../api/client';

type MaintenanceStatus = {
  enabled: boolean;
  message: string;
  areas: { key: string; label: string; message: string }[];
};

/** Public: what is switched off right now (backend services/maintenance.js). Never throws. */
export function useMaintenanceStatus() {
  const { data } = useQuery({
    queryKey: ['maintenance-status'],
    queryFn: async (): Promise<MaintenanceStatus | null> =>
      (await apiClient.get('/maintenance')).data?.data ?? null,
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: false,
  });
  return {
    siteOff: data?.enabled ? data.message : null,
    /** The message when this area is off, else null. */
    off: (key: string) => data?.areas?.find((a) => a.key === key)?.message ?? null,
  };
}
