import {
  AlertTriangle,
  Bell,
  Briefcase,
  CreditCard,
  Eye,
  Flag,
  Globe,
  LayoutDashboard,
  Megaphone,
  Menu,
  MessageSquare,
  Receipt,
  Rocket,
  Settings,
  Shield,
  ShieldCheck,
  ShoppingCart,
  Star,
  Tag,
  Ticket,
  Users,
  WalletCards,
  Wrench,
  Server,
  type LucideIcon,
} from 'lucide-react';
import { useTranslate } from '../../i18n/useTranslate';

export interface AdminNavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  end?: boolean;
}

export interface AdminNavGroup {
  label: string;
  items: AdminNavItem[];
}

/**
 * Super Admin navigation. System health, error logs, activity log and feature flags moved to
 * the Developer Console (/developer), so they are not listed here any more.
 */
export function useAdminNav(): AdminNavGroup[] {
  const { t } = useTranslate();
  return [
    {
      label: t('nav.oversikt'),
      items: [{ label: t('nav.dashboard'), to: '/dashboard', icon: LayoutDashboard, end: true }],
    },
    {
      label: t('nav.markedsplass'),
      items: [
        { label: t('nav.tjenester'), to: '/dashboard/services', icon: Briefcase },
        { label: t('nav.ordrer'), to: '/dashboard/orders', icon: ShoppingCart },
        { label: t('nav.vurderinger'), to: '/dashboard/reviews', icon: Star },
        { label: t('nav.kategorier'), to: '/dashboard/categories', icon: Tag },
      ],
    },
    {
      label: t('nav.brukere'),
      items: [{ label: t('nav.alle_brukere'), to: '/dashboard/users', icon: Users }],
    },
    {
      label: t('nav.okonomi'),
      items: [
        { label: t('nav.transaksjoner'), to: '/dashboard/transactions', icon: CreditCard },
        { label: t('nav.safepay'), to: '/dashboard/safepay', icon: Shield },
        { label: 'Stripe-historikk', to: '/dashboard/finance-history', icon: WalletCards },
        { label: t('nav.tvister'), to: '/dashboard/disputes', icon: AlertTriangle },
        { label: t('nav.abonnementer'), to: '/dashboard/plans', icon: ShieldCheck },
        { label: 'Fakturering', to: '/dashboard/subscription-billing', icon: Receipt },
        { label: t('nav.kuponger'), to: '/dashboard/voucher', icon: Ticket },
      ],
    },
    {
      label: t('nav.innhold'),
      items: [
        { label: t('nav.varslinger'), to: '/dashboard/notifications', icon: Bell },
        { label: t('nav.hjemmeside_cms'), to: '/dashboard/homepage-cms', icon: Globe },
        { label: 'Kampanjer', to: '/dashboard/campaigns', icon: Megaphone },
        { label: t('nav.navigasjon_footer'), to: '/dashboard/navigation-footer', icon: Menu },
        { label: t('nav.kunngjoringer'), to: '/dashboard/announcements', icon: Megaphone },
        { label: t('nav.shop'), to: '/dashboard/shop', icon: ShoppingCart },
        { label: t('nav.veikart'), to: '/dashboard/roadmap', icon: Rocket },
      ],
    },
    {
      label: t('nav.moderering'),
      items: [
        { label: t('nav.chat_gjennomgang'), to: '/dashboard/chat-review', icon: Eye },
        { label: t('nav.chatter'), to: '/dashboard/chats', icon: MessageSquare },
        { label: t('nav.chatrapporter'), to: '/dashboard/chat-reports', icon: Flag },
        { label: t('nav.jobrapporter'), to: '/dashboard/job-reports', icon: AlertTriangle },
      ],
    },
    {
      label: t('nav.operations'),
      items: [
        { label: t('nav.globale_instillinger'), to: '/dashboard/settings', icon: Settings },
        { label: t('nav.vedlikeholdsmodus'), to: '/dashboard/maintenance', icon: Wrench },
        { label: 'Server', to: '/dashboard/system-health', icon: Server },
      ],
    },
  ];
}
