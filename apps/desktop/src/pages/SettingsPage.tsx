import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Descriptions, Popconfirm, Space, Tag, Typography, message } from 'antd';
import { localStore } from '../store';
import { downloadBlob } from '../audio/render';
import { useAuth } from '../auth/AuthProvider';
import { usePrivacy } from '../privacy/PrivacyProvider';

export function SettingsPage() {
  const [profileCount, setProfileCount] = useState(0);
  const [sessionCount, setSessionCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const { user } = useAuth();
  const { state: consentState, revoke, prompt } = usePrivacy();

  const handleRevoke = async () => {
    const deleted = await revoke();
    if (deleted) {
      message.success('已撤回同意并删除云端档案');
    } else {
      message.warning('已撤回同意；云端删除未完成，可稍后重试');
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [profiles, sessions] = await Promise.all([
        localStore.listProfiles(),
        localStore.listSessions(),
      ]);
      setProfileCount(profiles.length);
      setSessionCount(sessions.length);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const exportAll = async () => {
    const json = await localStore.exportAll();
    downloadBlob(new Blob([json], { type: 'application/json' }), 'hearlink-backup.json');
    message.success('已导出备份文件');
  };

  const clearSessions = async () => {
    await localStore.clearSessions();
    await load();
    message.success('测听记录已清空');
  };

  const clearAll = async () => {
    await localStore.clearAll();
    await load();
    message.success('全部数据已清空');
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card bordered={false} title="数据管理" loading={loading}>
        <Descriptions size="small" column={2} style={{ marginBottom: 16 }}>
          <Descriptions.Item label="听力档案">{profileCount} 份</Descriptions.Item>
          <Descriptions.Item label="测听记录">{sessionCount} 条</Descriptions.Item>
        </Descriptions>
        <Space wrap>
          <Button onClick={() => void exportAll()}>导出全部数据</Button>
          <Popconfirm title="清空所有测听记录？档案会保留。" onConfirm={() => void clearSessions()}>
            <Button>清空测听记录</Button>
          </Popconfirm>
          <Popconfirm
            title="清空全部数据？"
            description="档案与记录都会被删除，且无法恢复。"
            okButtonProps={{ danger: true }}
            onConfirm={() => void clearAll()}
          >
            <Button danger>清空全部数据</Button>
          </Popconfirm>
        </Space>
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
          导出的 JSON 包含全部档案与测听记录，可用于备份或迁移到另一台电脑。
        </Typography.Paragraph>
      </Card>

      <Card bordered={false} title="账号与隐私">
        {user ? (
          <>
            <Descriptions size="small" column={2} style={{ marginBottom: 12 }}>
              <Descriptions.Item label="账号">{user.username}</Descriptions.Item>
              <Descriptions.Item label="同步状态">
                <Tag color={consentState === 'accepted' ? 'green' : 'default'}>
                  {consentState === 'accepted' ? '已同意 · 自动同步' : '未开启同步'}
                </Tag>
              </Descriptions.Item>
            </Descriptions>
            {consentState === 'accepted' ? (
              <Popconfirm
                title="撤回同步同意？"
                description="将立即停止上传，并删除云端已保存的档案。"
                okButtonProps={{ danger: true }}
                onConfirm={() => void handleRevoke()}
              >
                <Button danger>撤回同步同意</Button>
              </Popconfirm>
            ) : (
              <Button type="primary" onClick={prompt}>
                同意并开启同步
              </Button>
            )}
          </>
        ) : (
          <Typography.Text type="secondary">
            当前为游客模式：不登录、不联网，数据只存在本机，不会产生任何上传。
          </Typography.Text>
        )}
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
          同步内容只有听力曲线与派生参数，不含音频、不含逐次作答明细、不含设备标识。
        </Typography.Paragraph>
      </Card>

      <Card bordered={false} title="关于">
        <Descriptions size="small" column={2}>
          <Descriptions.Item label="版本">v0.1.0</Descriptions.Item>
          <Descriptions.Item label="运行形态">
            <Tag color="default">浏览器预览</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="本地存储">localStorage（桌面版将换为 SQLite）</Descriptions.Item>
          <Descriptions.Item label="音频处理">Web Audio（浏览器内）</Descriptions.Item>
        </Descriptions>
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
          本工具用于辅助聆听，测听结果不等同于医院纯音测听，不作为医疗诊断依据。
          如出现耳鸣、耳痛或明显不适，请立即停止使用并咨询听力专业人员。
        </Typography.Paragraph>
      </Card>
    </Space>
  );
}
