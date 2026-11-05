import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Collapse,
  Col,
  Descriptions,
  Empty,
  Row,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useNavigate } from 'react-router-dom';
import { hearingApi } from '../api/endpoints';
import { AudiogramChart, GainCurveChart, ResponseCurveChart } from '../components/charts';
import {
  EAR_LABELS,
  type CompensationConfig,
  type Ear,
  type EarCompensation,
  type EarProfileMap,
  type EqBand,
} from '../types';

function formatFrequency(frequency: number): string {
  return frequency >= 1000 ? `${frequency / 1000} kHz` : `${frequency} Hz`;
}

function EarSummary({
  ear,
  data,
  onGoTest,
}: {
  ear: Ear;
  data: EarCompensation | null;
  onGoTest: () => void;
}) {
  const color = ear === 'LEFT' ? 'blue' : 'red';
  return (
    <Card
      bordered={false}
      title={
        <Space>
          <Tag color={color}>{EAR_LABELS[ear]}</Tag>
          <span>{data ? data.grade.label : '未测听'}</span>
        </Space>
      }
    >
      {data ? (
        <Descriptions size="small" column={1}>
          <Descriptions.Item label="平均听阈 PTA">
            {data.ptaDbHl === null ? '--' : `${data.ptaDbHl} dB HL`}
          </Descriptions.Item>
          <Descriptions.Item label="最大补偿增益">
            {Math.max(...data.eqBands.map((band) => band.gainDb), 0)} dB
          </Descriptions.Item>
          <Descriptions.Item label="前置增益">{data.preGainDb} dB</Descriptions.Item>
          <Descriptions.Item label="生成时间">
            {new Date(data.generatedAt).toLocaleString()}
          </Descriptions.Item>
        </Descriptions>
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={`${EAR_LABELS[ear]}尚未测听，该侧将不做补偿。`}
        >
          <Button type="primary" onClick={onGoTest}>
            去补测
          </Button>
        </Empty>
      )}
    </Card>
  );
}

export function ProfilePage() {
  const navigate = useNavigate();
  const [profiles, setProfiles] = useState<EarProfileMap | null>(null);
  const [config, setConfig] = useState<CompensationConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await hearingApi.getProfile();
      setProfiles(data.profiles);
      setConfig(data.config);
      setMissing(false);
    } catch {
      setProfiles(null);
      setConfig(null);
      setMissing(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const copyConfig = async () => {
    if (!config) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(config, null, 2));
      message.success('双耳补偿配置已复制到剪贴板');
    } catch {
      message.error('复制失败，请手动从下方展开内容复制');
    }
  };

  const bandColumns: ColumnsType<EqBand> = [
    { title: '中心频率', dataIndex: 'frequency', render: (value: number) => formatFrequency(value) },
    { title: '增益', dataIndex: 'gainDb', render: (value: number) => `${value} dB` },
  ];

  if (!loading && missing) {
    return (
      <Card bordered={false}>
        <Empty description="还没有听力档案，先完成至少一侧的纯音自测吧。">
          <Button type="primary" onClick={() => navigate('/hearing-test')}>
            去测听
          </Button>
        </Empty>
      </Card>
    );
  }

  if (!config || !profiles) {
    return <Card bordered={false} loading />;
  }

  const latest = [profiles.LEFT, profiles.RIGHT]
    .filter((item): item is NonNullable<typeof item> => Boolean(item))
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card bordered={false} loading={loading}>
        <Row gutter={[16, 16]} align="middle">
          <Col flex="auto">
            <Typography.Title level={4} style={{ margin: 0 }}>
              听力档案（双耳）
            </Typography.Title>
            <Typography.Text type="secondary">
              整体分级：<Tag color="blue">{config.overallGrade.label}</Tag>
              取较好耳　·　配置版本 v{config.version}
              {latest ? `　·　更新于 ${new Date(latest.updatedAt).toLocaleString()}` : ''}
            </Typography.Text>
          </Col>
          <Col>
            <Space>
              <Button onClick={copyConfig}>复制配置 JSON</Button>
              <Button type="primary" onClick={() => navigate('/preview')}>
                增强预览
              </Button>
            </Space>
          </Col>
        </Row>
        <Descriptions size="small" column={3} style={{ marginTop: 16 }}>
          <Descriptions.Item label="左耳分级">
            {config.ears.LEFT ? config.ears.LEFT.grade.label : '未测听'}
          </Descriptions.Item>
          <Descriptions.Item label="右耳分级">
            {config.ears.RIGHT ? config.ears.RIGHT.grade.label : '未测听'}
          </Descriptions.Item>
          <Descriptions.Item label="来源自测">
            {(['LEFT', 'RIGHT'] as Ear[])
              .map((ear) => {
                const profile = profiles[ear];
                return profile?.sourceTestId
                  ? `${EAR_LABELS[ear]} ${profile.sourceTestId.slice(0, 8)}`
                  : '';
              })
              .filter(Boolean)
              .join(' / ') || '自定义配置'}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <EarSummary ear="LEFT" data={config.ears.LEFT} onGoTest={() => navigate('/hearing-test')} />
        </Col>
        <Col xs={24} lg={12}>
          <EarSummary ear="RIGHT" data={config.ears.RIGHT} onGoTest={() => navigate('/hearing-test')} />
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card bordered={false} title="听力曲线（右耳红圈 / 左耳蓝方）">
            <AudiogramChart left={config.ears.LEFT?.audiogram ?? null} right={config.ears.RIGHT?.audiogram ?? null} />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card bordered={false} title="补偿增益（半增益规则）">
            <GainCurveChart left={config.ears.LEFT} right={config.ears.RIGHT} />
          </Card>
        </Col>
      </Row>

      <Card
        bordered={false}
        title="实测双耳频率响应"
        extra={<Typography.Text type="secondary">由 BiquadFilter 实测，非示意图</Typography.Text>}
      >
        <ResponseCurveChart config={config} />
        <Typography.Text type="secondary">
          该曲线为 EQ 链 + 前置增益的幅度响应；压缩与限幅是时变非线性环节，不在频响内。
        </Typography.Text>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <Card bordered={false} title="左耳各频点补偿">
            <Table
              size="small"
              rowKey="frequency"
              pagination={false}
              columns={bandColumns}
              dataSource={config.ears.LEFT?.eqBands ?? []}
            />
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card bordered={false} title="右耳各频点补偿">
            <Table
              size="small"
              rowKey="frequency"
              pagination={false}
              columns={bandColumns}
              dataSource={config.ears.RIGHT?.eqBands ?? []}
            />
          </Card>
        </Col>
      </Row>

      <Card bordered={false} title="配置内容（供桌面端消费）">
        <Collapse
          items={[
            {
              key: 'json',
              label: '展开完整 JSON',
              children: <pre className="config-json">{JSON.stringify(config, null, 2)}</pre>,
            },
          ]}
        />
      </Card>

      <Alert
        type="warning"
        showIcon
        message="使用边界"
        description={
          <ul className="plain-list">
            {config.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        }
      />
    </Space>
  );
}
