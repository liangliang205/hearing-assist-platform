import { Card, Layout, Menu, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';

const { Header, Content, Sider } = Layout;

export function App() {
  const [backendStatus, setBackendStatus] = useState<'checking' | 'online' | 'offline'>('checking');

  useEffect(() => {
    fetch('/api/health')
      .then((response) => {
        if (!response.ok) throw new Error('Backend health check failed');
        setBackendStatus('online');
      })
      .catch(() => setBackendStatus('offline'));
  }, []);

  return (
    <Layout className="app-shell">
      <Sider breakpoint="lg" collapsedWidth="0">
        <div className="brand">听障辅助平台</div>
        <Menu
          theme="dark"
          mode="inline"
          defaultSelectedKeys={['home']}
          items={[
            { key: 'home', label: '工作台' },
            { key: 'hearing', label: '听力自测' },
            { key: 'videos', label: '视频库' },
            { key: 'evaluation', label: '实验结果' },
            { key: 'profile', label: '个人中心' },
          ]}
        />
      </Sider>
      <Layout>
        <Header className="topbar">
          <Typography.Title level={3}>听障辅助工作台</Typography.Title>
        </Header>
        <Content className="content">
          <Card title="项目初始化完成" extra={<Tag color="blue">开发阶段</Tag>}>
            <Typography.Paragraph>
              平台将整合听力自测、AI 视频字幕和个性化音频增强能力。
            </Typography.Paragraph>
            <Typography.Paragraph>
              业务后端状态：
              <Tag color={backendStatus === 'online' ? 'green' : backendStatus === 'offline' ? 'red' : 'gold'}>
                {backendStatus === 'online' ? '在线' : backendStatus === 'offline' ? '离线' : '检查中'}
              </Tag>
            </Typography.Paragraph>
          </Card>
        </Content>
      </Layout>
    </Layout>
  );
}
