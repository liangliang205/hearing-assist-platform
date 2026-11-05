import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Input,
  Progress,
  Row,
  Segmented,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useNavigate } from 'react-router-dom';
import { hearingApi } from '../api/endpoints';
import { ensureAudioReady } from '../audio/audioEngine';
import { playTone, stopTone } from '../audio/tonePlayer';
import { AudiogramChart, GainCurveChart } from '../components/charts';
import { EAR_LABELS, type CompensationConfig, type Ear, type HearingResult } from '../types';

const FREQUENCIES = [250, 500, 1000, 2000, 4000, 8000];
const START_LEVEL = 40;
const MAX_LEVEL = 90;
const MAX_PRESENTATIONS = 16;

type Scope = 'BOTH' | 'LEFT' | 'RIGHT';
type Phase = 'intro' | 'testing' | 'between' | 'done';

interface Answer {
  level: number;
  heard: boolean;
}

interface HistoryRow {
  frequency: number;
  threshold: number | null;
}

interface Session {
  frequencyIndex: number;
  level: number;
  presentations: number;
  answered: Answer[];
  heardLevels: number[];
  notHeardLevels: number[];
  threshold: number | null;
  done: boolean;
  history: HistoryRow[];
}

function createSession(frequencyIndex: number, history: HistoryRow[] = []): Session {
  return {
    frequencyIndex,
    level: START_LEVEL,
    presentations: 0,
    answered: [],
    heardLevels: [],
    notHeardLevels: [],
    threshold: null,
    done: false,
    history,
  };
}

function formatFrequency(frequency: number): string {
  return frequency >= 1000 ? `${frequency / 1000} kHz` : `${frequency} Hz`;
}

export function HearingTestPage() {
  const navigate = useNavigate();
  const [scope, setScope] = useState<Scope>('BOTH');
  const [queue, setQueue] = useState<Ear[]>([]);
  const [earIndex, setEarIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>('intro');
  const [session, setSession] = useState<Session>(() => createSession(0));
  const [presenting, setPresenting] = useState(false);
  const [starting, setStarting] = useState(false);
  const [deviceNote, setDeviceNote] = useState('');
  const [config, setConfig] = useState<CompensationConfig | null>(null);

  const testIdsRef = useRef<Partial<Record<Ear, string>>>({});
  const resultsRef = useRef<HearingResult[]>([]);
  const presentingRef = useRef(false);
  const sessionRef = useRef(session);
  sessionRef.current = session;

  const currentEar: Ear = queue[earIndex] ?? 'LEFT';

  const present = useCallback(async (frequency: number, level: number) => {
    if (presentingRef.current) return;
    presentingRef.current = true;
    setPresenting(true);
    try {
      await playTone({ frequency, levelDbHl: level });
    } catch (error) {
      message.error(error instanceof Error ? error.message : '测试音播放失败');
    } finally {
      presentingRef.current = false;
      setPresenting(false);
    }
  }, []);

  useEffect(() => {
    if (phase !== 'testing' || session.done) return;
    void present(FREQUENCIES[session.frequencyIndex], session.level);
  }, [phase, session.frequencyIndex, session.level, session.done, present]);

  useEffect(
    () => () => {
      stopTone();
    },
    [],
  );

  const beginEar = async (ear: Ear) => {
    const { test } = await hearingApi.createTest(ear, deviceNote.trim() || undefined);
    testIdsRef.current[ear] = test.id;
    resultsRef.current = [];
    setSession(createSession(0));
    setPhase('testing');
  };

  const start = async () => {
    setStarting(true);
    try {
      await ensureAudioReady();
      const ears: Ear[] = scope === 'BOTH' ? ['LEFT', 'RIGHT'] : [scope];
      setQueue(ears);
      setEarIndex(0);
      setConfig(null);
      testIdsRef.current = {};
      await beginEar(ears[0]);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '初始化失败');
    } finally {
      setStarting(false);
    }
  };

  const finishEar = async (ear: Ear) => {
    const testId = testIdsRef.current[ear];
    if (!testId) return;
    try {
      const response = await hearingApi.submitResults(
        testId,
        resultsRef.current,
        true,
        deviceNote.trim() || undefined,
      );
      setConfig(response.config ?? null);
      setPhase(earIndex + 1 < queue.length ? 'between' : 'done');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '提交结果失败');
      setPhase('testing');
    }
  };

  const answer = (heard: boolean) => {
    const current = sessionRef.current;
    if (phase !== 'testing' || current.done || presentingRef.current) return;

    const frequency = FREQUENCIES[current.frequencyIndex];
    resultsRef.current = [...resultsRef.current, { frequency, level: current.level, heard }];

    const heardLevels = heard ? [...current.heardLevels, current.level] : current.heardLevels;
    const notHeardLevels = heard ? current.notHeardLevels : [...current.notHeardLevels, current.level];
    const presentations = current.presentations + 1;
    const answered = [...current.answered, { level: current.level, heard }];
    const nextLevel = heard ? current.level - 10 : current.level + 5;

    // 终止条件：形成 5 dB 的「未听到→听到」包夹，或越界、重复、次数用尽
    const bracketed = heard && notHeardLevels.some((missed) => current.level - missed === 5);
    const outOfRange = nextLevel < 0 || nextLevel > MAX_LEVEL;
    const revisited = answered.some((item) => item.level === nextLevel);
    const exhausted = presentations >= MAX_PRESENTATIONS;
    const done = bracketed || outOfRange || revisited || exhausted;
    const threshold = done ? (heardLevels.length ? Math.min(...heardLevels) : null) : null;

    const updated: Session = {
      ...current,
      presentations,
      answered,
      heardLevels,
      notHeardLevels,
      done,
      threshold,
    };
    setSession(updated);

    if (!done) return;

    const history = [...current.history, { frequency, threshold }];
    const nextIndex = current.frequencyIndex + 1;

    if (nextIndex < FREQUENCIES.length) {
      window.setTimeout(() => {
        setSession({ ...createSession(nextIndex), history });
      }, 450);
      return;
    }

    setSession({ ...updated, history });
    void finishEar(currentEar);
  };

  const continueNextEar = async () => {
    const nextIndex = earIndex + 1;
    if (nextIndex >= queue.length) {
      setPhase('done');
      return;
    }
    setEarIndex(nextIndex);
    try {
      await ensureAudioReady();
      await beginEar(queue[nextIndex]);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '创建下一只耳的自测失败');
    }
  };

  const abort = () => {
    stopTone();
    setPhase('intro');
    setSession(createSession(0));
    resultsRef.current = [];
    testIdsRef.current = {};
    setQueue([]);
    setEarIndex(0);
  };

  const historyColumns: ColumnsType<HistoryRow> = [
    { title: '频率', dataIndex: 'frequency', render: (value: number) => formatFrequency(value) },
    {
      title: '听阈',
      dataIndex: 'threshold',
      render: (value: number | null) =>
        value === null ? <Tag color="orange">未测出</Tag> : <span>{value} dB HL</span>,
    },
  ];

  if (phase === 'intro') {
    return (
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Card bordered={false} title="纯音听力自测">
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="开始前请确认"
            description={
              <ul className="plain-list">
                <li>佩戴你平时使用的耳机，尽量在安静环境中进行。</li>
                <li>把系统音量调到「平时听音乐」的舒适音量，并保持全程不变。</li>
                <li>每个频点会反复播放不同强度的纯音，听到点「听到了」，没听到点「没听到」。</li>
                <li>左右耳分别独立测听，单耳约 3～5 分钟。</li>
              </ul>
            }
          />
          <Space direction="vertical" size={12} style={{ width: '100%', maxWidth: 520 }}>
            <div>
              <Typography.Text strong>测听范围</Typography.Text>
              <div style={{ marginTop: 6 }}>
                <Segmented
                  value={scope}
                  onChange={(value) => setScope(value as Scope)}
                  options={[
                    { label: '双耳依次', value: 'BOTH' },
                    { label: '仅左耳', value: 'LEFT' },
                    { label: '仅右耳', value: 'RIGHT' },
                  ]}
                />
              </div>
            </div>
            <div>
              <Typography.Text strong>设备备注（可选）</Typography.Text>
              <Input
                style={{ marginTop: 6 }}
                value={deviceNote}
                onChange={(event) => setDeviceNote(event.target.value)}
                placeholder="例如：iPhone 有线耳机 / 联想笔记本外放"
                maxLength={200}
              />
            </div>
            <Button type="primary" size="large" loading={starting} onClick={start}>
              开始测听
            </Button>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              网页端无法做声学校准，结果用于个性化补偿与前后对比，不作为医疗诊断依据。
            </Typography.Text>
          </Space>
        </Card>
      </Space>
    );
  }

  if (phase === 'testing') {
    const frequency = FREQUENCIES[session.frequencyIndex];
    const progress = Math.round((session.frequencyIndex / FREQUENCIES.length) * 100);

    return (
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Card bordered={false}>
          <Row gutter={[16, 16]} align="middle">
            <Col flex="auto">
              <Typography.Title level={4} style={{ margin: 0 }}>
                <Tag color={currentEar === 'LEFT' ? 'blue' : 'red'}>{EAR_LABELS[currentEar]}</Tag>
                第 {session.frequencyIndex + 1} / {FREQUENCIES.length} 个频点：
                {formatFrequency(frequency)}
              </Typography.Title>
              <Typography.Text type="secondary">
                当前强度 <Tag color="blue">{session.level} dB HL</Tag>
                {presenting ? <Tag color="processing">正在播放…</Tag> : <Tag>等待作答</Tag>}
              </Typography.Text>
            </Col>
            <Col>
              <Progress
                type="circle"
                percent={progress}
                size={72}
                format={() => `${session.frequencyIndex}/${FREQUENCIES.length}`}
              />
            </Col>
          </Row>
          <Divider />
          <Space size={16} wrap>
            <Button
              type="primary"
              size="large"
              disabled={presenting}
              onClick={() => answer(true)}
              style={{ minWidth: 140 }}
            >
              听到了
            </Button>
            <Button size="large" disabled={presenting} onClick={() => answer(false)} style={{ minWidth: 140 }}>
              没听到
            </Button>
            <Button onClick={() => void present(frequency, session.level)} disabled={presenting}>
              重听一次
            </Button>
            <Button danger type="text" onClick={abort}>
              中止
            </Button>
          </Space>
          <Typography.Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0 }}>
            提示：测试音持续约 1.2 秒。请在提示音结束后再作答；不确定时以「没听到」为准更稳妥。
          </Typography.Paragraph>
        </Card>

        {session.history.length > 0 ? (
          <Card bordered={false} title={`${EAR_LABELS[currentEar]}已完成的频点`}>
            <Table
              size="small"
              rowKey="frequency"
              pagination={false}
              columns={historyColumns}
              dataSource={session.history}
            />
          </Card>
        ) : null}
      </Space>
    );
  }

  if (phase === 'between') {
    const nextEar = queue[earIndex + 1];
    const doneEarConfig = config?.ears[currentEar] ?? null;

    return (
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Card bordered={false}>
          <Typography.Title level={4}>
            {EAR_LABELS[currentEar]}已完成
            {doneEarConfig ? `：${doneEarConfig.grade.label}` : ''}
          </Typography.Title>
          <Typography.Paragraph type="secondary">
            接下来测{nextEar ? EAR_LABELS[nextEar] : '下一只耳'}。请把耳机换到另一侧（或调整佩戴），保持音量不变。
          </Typography.Paragraph>
          <Space>
            <Button type="primary" size="large" onClick={() => void continueNextEar()}>
              开始测{EAR_LABELS[nextEar]}
            </Button>
            <Button type="text" onClick={() => setPhase('done')}>
              跳过，先看结果
            </Button>
          </Space>
        </Card>
      </Space>
    );
  }

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card bordered={false}>
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            自测完成
          </Typography.Title>
          <Typography.Text type="secondary">
            已生成双耳补偿配置，可直接用于增强预览，也可导出给后续桌面端使用。
          </Typography.Text>
          <Space>
            <Button type="primary" onClick={() => navigate('/profile')}>
              查看听力档案
            </Button>
            <Button onClick={() => navigate('/preview')}>去增强预览</Button>
            <Button type="text" onClick={abort}>
              重新测一次
            </Button>
          </Space>
        </Space>
      </Card>

      {config ? (
        <>
          <Row gutter={[16, 16]}>
            <Col xs={24} sm={12} lg={6}>
              <Card bordered={false}>
                <Statistic title="整体分级（较好耳）" value={config.overallGrade.label} valueStyle={{ fontSize: 18 }} />
              </Card>
            </Col>
            {(['LEFT', 'RIGHT'] as Ear[]).map((ear) => {
              const earConfig = config.ears[ear];
              return (
                <Col xs={24} sm={12} lg={6} key={ear}>
                  <Card bordered={false}>
                    <Statistic
                      title={`${EAR_LABELS[ear]} PTA`}
                      value={earConfig?.ptaDbHl ?? '未测听'}
                      suffix={earConfig?.ptaDbHl ? 'dB HL' : ''}
                    />
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {earConfig ? earConfig.grade.label : '该侧尚未测听'}
                    </Typography.Text>
                  </Card>
                </Col>
              );
            })}
          </Row>

          <Row gutter={[16, 16]}>
            <Col xs={24} lg={12}>
              <Card bordered={false} title="听力曲线（右耳红圈 / 左耳蓝方）">
                <AudiogramChart left={config.ears.LEFT?.audiogram ?? null} right={config.ears.RIGHT?.audiogram ?? null} />
              </Card>
            </Col>
            <Col xs={24} lg={12}>
              <Card bordered={false} title="推荐补偿增益">
                <GainCurveChart left={config.ears.LEFT} right={config.ears.RIGHT} />
              </Card>
            </Col>
          </Row>

          <Card bordered={false} title="明细">
            <Descriptions size="small" column={2}>
              {(['LEFT', 'RIGHT'] as Ear[]).map((ear) => {
                const earConfig = config.ears[ear];
                if (!earConfig) {
                  return (
                    <Descriptions.Item key={ear} label={EAR_LABELS[ear]}>
                      未测听
                    </Descriptions.Item>
                  );
                }
                return (
                  <Descriptions.Item key={ear} label={EAR_LABELS[ear]}>
                    {earConfig.audiogram
                      .map(
                        (item) =>
                          `${formatFrequency(item.frequency)} ${
                            item.thresholdDbHl === null ? '未测出' : `${item.thresholdDbHl}`
                          }`,
                      )
                      .join('　')}
                  </Descriptions.Item>
                );
              })}
            </Descriptions>
          </Card>
        </>
      ) : null}
    </Space>
  );
}
