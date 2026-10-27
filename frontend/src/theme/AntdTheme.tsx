import '@ant-design/v5-patch-for-react-19';
import { ConfigProvider } from 'antd';
import type { ReactNode } from 'react';

/**
 * Ant Design theme + React 19 patch, for the few screens that still use antd (search slider,
 * two admin pages). It used to wrap the whole app in main.tsx/App.tsx, which put antd
 * (~120 KB gzipped) in the first download of every page.
 */
const theme = {
  components: { Button: { fontWeight: 700 } },
  token: { colorPrimary: '#ea7e15', fontFamily: 'inherit' },
};

export function AntdTheme({ children }: { children: ReactNode }) {
  return <ConfigProvider theme={theme}>{children}</ConfigProvider>;
}
