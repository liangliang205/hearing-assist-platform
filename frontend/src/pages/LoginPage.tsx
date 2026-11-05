import { useState } from 'react';
import { Button, Card, Form, Input, Tabs, Typography, message } from 'antd';
import { useAuth } from '../auth/AuthContext';

interface LoginValues {
  username: string;
  password: string;
}

interface RegisterValues extends LoginValues {
  confirmPassword: string;
  nickname?: string;
}

export function LoginPage() {
  const { login, register } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [tab, setTab] = useState('login');

  const handleLogin = async (values: LoginValues) => {
    setSubmitting(true);
    try {
      await login(values.username.trim(), values.password);
      message.success('登录成功');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '登录失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleRegister = async (values: RegisterValues) => {
    if (values.password !== values.confirmPassword) {
      message.error('两次输入的密码不一致');
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
    } catch (error) {
      message.error(error instanceof Error ? error.message : '注册失败');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="auth-page">
      <Card className="auth-card" bordered={false}>
        <Typography.Title level={3} style={{ marginBottom: 4 }}>
          HearLink 听障辅助平台
        </Typography.Title>
        <Typography.Paragraph type="secondary">
          先做一次纯音自测，拿到你的听力曲线，再生成个性化补偿配置。
        </Typography.Paragraph>

        <Tabs
          activeKey={tab}
          onChange={setTab}
          items={[
            {
              key: 'login',
              label: '登录',
              children: (
                <Form<LoginValues> layout="vertical" onFinish={handleLogin} requiredMark={false}>
                  <Form.Item
                    name="username"
                    label="用户名"
                    rules={[{ required: true, message: '请输入用户名' }]}
                  >
                    <Input autoComplete="username" placeholder="例如 liangjingfeng" />
                  </Form.Item>
                  <Form.Item
                    name="password"
                    label="密码"
                    rules={[{ required: true, message: '请输入密码' }]}
                  >
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
                <Form<RegisterValues> layout="vertical" onFinish={handleRegister} requiredMark={false}>
                  <Form.Item
                    name="username"
                    label="用户名"
                    rules={[
                      { required: true, message: '请输入用户名' },
                      { min: 3, max: 32, message: '长度 3～32 位' },
                      { pattern: /^[a-zA-Z0-9_]+$/, message: '仅支持字母、数字、下划线' },
                    ]}
                  >
                    <Input autoComplete="username" />
                  </Form.Item>
                  <Form.Item name="nickname" label="昵称（可选）">
                    <Input maxLength={32} />
                  </Form.Item>
                  <Form.Item
                    name="password"
                    label="密码"
                    rules={[{ required: true, message: '请输入密码' }, { min: 8, message: '至少 8 位' }]}
                  >
                    <Input.Password autoComplete="new-password" />
                  </Form.Item>
                  <Form.Item
                    name="confirmPassword"
                    label="确认密码"
                    rules={[{ required: true, message: '请再次输入密码' }]}
                  >
                    <Input.Password autoComplete="new-password" />
                  </Form.Item>
                  <Button type="primary" htmlType="submit" block loading={submitting}>
                    注册并登录
                  </Button>
                </Form>
              ),
            },
          ]}
        />

        <Typography.Paragraph type="secondary" className="auth-footnote">
          本平台提供的是辅助聆听工具，测听结果不等同于医院纯音测听，不作为医疗诊断依据。
        </Typography.Paragraph>
      </Card>
    </div>
  );
}
