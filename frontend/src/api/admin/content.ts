import mainLink from '../mainURLs';
import type { ApiResponse } from '../../types/admin';

// ── Global Config ────────────────────────────────────────────────────────────────

export interface ConfigEntry {
  key: string;
  value: unknown;
  description: string | null;
  updatedAt: string | null;
}

/** Every setting (secret-looking keys are never sent), with description and last change. */
export const fetchAllConfigs = async (): Promise<ConfigEntry[]> => {
  const res =
    await mainLink.get<ApiResponse<{ configs: Record<string, unknown>; entries?: ConfigEntry[] }>>(
      '/api/admin/config'
    );
  const { entries, configs } = res.data.data;
  // An older API sends only key → value.
  return (
    entries ??
    Object.entries(configs || {}).map(([key, value]) => ({
      key,
      value,
      description: null,
      updatedAt: null,
    }))
  );
};

/** Save a setting. `create` refuses (409) a key that already exists. */
export const updateConfig = async (
  key: string,
  value: unknown,
  description?: string,
  create?: boolean
): Promise<unknown> => {
  const res = await mainLink.put<ApiResponse<unknown>>('/api/admin/config', {
    key,
    value,
    ...(description !== undefined ? { description } : {}),
    ...(create ? { create: true } : {}),
  });
  return res.data.data;
};

export const deleteConfig = async (key: string): Promise<unknown> => {
  const res = await mainLink.delete<ApiResponse<unknown>>(
    `/api/admin/config/${encodeURIComponent(key)}`
  );
  return res.data.data;
};

// ── Homepage Content ─────────────────────────────────────────────────────────────
export const fetchHomepageContent = async (): Promise<Record<string, unknown>> => {
  const res = await mainLink.get<ApiResponse<{ content: Record<string, unknown> }>>(
    '/api/admin/content/homepage'
  );
  return res.data.data.content;
};

export const updateHomepageContent = async (payload: Record<string, unknown>): Promise<unknown> => {
  const res = await mainLink.put<ApiResponse<unknown>>('/api/admin/content/homepage', payload);
  return res.data.data;
};

// ── Navigation ───────────────────────────────────────────────────────────────────
export const fetchNavigation = async (): Promise<Record<string, unknown>> => {
  const res = await mainLink.get<ApiResponse<{ navigation: Record<string, unknown> }>>(
    '/api/admin/content/navigation'
  );
  return res.data.data.navigation;
};

export const updateNavigation = async (payload: Record<string, unknown>): Promise<unknown> => {
  const res = await mainLink.put<ApiResponse<unknown>>('/api/admin/content/navigation', payload);
  return res.data.data;
};

// ── Footer ───────────────────────────────────────────────────────────────────────
export const fetchFooter = async (): Promise<Record<string, unknown>> => {
  const res = await mainLink.get<ApiResponse<{ footer: Record<string, unknown> }>>(
    '/api/admin/content/footer'
  );
  return res.data.data.footer;
};

export const updateFooter = async (payload: Record<string, unknown>): Promise<unknown> => {
  const res = await mainLink.put<ApiResponse<unknown>>('/api/admin/content/footer', payload);
  return res.data.data;
};

// ── Announcements ────────────────────────────────────────────────────────────────
export const fetchAnnouncements = async (): Promise<Record<string, unknown>[]> => {
  const res = await mainLink.get<ApiResponse<{ announcements: Record<string, unknown>[] }>>(
    '/api/admin/content/announcements'
  );
  return res.data.data.announcements;
};

export const updateAnnouncement = async (payload: Record<string, unknown>): Promise<unknown> => {
  const res = await mainLink.put<ApiResponse<unknown>>('/api/admin/content/announcements', payload);
  return res.data.data;
};

// ── Maintenance Mode ─────────────────────────────────────────────────────────────
export interface MaintenanceArea {
  key: string;
  label: string;
  description: string | null;
  /** Only changes are blocked; reading keeps working. */
  writesOnly: boolean;
}
export interface MaintenanceState {
  enabled: boolean;
  message: string;
  areas: Record<string, { enabled: boolean; message: string }>;
}
export interface MaintenanceInfo {
  maintenanceMode: MaintenanceState;
  areas: MaintenanceArea[];
  defaultMessage: string;
}

export const fetchMaintenanceMode = async (): Promise<MaintenanceInfo> => {
  const res = await mainLink.get<ApiResponse<MaintenanceInfo>>('/api/admin/maintenance');
  const d = res.data.data;
  return {
    maintenanceMode: {
      enabled: d.maintenanceMode?.enabled ?? false,
      message: d.maintenanceMode?.message ?? '',
      areas: d.maintenanceMode?.areas ?? {},
    },
    areas: d.areas ?? [],
    defaultMessage: d.defaultMessage ?? '',
  };
};

export const toggleMaintenanceMode = async (payload: {
  enabled: boolean;
  message?: string;
  areas?: Record<string, { enabled: boolean; message: string }>;
}): Promise<unknown> => {
  const res = await mainLink.put<ApiResponse<unknown>>('/api/admin/maintenance', payload);
  return res.data.data;
};
