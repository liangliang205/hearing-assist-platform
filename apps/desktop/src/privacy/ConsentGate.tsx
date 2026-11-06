import { useState } from 'react';
import { Button, Checkbox, Divider, Modal, Space, Typography, message } from 'antd';
import { useAuth } from '../auth/AuthProvider';
import { usePrivacy } from './PrivacyProvider';

/**
 * 首次登录后的同步同意弹窗。
 *
 * 未勾选同意前不会调用任何上传接口——这是需求文档 §4.8 的硬要求，
 * 也是产品「音频与健康数据不出本机」定位的落地。
 */
export function ConsentGate() {
  const { user } = useAuth();
  const { state, ready, showRequested, accept, decline } = usePrivacy();
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);

  const open = Boolean(user) && ready && (state === 'pending' || showRequested);

  const onAccept = async () => {
    setBusy(true);
    try {
      await accept();
      message.success('已开启自动同步');
    } finally {
      setBusy(false);
    }
  };

  const onDecline = async () => {
    setBusy(true);
    try {
      await decline();
      message.info('已选择仅本机使用，不会产生任何上传');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title="同步前的隐私说明"
      closable={false}
      maskClosable={false}
      footer={null}
      width={580}
    >
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Typography.Text>
          登录账号后，HearLink 会把下面这些数据同步到你自己的账号，用于跨设备恢复：
        </Typography.Text>
        <Typography.Text type="secondary">· 双耳听力曲线（各频点听阈、PTA、分级）</Typography.Text>
        <Typography.Text type="secondary">
          · 由曲线派生的补偿参数（EQ 频带、前置增益、压缩与限幅设置）
        </Typography.Text>
        <Typography.Text type="secondary">· 测听时的设备备注（例如「索尼 WH-1000XM4」）</Typography.Text>

        <Divider style={{ margin: '6px 0' }} />

        <Typography.Text strong>不会上传：</Typography.Text>
        <Typography.Text type="secondary">· 任何音频文件与录音</Typography.Text>
        <Typography.Text type="secondary">· 逐次作答的原始测听明细</Typography.Text>
        <Typography.Text type="secondary">· 设备标识、精确位置等可识别信息</Typography.Text>

        <Divider style={{ margin: '6px 0' }} />

        <Typography.Text type="secondary">
          你可以随时在「设置 → 账号与隐私」撤回同意；撤回后会立即停止上传，并删除云端已保存的档案。
        </Typography.Text>

        <Checkbox checked={checked} onChange={(event) => setChecked(event.target.checked)}>
          我已阅读并同意同步上述听力数据
        </Checkbox>

        <Space style={{ marginTop: 4 }}>
          <Button type="primary" disabled={!checked} loading={busy} onClick={() => void onAccept()}>
            同意并开启自动同步
          </Button>
          <Button disabled={busy} onClick={() => void onDecline()}>
            暂不同步（仅本机）
          </Button>
        </Space>
      </Space>
    </Modal>
  );
}
