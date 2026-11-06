import { Layout, Menu, Space, Typography } from 'antd';
import type { MenuProps } from 'antd';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AccountMenu } from './components/AccountMenu';
import { useAuth } from './auth/AuthProvider';
import { useAutoSync } from './auth/useAutoSync';
import { isDesktopShell } from './desktop/systemEngine';
import { ConsentGate } from './privacy/ConsentGate';
import { EnhancePage } from './pages/EnhancePage';
import { HearingTestPage } from './pages/HearingTestPage';
import { LoginPage } from './pages/LoginPage';
import { OverviewPage } from './pages/OverviewPage';
import { ProfilePage } from './pages/ProfilePage';
import { SettingsPage } from './pages/SettingsPage';

const { Header, Content, Sider } = Layout;

const MENU_ITEMS: MenuProps['items'] = [
  { key: '/', label: '概览' },
  { key: '/hearing-test', label: '听力自测' },
  { key: '/profile', label: '听力档案' },
  { key: '/enhance', label: '声音增强' },
  { type: 'divider' },
  { key: '/subtitle', label: '视频字幕（v0.2）', disabled: true },
  { key: '/settings', label: '设置' },
];

const TITLES: Record<string, string> = {
  '/': '概览',
  '/hearing-test': '听力自测',
  '/profile': '听力档案',
  '/enhance': '声音增强',
  '/settings': '设置',
};

export function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();

  // 登录状态下自动同步本机档案，游客模式完全不走网络
  useAutoSync();

  const selectedKey = TITLES[location.pathname] ? location.pathname : '/';
  const title = TITLES[selectedKey] ?? '概览';
  const desktopShell = isDesktopShell();

  // 登录页独立于主壳，避免侧栏在登录时出现
  if (location.pathname === '/login') {
    return <LoginPage />;
  }

  return (
    <>
      <ConsentGate />
      <Layout className="app-shell">
      <Sider theme="light" width={196} className="app-sider">
        <div className="brand">
          HearLink
          <small>听障辅助平台</small>
        </div>
        <Menu
          theme="light"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={MENU_ITEMS}
          onClick={({ key }) => navigate(key)}
        />
        <div className="sider-footer">v0.1.0 · {user ? '已登录' : '本地模式'}</div>
      </Sider>

      <Layout className="app-main">
        <Header className="topbar">
          <Typography.Text strong>{title}</Typography.Text>
          <Space size={8}>
            <AccountMenu />
          </Space>
        </Header>

        <Content className="content">
          <Routes>
            <Route path="/" element={<OverviewPage />} />
            <Route path="/hearing-test" element={<HearingTestPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/enhance" element={<EnhancePage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Content>

        <div className="statusbar">
          <span>HearLink v0.1.0</span>
          <span>
            存储：
            {desktopShell ? 'SQLite（本机）' : 'localStorage（本机）'}
            {user ? ' + 云端同步' : ''}
          </span>
          <span>处理：{desktopShell ? 'Rust 引擎（试听用 Web Audio）' : '浏览器 Web Audio'}</span>
          <span className="statusbar-right">测听结果仅作辅助参考，不作为医疗诊断</span>
        </div>
      </Layout>
    </Layout>
    </>
  );
}
