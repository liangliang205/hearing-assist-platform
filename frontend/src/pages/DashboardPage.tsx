import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Col, Empty, Row, Space, Statistic, Tag, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { hearingApi } from '../api/endpoints';
import { useAuth } from '../auth/AuthContext';
import { AudiogramChart, GainCurveChart } from '../components/charts';
import { EAR_LABELS, type CompensationConfig, type Ear, type HearingTest } from '../types';

const GRADE_COLORS: Record<string, string> = {
  normal: 'green',
  mild: 'gold',
  moderate: 'orange',
  moderately_severe: 'volcano',
  severe: 'red',
  profound: 'magenta',
  complete: 'purple',
};

export function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [config, setConfig] = useState<CompensationConfig | null>(null);
  const [tests, setTests] = useState<HearingTest[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [profileResult, testsResult] = await Promise.allSettled([
        hearingApi.getProfile(),
        hearingApi.listTests(),
      ]);
      setConfig(profileResult.status === 'fulfilled' ? profileResult.value.config : null);
      setTests(testsResult.status === 'fulfilled' ? testsResult.value.tests : []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const completedTests = tests.filter((test) => test.status === 'COMPLETED');

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card bordered={false}>
        <Row gutter={[16, 16]} align="middle">
          <Col flex="auto">
            <Typography.Title level={4} style={{ margin: 0 }}>
              你好，{user?.nickname || user?.username}
            </Typography.Title>
            <Typography.Text type="secondary">
              目标：让电脑里的所有声音，都按你的双耳听力曲线处理后播放。
            </Typography.Text>
          </Col>
          <Col>
            <Space>
              <Button type="primary" onClick={() => navigate('/hearing-test')}>
                开始听力自测
              </Button>
              <Button onClick={() => navigate('/preview')} disabled={!config}>
                增强预览
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} lg={6}>
          <Card bordered={false} loading={loading}>
            <Statistic
              title="整体分级（较好耳）"
              value={config ? config.overallGrade.label : '尚未测听'}
              valueStyle={{ fontSize: 18 }}
            />
            {config ? (
              <Tag color={GRADE_COLORS[config.overallGrade.key] ?? 'default'} style={{ marginTop: 8 }}>
                {config.overallGrade.key}
              </Tag>
            ) : null}
          </Card>
        </Col>
        {(['LEFT', 'RIGHT'] as Ear[]).map((ear) => {
          const earConfig = config?.ears[ear] ?? null;
          return (
            <Col xs={24} sm={12} lg={5} key={ear}>
              <Card bordered={false} loading={loading}>
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
          <Card bordered={false} loading={loading}>
            <Statistic title="已完成自测" value={completedTests.length} suffix="次" />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              共 {tests.length} 条记录（含左右耳）
            </Typography.Text>
          </Card>
        </Col>
      </Row>

      {!config ? (
        <Card bordered={false}>
          <Empty description="还没有听力档案。先花 3～5 分钟做一次纯音自测，就能生成属于你的双耳补偿曲线。">
            <Button type="primary" onClick={() => navigate('/hearing-test')}>
              去测听
            </Button>
          </Empty>
        </Card>
      ) : (
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={12}>
            <Card bordered={false} title="你的听力曲线（右耳红圈 / 左耳蓝方）">
              <AudiogramChart
                left={config.ears.LEFT?.audiogram ?? null}
                right={config.ears.RIGHT?.audiogram ?? null}
              />
            </Card>
          </Col>
          <Col xs={24} lg={12}>
            <Card bordered={false} title="推荐补偿增益">
              <GainCurveChart left={config.ears.LEFT} right={config.ears.RIGHT} />
            </Card>
          </Col>
        </Row>
      )}

      <Alert
        type="warning"
        showIcon
        message="使用边界"
        description={
          <Space direction="vertical" size={2}>
            <span>本平台生成的是网页端相对听阈，未做声学校准，仅用于个性化补偿与前后对比。</span>
            <span>如出现耳鸣、耳痛或明显不适，请立即停止使用并咨询听力专业人员。</span>
          </Space>
        }
      />
    </Space>
  );
}
