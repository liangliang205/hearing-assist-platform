import { Button, Layout, Menu, Space, Spin, Typography } from 'antd';
import type { MenuProps } from 'antd';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { DashboardPage } from './pages/DashboardPage';
import { HearingTestPage } from './pages/HearingTestPage';
import { LoginPage } from './pages/LoginPage';
import { PreviewPage } from './pages/PreviewPage';
import { ProfilePage } from './pages/ProfilePage';

const { Header, Content, Sider } = Layout;

const MENU_ITEMS: MenuProps['items'] = [
  { key: '/', label: '工作台' },
  { key: '/hearing-test', label: '听力自测' },
  { key: '/profile', label: '听力档案' },
  { key: '/preview', label: '增强预览' },
];

function Shell() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  if (loading) {
    return (
      <div className="boot">
        <Spin size="large" />
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  const selectedKey = MENU_ITEMS?.some((item) => item?.key === location.pathname)
    ? location.pathname
    : '/';

  return (
    <Layout className="app-shell">
      <Sider breakpoint="lg" collapsedWidth="0">
        <div className="brand">HearLink</div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={MENU_ITEMS}
          onClick={({ key }) => navigate(key)}
        />
      </Sider>
      <Layout>
        <Header className="topbar">
          <Typography.Text strong>听障辅助平台</Typography.Text>
          <Space>
            <Typography.Text type="secondary">
              {user.nickname || user.username}
            </Typography.Text>
            <Button size="small" onClick={() => void logout()}>
              退出登录
            </Button>
          </Space>
        </Header>
        <Content className="content">
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/hearing-test" element={<HearingTestPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/preview" element={<PreviewPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  );
}

export function App() {
  return (
    <AuthProvider>
      <Shell />
    </AuthProvider>
  );
}
