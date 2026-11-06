import { Button, Dropdown, message } from 'antd';
import type { MenuProps } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';

/** 顶栏账号区：游客显示登录入口；登录后只保留退出登录（同步已全自动）。 */
export function AccountMenu() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  if (!user) {
    return (
      <Button size="small" onClick={() => navigate('/login')}>
        登录 / 注册
      </Button>
    );
  }

  const items: MenuProps['items'] = [
    { key: 'logout', label: '退出登录', danger: true },
  ];

  return (
    <Dropdown
      menu={{
        items,
        onClick: async ({ key }) => {
          if (key !== 'logout') return;
          await logout();
          message.success('已退出登录，本地功能不受影响');
        },
      }}
      trigger={['click']}
      placement="bottomRight"
    >
      <Button size="small">{user.nickname || user.username}</Button>
    </Dropdown>
  );
}
