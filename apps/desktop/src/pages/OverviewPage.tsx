import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Col, List, Row, Space, Statistic, Tag, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { describeHearing, EAR_LABELS, type Ear } from '@hearlink/domain';
import { AudiogramChart } from '../components/charts';
import { isDesktopShell, useEngineStatus } from '../desktop/systemEngine';
import { localStore } from '../store';
import { configFromProfile } from '../store/profile';
import type { ProfileRecord, SessionRecord } from '../store/types';

export function OverviewPage() {
  const navigate = useNavigate();
  const [profile, setProfile] = useState<ProfileRecord | null>(null);
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const desktopShell = isDesktopShell();
  const { status: engine } = useEngineStatus();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [active, list] = await Promise.all([
        localStore.getActiveProfile(),
        localStore.listSessions(),
      ]);
      setProfile(active);
      setSessions(list.slice(0, 5));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const config = configFromProfile(profile);
  const hasProfile = Boolean(config);

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card bordered={false} loading={loading}>
        <Row gutter={[16, 16]} align="middle">
          <Col flex="auto">
            <Typography.Title level={4} style={{ margin: 0 }}>
              {profile ? profile.name : '欢迎使用 HearLink'}
            </Typography.Title>
            <Typography.Text type="secondary">
              {hasProfile
                ? '当前档案已就绪，可以在「声音增强」里试听补偿效果。'
                : '先做一次双耳纯音自测，才能生成属于你的补偿方案。'}
            </Typography.Text>
          </Col>
          <Col>
            <Space>
              <Button type="primary" onClick={() => navigate('/hearing-test')}>
                {hasProfile ? '重新测听' : '开始听力自测'}
              </Button>
              <Button onClick={() => navigate('/enhance')} disabled={!hasProfile}>
                声音增强
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      {hasProfile ? (
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12} lg={6}>
            <Card bordered={false}>
              <Statistic
                title="整体分级（较好耳）"
                value={config!.overallGrade.label}
                valueStyle={{ fontSize: 18 }}
              />
            </Card>
          </Col>
          {(['LEFT', 'RIGHT'] as Ear[]).map((ear) => {
            const earConfig = config!.ears[ear];
            return (
              <Col xs={24} sm={12} lg={5} key={ear}>
                <Card bordered={false}>
                  <Statistic
                    title={`${EAR_LABELS[ear]} PTA`}
                    value={earConfig?.ptaDbHl ?? '未测听'}
                    suffix={earConfig?.ptaDbHl ? 'dB' : ''}
                  />
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    {earConfig ? earConfig.grade.label : '该侧尚未测听'}
                  </Typography.Text>
                </Card>
              </Col>
            );
          })}
          <Col xs={24} sm={12} lg={8}>
            <Card bordered={false}>
              <Statistic title="当前档案" value={profile!.name} valueStyle={{ fontSize: 18 }} />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                更新于 {new Date(profile!.updatedAt).toLocaleString()}
              </Typography.Text>
            </Card>
          </Col>
        </Row>
      ) : null}

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={14}>
          <Card bordered={false} title="听力曲线">
            {hasProfile ? (
              <AudiogramChart
                left={config!.ears.LEFT?.audiogram ?? null}
                right={config!.ears.RIGHT?.audiogram ?? null}
              />
            ) : (
              <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                完成测听后，这里会显示左右耳各自的听阈曲线（右耳红圈 / 左耳蓝方）。
              </Typography.Paragraph>
            )}
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card bordered={false} title="结果解读">
            {hasProfile ? (
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                {(['LEFT', 'RIGHT'] as Ear[]).map((ear) => {
                  const earConfig = config!.ears[ear];
                  if (!earConfig) {
                    return (
                      <Typography.Text key={ear} type="secondary">
                        {EAR_LABELS[ear]}：尚未测听
                      </Typography.Text>
                    );
                  }
                  const description = describeHearing(earConfig.audiogram);
                  return (
                    <div key={ear}>
                      <Tag color={ear === 'LEFT' ? 'blue' : 'red'}>{EAR_LABELS[ear]}</Tag>
                      <Typography.Text>{description.headline}</Typography.Text>
                    </div>
                  );
                })}
                <Button type="link" style={{ paddingLeft: 0 }} onClick={() => navigate('/profile')}>
                  查看完整解读与补偿参数 →
                </Button>
              </Space>
            ) : (
              <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                测听完成后，会用通俗语言告诉你每个频段的听音情况，以及这对日常交流的影响。
              </Typography.Paragraph>
            )}
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card bordered={false} title="最近的测听记录">
            {sessions.length === 0 ? (
              <Typography.Text type="secondary">还没有记录</Typography.Text>
            ) : (
              <List
                size="small"
                dataSource={sessions}
                rowKey="id"
                renderItem={(item) => (
                  <List.Item>
                    <Space>
                      <Tag color={item.ear === 'LEFT' ? 'blue' : 'red'}>{EAR_LABELS[item.ear]}</Tag>
                      <span>{new Date(item.startedAt).toLocaleString()}</span>
                      <Typography.Text type="secondary">
                        {item.finishedAt ? '已完成' : '未完成'}
                      </Typography.Text>
                    </Space>
                  </List.Item>
                )}
              />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card bordered={false} title="运行状态">
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              <Space>
                <Tag color="green">本地模式</Tag>
                <Typography.Text type="secondary">数据仅存本机，不上传</Typography.Text>
              </Space>
              <Space>
                {desktopShell ? (
                  <>
                    <Tag color="green">桌面版</Tag>
                    <Typography.Text type="secondary">Tauri 外壳 + Rust 音频引擎</Typography.Text>
                  </>
                ) : (
                  <>
                    <Tag color="default">浏览器预览</Tag>
                    <Typography.Text type="secondary">桌面版可接管系统声音</Typography.Text>
                  </>
                )}
              </Space>
              <Space>
                {engine?.running ? (
                  <>
                    <Tag color="green">系统全局</Tag>
                    <Typography.Text type="secondary">系统所有声音已按当前档案处理</Typography.Text>
                  </>
                ) : (
                  <>
                    <Tag color="orange">系统级处理未启用</Tag>
                    <Typography.Text type="secondary">
                      {desktopShell ? '在「声音增强」页一键开启' : '需要桌面版（虚拟声卡）'}
                    </Typography.Text>
                  </>
                )}
              </Space>
            </Space>
          </Card>
        </Col>
      </Row>

      <Alert
        type="warning"
        showIcon
        message="使用边界"
        description="本工具生成的是相对听阈，未做声学校准，仅用于个性化补偿与前后对比，不作为医疗诊断依据。"
      />
    </Space>
  );
}
