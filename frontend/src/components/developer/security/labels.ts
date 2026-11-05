import type { AlertStatus } from '../../../api/developer';

/** Labels shared by the Security Intelligence pages. */
export const RULE_LABEL: Record<string, string> = {
  A_MULTI_IP: 'A · Many networks',
  B_VPN_TRANSITION: 'B · VPN transition',
  C_MULTI_ACCOUNT: 'C · Several accounts',
  D_LOGIN_ABUSE: 'D · Failed sign-ins',
  E_REQUEST_ABUSE: 'E · Request bursts',
  F_SENSITIVE_OPS: 'F · Sensitive changes',
};

export const STATUS_LABEL: Record<AlertStatus, string> = {
  open: 'Open',
  investigating: 'Investigating',
  resolved: 'Resolved',
  false_positive: 'False positive',
  escalated: 'Escalated',
};

/** FilterSelect's "no filter" value. */
export const ALL = '__all';
