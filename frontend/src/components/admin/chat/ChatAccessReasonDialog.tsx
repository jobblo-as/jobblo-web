import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../developer/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../developer/ui/select';
import { Label } from '../../developer/ui/label';
import { Textarea } from '../../developer/ui/textarea';
import { Button } from '../../developer/ui/button';

const ACCESS_REASONS = [
  'SafePay review',
  'Chat report investigation',
  'Dispute investigation',
  'Fraud investigation',
  'Support request',
  'Policy violation investigation',
  'Other',
] as const;

interface ChatAccessReasonDialogProps {
  open: boolean;
  defaultReason?: string;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

export function ChatAccessReasonDialog({
  open,
  defaultReason,
  onConfirm,
  onCancel,
}: ChatAccessReasonDialogProps) {
  const [selected, setSelected] = useState<string>(defaultReason ?? '');
  const [otherText, setOtherText] = useState('');

  useEffect(() => {
    if (open) {
      setSelected(defaultReason ?? '');
      setOtherText('');
    }
  }, [open, defaultReason]);

  const effectiveReason = selected === 'Other' ? otherText.trim() : selected;

  const canConfirm = selected.length > 0 && (selected !== 'Other' || otherText.trim().length >= 5);

  const handleConfirm = () => {
    if (!canConfirm) return;
    onConfirm(effectiveReason);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tilgangsgrunn kreves</DialogTitle>
          <DialogDescription>
            All tilgang til chathistorikk logges for personvern og revisjon.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="access-reason">Velg tilgangsgrunn *</Label>
            <Select value={selected} onValueChange={setSelected}>
              <SelectTrigger id="access-reason" className="w-full" aria-label="Tilgangsgrunn">
                <SelectValue placeholder="Velg tilgangsgrunn" />
              </SelectTrigger>
              <SelectContent>
                {/* a caller's default (e.g. "Admin chat list navigation") may not be in the list */}
                {[...new Set([...ACCESS_REASONS, defaultReason || 'Other'])].map((reason) => (
                  <SelectItem key={reason} value={reason}>
                    {reason}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Free-text for "Other" */}
          {selected === 'Other' && (
            <div className="space-y-1.5">
              <Label htmlFor="access-reason-other">Beskriv årsaken *</Label>
              <Textarea
                id="access-reason-other"
                rows={2}
                value={otherText}
                onChange={(e) => setOtherText(e.target.value)}
                placeholder="Min. 5 tegn…"
                maxLength={500}
              />
            </div>
          )}

          <p className="rounded-md border border-amber-200/70 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Denne handlingen logges med admin-ID, IP-adresse, brukeragent og tidsstempel. Bruk kun
            for legitime formål.
          </p>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Avbryt
          </Button>
          <Button onClick={handleConfirm} disabled={!canConfirm}>
            Bekreft og åpne chat
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
