import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Collapse,
  Descriptions,
  Empty,
  Input,
  List,
  Popconfirm,
  Row,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useNavigate } from 'react-router-dom';
import {
  buildEarCompensation,
  EAR_LABELS,
  effectiveGainDb,
  type Ear,
  type EarCompensation,
} from '@hearlink/domain';
import { AudiogramChart, GainCurveChart, ResponseCurveChart } from '../components/charts';
import { autoSync } from '../api/sync';
import { localStore } from '../store';
import { applyEar, configFromProfile, emptyProfile, profileSummary } from '../store/profile';
import type { ProfileRecord } from '../store/types';

function formatFrequency(frequency: number): string {
  return frequency >= 1000 ? `${frequency / 1000} kHz` : `${frequency} Hz`;
}

interface GainRow {
  frequency: number;
  threshold: number | null;
  effective: number;
}

/** 有效增益 = 整条 EQ 链在该频点的实际响应（含相邻频带叠加与前置增益）。 */
function gainRows(ear: EarCompensation): GainRow[] {
  return [...ear.audiogram]
    .sort((a, b) => a.frequency - b.frequency)
    .map((item) => ({
      frequency: item.frequency,
      threshold: item.thresholdDbHl,
      effective: Number(effectiveGainDb(ear, item.frequency).toFixed(1)),
    }));
}

const gainColumns: ColumnsType<GainRow> = [
  { title: '频点', dataIndex: 'frequency', render: (value: number) => formatFrequency(value) },
  {
    title: '听阈',
    dataIndex: 'threshold',
    render: (value: number | null) => (value === null ? '未测出' : `${value} dB HL`),
  },
  {
    title: '有效增益',
    dataIndex: 'effective',
    render: (value: number) => `${value} dB`,
  },
];

export function ProfilePage() {
  const navigate = useNavigate();
  const [profiles, setProfiles] = useState<ProfileRecord[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, active] = await Promise.all([
        localStore.listProfiles(),
        localStore.getActiveProfile(),
      ]);
      setProfiles(list);
      setActiveId(active?.id ?? null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const active = profiles.find((item) => item.id === activeId) ?? null;
  const config = configFromProfile(active);

  const activate = async (id: string) => {
    await localStore.setActiveProfile(id);
    await load();
  };

  const createProfile = async () => {
    const profile = emptyProfile(`档案 ${profiles.length + 1}`);
    await localStore.saveProfile(profile);
    await localStore.setActiveProfile(profile.id);
    await load();
    message.success('已新建档案');
  };

  const saveRename = async () => {
    if (!renaming) return;
    const target = profiles.find((item) => item.id === renaming.id);
    if (!target) return;
    const name = renaming.name.trim() || target.name;
    await localStore.saveProfile({ ...target, name, updatedAt: new Date().toISOString() });
    setRenaming(null);
    await load();
  };

  const removeProfile = async (id: string) => {
    await localStore.deleteProfile(id);
    await load();
    message.success('已删除档案');
  };

  /** 用最近一次测听记录重新计算补偿参数（处方规则变更后可用它刷新旧档案）。 */
  const rebuildCompensation = async () => {
    const current = await localStore.getActiveProfile();
    if (!current) return;

    const sessions = await localStore.listSessions();
    let updated = current;
    let rebuilt = 0;

    for (const ear of ['LEFT', 'RIGHT'] as Ear[]) {
      const latest = sessions.find(
        (item) => item.ear === ear && item.finishedAt && item.results.length > 0,
      );
      if (!latest) continue;

      const compensation = buildEarCompensation({
        ear,
        testId: latest.id,
        results: latest.results,
      });
      updated = applyEar(updated, ear, compensation);
      rebuilt += 1;
    }

    if (rebuilt === 0) {
      message.warning('没有找到可用的测听记录，请先完成一次测听');
      return;
    }

    await localStore.saveProfile(updated);
    void autoSync(updated);
    await load();
    message.success(`已按最近测听记录重算 ${rebuilt} 只耳的补偿参数`);
  };

  const copyConfig = async () => {
    if (!config) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(config, null, 2));
      message.success('补偿配置已复制到剪贴板');
    } catch {
      message.error('复制失败，请展开下方 JSON 手动复制');
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card
        bordered={false}
        title="听力档案"
        extra={
          <Space>
            <Button onClick={createProfile}>新建档案</Button>
            <Button type="primary" onClick={() => navigate('/hearing-test')}>
              去测听
            </Button>
          </Space>
        }
        loading={loading}
      >
        {profiles.length === 0 ? (
          <Empty description="还没有档案。点击「新建档案」或直接去测听，测完会自动创建。" />
        ) : (
          <List
            dataSource={profiles}
            rowKey="id"
            renderItem={(item) => (
              <List.Item
                actions={[
                  item.id === activeId ? (
                    <Tag color="blue" key="active">
                      当前使用
                    </Tag>
                  ) : (
                    <Button key="use" size="small" onClick={() => void activate(item.id)}>
                      设为当前
                    </Button>
                  ),
                  <Button
                    key="rename"
                    size="small"
                    type="link"
                    onClick={() => setRenaming({ id: item.id, name: item.name })}
                  >
                    重命名
                  </Button>,
                  <Popconfirm
                    key="delete"
                    title="删除这份档案？"
                    onConfirm={() => void removeProfile(item.id)}
                  >
                    <Button size="small" type="link" danger>
                      删除
                    </Button>
                  </Popconfirm>,
                ]}
              >
                <List.Item.Meta
                  title={
                    renaming?.id === item.id ? (
                      <Space>
                        <Input
                          size="small"
                          value={renaming.name}
                          onChange={(event) => setRenaming({ id: item.id, name: event.target.value })}
                          onPressEnter={() => void saveRename()}
                          autoFocus
                        />
                        <Button size="small" type="primary" onClick={() => void saveRename()}>
                          保存
                        </Button>
                      </Space>
                    ) : (
                      item.name
                    )
                  }
                  description={
                    <Space size={12}>
                      <span>{profileSummary(item)}</span>
                      <span>更新于 {new Date(item.updatedAt).toLocaleString()}</span>
                    </Space>
                  }
                />
              </List.Item>
            )}
          />
        )}
      </Card>

      {!config ? (
        <Card bordered={false}>
          <Empty description="当前档案还没有测听数据，完成一次双耳自测即可生成曲线。">
            <Button type="primary" onClick={() => navigate('/hearing-test')}>
              去测听
            </Button>
          </Empty>
        </Card>
      ) : (
        <>
          <Card bordered={false}>
            <Row gutter={[16, 16]} align="middle">
              <Col flex="auto">
                <Typography.Title level={4} style={{ margin: 0 }}>
                  {active?.name}
                </Typography.Title>
                <Typography.Text type="secondary">
                  整体分级：<Tag color="blue">{config.overallGrade.label}</Tag>
                  取较好耳　·　配置版本 v{config.version}
                </Typography.Text>
              </Col>
              <Col>
                <Space>
                  <Button onClick={() => void rebuildCompensation()}>重算补偿参数</Button>
                  <Button onClick={copyConfig}>复制配置 JSON</Button>
                  <Button type="primary" onClick={() => navigate('/enhance')}>
                    声音增强
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
              <Descriptions.Item label="来源">
                {(['LEFT', 'RIGHT'] as Ear[])
                  .map((ear) => {
                    const earConfig = config.ears[ear];
                    return earConfig?.sourceTestId
                      ? `${EAR_LABELS[ear]} ${earConfig.sourceTestId.slice(0, 8)}`
                      : '';
                  })
                  .filter(Boolean)
                  .join(' / ') || '本地测听'}
              </Descriptions.Item>
            </Descriptions>
          </Card>

          <Row gutter={[16, 16]}>
            <Col xs={24} lg={12}>
              <Card bordered={false} title="听力曲线（右耳红圈 / 左耳蓝方）">
                <AudiogramChart
                  left={config.ears.LEFT?.audiogram ?? null}
                  right={config.ears.RIGHT?.audiogram ?? null}
                />
              </Card>
            </Col>
            <Col xs={24} lg={12}>
              <Card bordered={false} title="有效补偿增益（按听力曲线处方）">
                <GainCurveChart left={config.ears.LEFT} right={config.ears.RIGHT} />
              </Card>
            </Col>
          </Row>

          <Card
            bordered={false}
            title="实测双耳频率响应"
            extra={<Typography.Text type="secondary">由 BiquadFilter 实测</Typography.Text>}
          >
            <ResponseCurveChart config={config} />
          </Card>

          <Row gutter={[16, 16]}>
            <Col xs={24} lg={12}>
              <Card bordered={false} title="左耳补偿（听阈 → 有效增益）">
                <Table
                  size="small"
                  rowKey="frequency"
                  pagination={false}
                  columns={gainColumns}
                  dataSource={config.ears.LEFT ? gainRows(config.ears.LEFT) : []}
                />
              </Card>
            </Col>
            <Col xs={24} lg={12}>
              <Card bordered={false} title="右耳补偿（听阈 → 有效增益）">
                <Table
                  size="small"
                  rowKey="frequency"
                  pagination={false}
                  columns={gainColumns}
                  dataSource={config.ears.RIGHT ? gainRows(config.ears.RIGHT) : []}
                />
              </Card>
            </Col>
          </Row>

          <Typography.Paragraph type="secondary" style={{ fontSize: 12 }}>
            有效增益是整条 EQ 链在该频点的实际响应，已包含相邻频带叠加与前置增益，和试听/导出效果一致。
          </Typography.Paragraph>

          <Card bordered={false} title="配置内容（系统级处理端读取此 JSON）">
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
        </>
      )}
    </Space>
  );
}
