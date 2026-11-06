import { useState } from 'react';
import { Button, Card, Divider, Form, Input, Tabs, Typography, message } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';

interface LoginValues {
  username: string;
  password: string;
}

interface RegisterValues {
  username: string;
  password: string;
  confirm: string;
  nickname?: string;
}

const USERNAME_RULES = [
  { required: true, message: '请输入用户名' },
  { min: 3, max: 32, message: '用户名 3–32 个字符' },
  {
    pattern: /^[a-zA-Z0-9_]+$/,
    message: '只能包含字母、数字和下划线',
  },
];

const PASSWORD_RULES = [
  { required: true, message: '请输入密码' },
  { min: 8, max: 72, message: '密码 8–72 位' },
];

export function LoginPage() {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<'login' | 'register'>('login');
  const [submitting, setSubmitting] = useState(false);

  const onLogin = async (values: LoginValues) => {
    setSubmitting(true);
    try {
      await login(values.username.trim(), values.password);
      message.success('登录成功');
      navigate('/');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '登录失败');
    } finally {
      setSubmitting(false);
    }
  };

  const onRegister = async (values: RegisterValues) => {
    if (values.password !== values.confirm) {
      message.warning('两次输入的密码不一致');
      return;
    }

    setSubmitting(true);
    try {
      await register({
        username: values.username.trim(),
        password: values.password,
        nickname: values.nickname?.trim() || undefined,
      });
      message.success('注册成功，已自动登录');
      navigate('/');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '注册失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <Card className="auth-card" bordered={false}>
        <div className="auth-brand">
          HearLink
          <small>听障辅助平台</small>
        </div>

        <Tabs
          activeKey={tab}
          onChange={(key) => setTab(key as 'login' | 'register')}
          items={[
            {
              key: 'login',
              label: '登录',
              children: (
                <Form<LoginValues> layout="vertical" requiredMark={false} onFinish={onLogin}>
                  <Form.Item label="用户名" name="username" rules={[{ required: true, message: '请输入用户名' }]}>
                    <Input autoComplete="username" placeholder="字母、数字或下划线" />
                  </Form.Item>
                  <Form.Item label="密码" name="password" rules={[{ required: true, message: '请输入密码' }]}>
                    <Input.Password autoComplete="current-password" placeholder="至少 8 位" />
                  </Form.Item>
                  <Button type="primary" htmlType="submit" block loading={submitting}>
                    登录
                  </Button>
                </Form>
              ),
            },
            {
              key: 'register',
              label: '注册',
              children: (
                <Form<RegisterValues> layout="vertical" requiredMark={false} onFinish={onRegister}>
                  <Form.Item label="用户名" name="username" rules={USERNAME_RULES}>
                    <Input autoComplete="username" placeholder="3–32 位，字母/数字/下划线" />
                  </Form.Item>
                  <Form.Item label="密码" name="password" rules={PASSWORD_RULES}>
                    <Input.Password autoComplete="new-password" placeholder="至少 8 位" />
                  </Form.Item>
                  <Form.Item
                    label="确认密码"
                    name="confirm"
                    dependencies={['password']}
                    rules={[
                      { required: true, message: '请再次输入密码' },
                      ({ getFieldValue }) => ({
                        validator(_, value) {
                          if (!value || value === getFieldValue('password')) {
                            return Promise.resolve();
                          }
                          return Promise.reject(new Error('两次输入的密码不一致'));
                        },
                      }),
                    ]}
                  >
                    <Input.Password autoComplete="new-password" />
                  </Form.Item>
                  <Form.Item label="昵称（可选）" name="nickname">
                    <Input maxLength={32} placeholder="显示在顶栏" />
                  </Form.Item>
                  <Button type="primary" htmlType="submit" block loading={submitting}>
                    注册并登录
                  </Button>
                </Form>
              ),
            },
          ]}
        />

        <Divider style={{ margin: '16px 0' }} />

        <Button block onClick={() => navigate('/')}>
          不登录，继续使用本地功能
        </Button>

        <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
          账号仅用于跨设备同步听力曲线与派生参数；音频、测听记录原始数据都留在本机。
        </Typography.Paragraph>
      </Card>
    </div>
  );
}
