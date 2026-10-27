import { Redirect, Tabs } from 'expo-router';
import { View, Text } from 'react-native';
import { Home, MessageCircle, PlusCircle, UserRound, Bell } from 'lucide-react-native';
import { useAuthStore } from '@/store/authStore';
import { useUnreadCount } from '@/hooks/useNotifications';
import { useUnreadConversations } from '@/hooks/useUnreadConversations';
import { userTerms } from '@/content/userTerms';
import { GlassTabBar, useTabBarSpace } from '@/components/GlassTabBar';
import { TC } from '../../src/theme/colors';
import MfaGate from '@/components/auth/MfaGate';

// Feed screens scroll under the glass bar (they pad their own lists); every other screen
// ends above it, so no fixed button or last row is ever hidden behind the bar.
const SEE_THROUGH = new Set(['index', 'explore', 'alerts']);

function BellIcon({ color, size }: { color: string; size: number }) {
  const { data } = useUnreadCount();
  const count = data?.count ?? 0;
  return (
    <View>
      <Bell size={size} color={color} />
      {count > 0 && (
        <View
          style={{
            position: 'absolute',
            top: -2,
            right: -4,
            minWidth: 18,
            height: 18,
            borderRadius: 9,
            backgroundColor: TC.dangerSolid,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 4,
          }}
        >
          <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>
            {count > 99 ? '99+' : count}
          </Text>
        </View>
      )}
    </View>
  );
}

function MessageIcon({ color, size }: { color: string; size: number }) {
  const count = useUnreadConversations();
  return (
    <View>
      <MessageCircle size={size} color={color} />
      {count > 0 && (
        <View
          style={{
            position: 'absolute',
            top: -2,
            right: -4,
            minWidth: 18,
            height: 18,
            borderRadius: 9,
            backgroundColor: TC.dangerSolid,
            alignItems: 'center',
            justifyContent: 'center',
            paddingHorizontal: 4,
          }}
        >
          <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>
            {count > 99 ? '99+' : count}
          </Text>
        </View>
      )}
    </View>
  );
}

export default function AppLayout() {
  const hydrated = useAuthStore((s) => s.hydrated);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const tabBarSpace = useTabBarSpace();

  // Until the persisted session is read back, "not authenticated" is unknown rather than
  // false. Redirecting here would kick a signed-in user to the login screen on every cold
  // start, and a deep link into this group would lose its target.
  if (!hydrated) {
    return null;
  }

  if (!isAuthenticated) {
    return <Redirect href="/(auth)/login" />;
  }

  const needsTermsAcceptance = !(user && user.acceptedTerms === true && user.termsVersion === userTerms.currentVersion);
  if (needsTermsAcceptance) {
    return <Redirect href="/(auth)/terms-acceptance" />;
  }

  // Superadmin/developer accounts enter their authenticator code first (backend 403 MFA_REQUIRED).
  return (
    <MfaGate>
    <Tabs
      // Most screens in this group are tab routes without a tab button (see below), so cross-section
      // navigation like SafePay -> "Mine søkere" is a tab switch, not a stack push. With the
      // default `firstRoute`, `changeIndex` rewrites the tab history to [index, target], so
      // every back action out of those hidden screens lands on Hjem instead of the screen the
      // user actually came from. `history` returns to the last visited tab instead.
      backBehavior="history"
      tabBar={(props) => <GlassTabBar {...props} />}
      screenOptions={({ route }) => ({
        headerShown: false,
        sceneStyle: SEE_THROUGH.has(route.name) ? undefined : { paddingBottom: tabBarSpace },
      })}
    >
      {/* 5 visible tabs */}
      <Tabs.Screen
        name="index"
        options={{
          title: 'Hjem',
          tabBarIcon: ({ color, size }) => <Home size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="create-job"
        options={{
          title: 'Legg ut',
          tabBarIcon: ({ color, size }) => <PlusCircle size={size} color={color} />,
        }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: 'Meldinger',
          tabBarIcon: ({ color, size }) => <MessageIcon color={String(color)} size={size} />,
        }}
      />
      <Tabs.Screen
        name="alerts"
        options={{
          title: 'Varsler',
          tabBarIcon: ({ color, size }) => <BellIcon color={String(color)} size={size} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profil',
          tabBarIcon: ({ color, size }) => <UserRound size={size} color={color} />,
          href: '/(app)/profile',
        }}
        listeners={({ navigation }) => ({
          tabPress: () => {
            // Pop the profile stack to root so tapping the Profile tab always
            // shows the user's own profile, not a previously viewed provider.
            navigation.navigate('profile', { screen: 'index' });
          },
        })}
      />
      {/* Screens without a tab button. Declared but NOT `href: null`: expo-router 58 turns
          `href: null` into `hidden: true`, and its tabs redirect a focused hidden route to the
          first tab (useVisibleTabsWithRedirect), so every push to these screens bounced back to
          Hjem. GlassTabBar only draws VISIBLE_TABS, so declaring them adds no tab button. */}
      <Tabs.Screen name="explore" />
      <Tabs.Screen name="recommended-taskers" />
      <Tabs.Screen name="my-applications" />
      <Tabs.Screen name="my-jobs" />
      {/* Folder-based sections each have their own _layout.tsx (Stack). */}
      <Tabs.Screen name="jobs" />
      <Tabs.Screen name="favorites" />
      <Tabs.Screen name="job-applicants" />
      <Tabs.Screen name="provider" />
      <Tabs.Screen name="safepay" />
      <Tabs.Screen name="disputes" />
    </Tabs>
    </MfaGate>
  );
}
