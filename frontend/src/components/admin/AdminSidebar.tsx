import { useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ChevronsUpDown, LogOut, ShieldCheck, Terminal } from 'lucide-react';
import { toast } from 'react-hot-toast';
import { useUserStore } from '../../stores/userStore';
import { AdminConfirmDialog } from './AdminConfirmDialog';
import { useAdminNav, type AdminNavItem } from './adminNav';
import { Avatar, AvatarFallback, AvatarImage } from '../developer/ui/avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../developer/ui/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '../developer/ui/sidebar';

/** shadcn sidebar in the same style as the Developer Console. */
export function AdminSidebar() {
  const groups = useAdminNav();
  const { pathname } = useLocation();
  const user = useUserStore((s) => s.user);
  const logout = useUserStore((s) => s.logout);
  const navigate = useNavigate();
  const [confirmLogout, setConfirmLogout] = useState(false);
  const initials = (user?.name || '?').slice(0, 2).toUpperCase();
  const isActive = (item: AdminNavItem) =>
    item.end
      ? pathname === item.to || pathname === `${item.to}/`
      : pathname === item.to || pathname.startsWith(`${item.to}/`);

  const handleLogout = async () => {
    await logout();
    toast.success('Du har blitt logget ut.');
    navigate('/login');
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link to="/dashboard">
                <div className="flex aspect-square size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
                  <ShieldCheck className="size-4" />
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate text-sm font-semibold">Jobblo</span>
                  <span className="truncate text-xs text-muted-foreground">Super Admin</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {groups.map((group) => (
          <SidebarGroup key={group.label} className="py-1">
            <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.to}>
                    <SidebarMenuButton asChild isActive={isActive(item)} tooltip={item.label}>
                      <NavLink to={item.to} end={item.end}>
                        <item.icon />
                        <span>{item.label}</span>
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent">
                  <Avatar className="size-8 rounded-md">
                    <AvatarImage src={user?.avatarUrl} alt="" />
                    <AvatarFallback className="rounded-md text-xs">{initials}</AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{user?.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{user?.email}</span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="end" className="min-w-56">
                <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                  Logget inn som <span className="font-medium text-foreground">Super Admin</span>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate('/home')}>
                  <ArrowLeft /> Til Jobblo
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate('/developer')}>
                  <Terminal /> Developer Console
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => setConfirmLogout(true)}>
                  <LogOut /> Logg ut
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
      <SidebarRail />

      <AdminConfirmDialog
        isOpen={confirmLogout}
        onOpenChange={setConfirmLogout}
        title="Logg ut?"
        description="Vil du logge ut av administrasjonspanelet?"
        confirmText="Logg ut"
        variant="destructive"
        onConfirm={handleLogout}
      />
    </Sidebar>
  );
}
