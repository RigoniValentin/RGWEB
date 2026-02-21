import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigProvider, App as AntApp } from 'antd';
import esES from 'antd/locale/es_ES';

import { ProtectedRoute } from './components/ProtectedRoute';
import { AppLayout } from './components/AppLayout';
import { LoginPage } from './pages/LoginPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30_000,
    },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ConfigProvider
        locale={esES}
        theme={{
          token: {
            colorPrimary: '#EABD23',
            colorBgBase: '#FFFFFF',
            colorTextBase: '#333333',
            borderRadius: 10,
            colorLink: '#EABD23',
            colorLinkHover: '#D4A720',
            fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          },
          components: {
            Button: {
              colorPrimary: '#EABD23',
              colorPrimaryHover: '#D4A720',
              colorPrimaryActive: '#c49a1a',
              primaryColor: '#1E1F22',
              borderRadius: 8,
              controlHeight: 40,
              fontWeight: 600,
            },
            Menu: {
              darkItemBg: 'transparent',
              darkItemSelectedBg: '#EABD23',
              darkItemSelectedColor: '#1E1F22',
              darkItemHoverBg: 'rgba(234, 189, 35, 0.1)',
              darkItemHoverColor: '#EABD23',
              darkItemColor: 'rgba(255,255,255,0.7)',
            },
            Table: {
              borderRadius: 10,
              headerBg: '#1E1F22',
              headerColor: '#EABD23',
              headerSortActiveBg: '#2A2B2F',
              rowHoverBg: 'rgba(234, 189, 35, 0.06)',
            },
            Card: {
              borderRadiusLG: 10,
            },
            Input: {
              borderRadius: 8,
              activeBorderColor: '#EABD23',
              hoverBorderColor: '#D4A720',
            },
            Select: {
              borderRadius: 8,
            },
            Tag: {
              borderRadiusSM: 6,
            },
            Drawer: {
              colorBgElevated: '#FFFFFF',
            },
          },
        }}
      >
        <AntApp>
          <BrowserRouter>
            <Routes>
              {/* Public routes */}
              <Route path="/login" element={<LoginPage />} />

              {/* Protected routes — AppLayout manages tab content internally */}
              <Route element={<ProtectedRoute />}>
                <Route path="/*" element={<AppLayout />} />
              </Route>

              {/* Redirect root to dashboard */}
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
          </BrowserRouter>
        </AntApp>
      </ConfigProvider>
    </QueryClientProvider>
  );
}

export default App;
