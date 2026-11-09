import mainLink from '../mainURLs';
import type { ApiResponse, Pagination } from '../../types/admin';

function toParams(q: Record<string, unknown>): string {
  const p = new URLSearchParams();
  Object.entries(q).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  });
  return p.toString();
}

/** Report reason → Norwegian label (same set as models/JobReport.js). */
export const REPORT_TYPE_LABELS: Record<string, string> = {
  fake_job: 'Falsk annonse',
  scam_or_fraud: 'Svindel',
  spam: 'Spam',
  duplicate: 'Duplikat',
  inappropriate_content: 'Upassende innhold',
  wrong_category: 'Feil kategori',
  misleading_info: 'Villedende informasjon',
  expired_job: 'Utløpt annonse',
  payment_issue: 'Betalingsproblem',
  other: 'Annet',
};

export interface AdminJobReportItem {
  _id: string;
  serviceId: {
    _id: string;
    title: string;
    price?: number;
    status?: string;
    images?: string[];
  } | null;
  reportedBy: {
    _id: string;
    name: string;
    email: string;
    avatarUrl?: string;
    role?: string;
    accountStatus?: string;
  } | null;
  reportedUser: {
    _id: string;
    name: string;
    email: string;
    avatarUrl?: string;
    role?: string;
    accountStatus?: string;
  } | null;
  reportType: string;
  description: string;
  status: string;
  assignedAdminId: { _id: string; name: string; email: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminJobReportDetail extends AdminJobReportItem {
  serviceId: {
    _id: string;
    title: string;
    description?: string;
    price?: number;
    status?: string;
    images?: string[];
    location?: { address?: string; city?: string };
    categories?: string[];
    createdAt?: string;
  } | null;
  resolvedBy: { _id: string; name: string; email: string } | null;
  resolutionNote: string | null;
  resolvedAt: string | null;
}

export interface AdminJobReportsSummary {
  open: number;
  under_review: number;
  resolved: number;
  dismissed: number;
  resolvedThisMonth: number;
  unassigned: number;
  total: number;
}

interface AdminJobReportsQuery {
  page?: number;
  limit?: number;
  status?: string;
  reportType?: string;
  serviceId?: string;
  assignedToMe?: 'true' | 'false';
  startDate?: string;
  endDate?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export const fetchAdminJobReports = async (
  q: AdminJobReportsQuery = {}
): Promise<{ reports: AdminJobReportItem[]; pagination: Pagination }> => {
  const res = await mainLink.get<ApiResponse<{ reports: AdminJobReportItem[] }>>(
    `/api/admin/job-reports?${toParams(q as Record<string, unknown>)}`
  );
  return { reports: res.data.data.reports, pagination: res.data.pagination! };
};

export const fetchAdminJobReportsSummary = async (): Promise<AdminJobReportsSummary> =>
  (await mainLink.get<ApiResponse<AdminJobReportsSummary>>('/api/admin/job-reports/summary')).data
    .data;

export interface RelatedJobReport {
  _id: string;
  reportType: string;
  status: string;
  createdAt: string;
  reportedBy: { _id: string; name: string; email: string } | null;
}

export const fetchAdminJobReportById = async (
  reportId: string
): Promise<{
  report: AdminJobReportDetail;
  related: RelatedJobReport[];
  reportedUserReports: number;
}> =>
  (
    await mainLink.get<
      ApiResponse<{
        report: AdminJobReportDetail;
        related: RelatedJobReport[];
        reportedUserReports: number;
      }>
    >(`/api/admin/job-reports/${reportId}`)
  ).data.data;

export const assignJobReport = async (reportId: string): Promise<AdminJobReportItem> => {
  const res = await mainLink.patch<ApiResponse<{ report: AdminJobReportItem }>>(
    `/api/admin/job-reports/${reportId}/assign`,
    {}
  );
  return res.data.data.report;
};

export const updateJobReportStatus = async (
  reportId: string,
  status: string,
  note?: string
): Promise<AdminJobReportItem> => {
  const res = await mainLink.patch<ApiResponse<{ report: AdminJobReportItem }>>(
    `/api/admin/job-reports/${reportId}/status`,
    { status, note }
  );
  return res.data.data.report;
};

interface SubmitJobReportPayload {
  reportType: string;
  description: string;
}

export const submitUserJobReport = async (
  serviceId: string,
  payload: SubmitJobReportPayload
): Promise<{ reportId: string; status: string; createdAt: string }> => {
  const res = await mainLink.post<
    ApiResponse<{ reportId: string; status: string; createdAt: string }>
  >(`/api/services/${serviceId}/reports`, payload);
  return res.data.data;
};
