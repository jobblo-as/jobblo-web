import { useEffect, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import { Command as CommandIcon, Search, Terminal } from 'lucide-react';
import { AdminSidebar } from '../../components/admin/AdminSidebar';
import { useAdminNav, type AdminNavGroup } from '../../components/admin/adminNav';
import { LanguageSwitcher } from '../../components/admin/LanguageSwitcher';
import { LanguageProvider } from '../../i18n/LanguageContext';
import { Badge } from '../../components/developer/ui/badge';
import { Button } from '../../components/developer/ui/button';
import { Separator } from '../../components/developer/ui/separator';
import { TooltipProvider } from '../../components/developer/ui/tooltip';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '../../components/developer/ui/breadcrumb';
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../../components/developer/ui/command';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '../../components/developer/ui/sidebar';

const ENV = import.meta.env.PROD
  ? window.location.hostname.includes('staging')
    ? 'staging'
    : 'production'
  : 'development';
const ENV_CLASS: Record<string, string> = {
  production: 'border-red-200/70 bg-red-50 text-red-700',
  staging: 'border-amber-200/70 bg-amber-50 text-amber-700',
  development: 'border-sky-200/70 bg-sky-50 text-sky-700',
};

/** Same shadcn look as the Developer Console: the `dev-theme` palette on <body>. */
function useBodyTheme() {
  useEffect(() => {
    document.body.classList.add('dev-theme');
    return () => document.body.classList.remove('dev-theme');
  }, []);
}

/** Jump to any admin page (⌘K), as in the Developer Console. */
function CommandPalette({
  groups,
  open,
  setOpen,
}: {
  groups: AdminNavGroup[];
  open: boolean;
  setOpen: (v: boolean) => void;
}) {
  const navigate = useNavigate();
  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Gå til" description="Søk etter sider">
      <CommandInput placeholder="Søk etter sider…" />
      <CommandList>
        <CommandEmpty>Ingen sider funnet.</CommandEmpty>
        {groups.map((g) => (
          <CommandGroup key={g.label} heading={g.label}>
            {g.items.map((i) => (
              <CommandItem
                key={i.to}
                value={`${g.label} ${i.label}`}
                onSelect={() => {
                  setOpen(false);
                  navigate(i.to);
                }}
              >
                <i.icon />
                <span>{i.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  );
}

function AdminShell() {
  useBodyTheme();
  const { pathname } = useLocation();
  const groups = useAdminNav();
  const items = groups.flatMap((group) => group.items);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Longest matching nav path wins, so /dashboard/safepay/123 shows "SafePay".
  const current = items
    .filter((item) =>
      item.end ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`)
    )
    .sort((a, b) => b.to.length - a.to.length)[0];

  return (
    <TooltipProvider delayDuration={200}>
      <SidebarProvider>
        <AdminSidebar />
        <SidebarInset className="min-w-0 bg-background" translate="no">
          <header className="sticky top-0 z-20 flex h-12 shrink-0 items-center gap-2 border-b bg-background/85 px-3 backdrop-blur sm:px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
            <Breadcrumb className="min-w-0">
              <BreadcrumbList>
                <BreadcrumbItem className="hidden sm:block">
                  <BreadcrumbLink asChild>
                    <Link to="/dashboard">Admin</Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden sm:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage className="truncate">
                    {current?.label || 'Dashboard'}
                  </BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>

            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="hidden w-56 justify-start bg-card text-muted-foreground md:inline-flex"
                onClick={() => setPaletteOpen(true)}
              >
                <Search />
                <span className="flex-1 text-left">Søk etter sider…</span>
                <kbd className="pointer-events-none inline-flex h-5 items-center gap-0.5 rounded-sm border bg-muted px-1 font-mono text-[10px]">
                  <CommandIcon className="size-3" />K
                </kbd>
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="md:hidden"
                onClick={() => setPaletteOpen(true)}
                aria-label="Søk"
              >
                <Search />
              </Button>
              <Button variant="outline" size="sm" asChild className="hidden bg-card lg:inline-flex">
                <Link to="/developer">
                  <Terminal /> Developer Console
                </Link>
              </Button>
              <LanguageSwitcher />
              <Badge
                variant="outline"
                className={`hidden capitalize sm:inline-flex ${ENV_CLASS[ENV]}`}
              >
                {ENV}
              </Badge>
            </div>
          </header>

          <main
            id="main-content"
            aria-label="Hovedinnhold"
            className="mx-auto w-full max-w-[1600px] flex-1 p-4 sm:p-6"
          >
            <Outlet />
          </main>
        </SidebarInset>
      </SidebarProvider>
      <CommandPalette groups={groups} open={paletteOpen} setOpen={setPaletteOpen} />
    </TooltipProvider>
  );
}

export default function DashboardLayout() {
  return (
    <LanguageProvider>
      <Toaster
        position="bottom-right"
        toastOptions={{ style: { borderRadius: '8px', fontSize: '14px' } }}
      />
      <AdminShell />
    </LanguageProvider>
  );
}
