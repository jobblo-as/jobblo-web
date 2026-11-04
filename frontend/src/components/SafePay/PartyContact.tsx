import { Mail, Phone } from 'lucide-react';
import { formatPhone } from '../../utils/norwegianFormat';

/**
 * A contract party's e-mail and phone, as links. The order endpoints send them only to the two
 * parties; for the customer the job's own contact (required phone) wins over the profile's.
 */
export function PartyContact({
  email,
  phone,
  center = false,
}: {
  email?: string;
  phone?: string;
  /** For a centred party card. */
  center?: boolean;
}) {
  if (!email && !phone) return null;
  const link = `flex min-w-0 items-center gap-1.5 text-xs text-gray-600 hover:text-[#2E6641] ${
    center ? 'justify-center' : ''
  }`;
  return (
    <div className="mt-1.5 space-y-1">
      {phone && (
        <a href={`tel:${phone.replace(/\s/g, '')}`} className={link}>
          <Phone size={12} className="shrink-0 text-gray-400" aria-hidden="true" />
          <span className="truncate">{formatPhone(phone)}</span>
        </a>
      )}
      {email && (
        <a href={`mailto:${email}`} className={link}>
          <Mail size={12} className="shrink-0 text-gray-400" aria-hidden="true" />
          <span className="truncate">{email}</span>
        </a>
      )}
    </div>
  );
}
