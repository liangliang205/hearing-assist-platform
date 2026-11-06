import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Descriptions,
  Divider,
  Input,
  Progress,
  Radio,
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
import {
  answerStaircase,
  answerVerification,
  buildEarCompensation,
  clinicalOrder,
  createStaircase,
  createVerification,
  currentVerificationStimulus,
  describeHearing,
  EAR_LABELS,
  frequenciesFor,
  isAscending,
  MAX_LEVEL_DB,
  STIMULUS_HINTS,
  STIMULUS_LABELS,
  TEST_FREQUENCY_SETS,
  THRESHOLD_STIMULUS,
  VERIFICATION_STIMULI,
  type CompensationConfig,
  type Ear,
  type HearingResult,
  type StaircaseState,
  type TestFrequencySet,
  type VerificationState,
} from '@hearlink/domain';
import { ensureAudioReady } from '../audio/audioEngine';
import { playTone, stopTone, type ToneEar } from '../audio/tonePlayer';
import { autoSync } from '../api/sync';
import { AudiogramChart, GainCurveChart } from '../components/charts';
import { localStore } from '../store';
import { applyEar, configFromProfile, emptyProfile } from '../store/profile';

const CALIBRATION_LEVEL_DB = 40;
const CHANNEL_CHECK_LEVEL_DB = 50;
const CALIBRATION_SETTING_KEY = 'calibrationGain';
const FREQUENCY_SET_SETTING_KEY = 'testFrequencySet';

type Phase = 'setup' | 'testing' | 'between' | 'done';
type Scope = 'BOTH' | 'LEFT' | 'RIGHT';

/** 本次测听新建档案的名字：带日期时间，便于在档案列表里区分。 */
function testProfileName(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `测听 ${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function formatFrequency(frequency: number): string {
  return frequency >= 1000 ? `${frequency / 1000} kHz` : `${frequency} Hz`;
}

/** 测听完成后的通俗解读：告诉用户各频段听音情况与影响。 */
function HearingInsights({ config }: { config: CompensationConfig }) {
  const ears: Ear[] = ['LEFT', 'RIGHT'];
  const tips = Array.from(
    new Set(
      ears.flatMap((ear) => {
        const earConfig = config.ears[ear];
        return earConfig ? describeHearing(earConfig.audiogram).tips : [];
      }),
    ),
  );

  return (
    <Card bordered={false} title="结果解读">
      <Space direction="vertical" size={14} style={{ width: '100%' }}>
        {ears.map((ear) => {
          const earConfig = config.ears[ear];
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
              <Space style={{ marginBottom: 4 }}>
                <Tag color={ear === 'LEFT' ? 'blue' : 'red'}>{EAR_LABELS[ear]}</Tag>
                <Typography.Text strong>{description.headline}</Typography.Text>
              </Space>
              <ul className="plain-list">
                {description.bands.map((band) => (
                  <li key={band.key}>
                    <Typography.Text type={band.severity === 'good' ? 'secondary' : undefined}>
                      {band.text}
                    </Typography.Text>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}

        <Alert
          type="info"
          showIcon
          message="使用建议"
          description={
            <ul className="plain-list">
              {tips.map((tip) => (
                <li key={tip}>{tip}</li>
              ))}
            </ul>
          }
        />
      </Space>
    </Card>
  );
}

export function HearingTestPage() {
  const navigate = useNavigate();

  // —— 流程状态
  const [phase, setPhase] = useState<Phase>('setup');
  const [scope, setScope] = useState<Scope>('BOTH');
  const [queue, setQueue] = useState<Ear[]>([]);
  const [earIndex, setEarIndex] = useState(0);
  const [config, setConfig] = useState<CompensationConfig | null>(null);

  // —— 准备阶段
  const [deviceNote, setDeviceNote] = useState('');
  const [calibration, setCalibration] = useState(1);
  const [frequencySet, setFrequencySet] = useState<TestFrequencySet>('standard');
  const [channelCheck, setChannelCheck] = useState<Record<Ear, boolean>>({
    LEFT: false,
    RIGHT: false,
  });

  // 当前模式对应的测听频点（标准 6 点 / 精细 9 点），按临床顺序：1000 Hz 起始
  const frequencies = clinicalOrder(frequenciesFor(frequencySet));

  // —— 测听阶段
  const [staircase, setStaircase] = useState<StaircaseState>(() =>
    createStaircase(clinicalOrder(frequenciesFor('standard'))[0]),
  );
  const [verification, setVerification] = useState<VerificationState | null>(null);
  const [frequencyIndex, setFrequencyIndex] = useState(0);
  const [presenting, setPresenting] = useState(false);
  const [liveThresholds, setLiveThresholds] = useState<Record<number, number | null>>({});
  const [starting, setStarting] = useState(false);
  /** 本次测听新建的档案名，用于结束页提示。 */
  const [createdProfileName, setCreatedProfileName] = useState<string | null>(null);

  const currentEar: Ear = queue[earIndex] ?? 'LEFT';

  // 用 ref 镜像可变状态，保证回调与键盘监听不会读到旧值
  const staircaseRef = useRef(staircase);
  staircaseRef.current = staircase;
  const frequencyIndexRef = useRef(frequencyIndex);
  frequencyIndexRef.current = frequencyIndex;
  const currentEarRef = useRef(currentEar);
  currentEarRef.current = currentEar;
  const calibrationRef = useRef(calibration);
  calibrationRef.current = calibration;
  const frequenciesRef = useRef<readonly number[]>(frequencies);
  frequenciesRef.current = frequencies;
  const verificationRef = useRef<VerificationState | null>(verification);
  verificationRef.current = verification;
  const presentingRef = useRef(false);
  const sessionIdsRef = useRef<Partial<Record<Ear, string>>>({});
  const resultsRef = useRef<HearingResult[]>([]);
  /** 本次测听新建的档案 id（每测一次建一份，不覆盖已有档案）。 */
  const testProfileIdRef = useRef<string | null>(null);
  /** 测听开始前生效的档案，取消测听时用于恢复。 */
  const previousActiveIdRef = useRef<string | null>(null);

  // 读取上次的校准系数
  useEffect(() => {
    void (async () => {
      const saved = await localStore.getSetting(CALIBRATION_SETTING_KEY);
      if (saved) {
        const value = Number(saved);
        if (Number.isFinite(value) && value > 0) setCalibration(value);
      }
    })();
  }, []);

  // 记住上次选择的测听模式
  useEffect(() => {
    void (async () => {
      const saved = await localStore.getSetting(FREQUENCY_SET_SETTING_KEY);
      if (saved === 'standard' || saved === 'extended') setFrequencySet(saved);
    })();
  }, []);

  const selectFrequencySet = async (next: TestFrequencySet) => {
    setFrequencySet(next);
    await localStore.setSetting(FREQUENCY_SET_SETTING_KEY, next);
  };

  const playCalibration = async () => {
    try {
      await ensureAudioReady();
      await playTone({
        frequency: 1000,
        levelDbHl: CALIBRATION_LEVEL_DB,
        ear: 'BOTH',
        calibrationGain: calibrationRef.current,
      });
    } catch (error) {
      message.error(error instanceof Error ? error.message : '播放失败');
    }
  };

  const checkChannel = async (ear: Ear) => {
    try {
      await ensureAudioReady();
      await playTone({
        frequency: 1000,
        levelDbHl: CHANNEL_CHECK_LEVEL_DB,
        ear: ear as ToneEar,
        calibrationGain: calibrationRef.current,
      });
      setChannelCheck((prev) => ({ ...prev, [ear]: true }));
    } catch (error) {
      message.error(error instanceof Error ? error.message : '播放失败');
    }
  };

  const playCurrent = useCallback(async () => {
    if (presentingRef.current) return;

    const activeVerification = verificationRef.current;
    if (activeVerification?.done) return;

    const state = staircaseRef.current;
    if (!activeVerification && state.done) return;

    const frequency = activeVerification ? activeVerification.frequency : state.frequency;
    const level = activeVerification ? activeVerification.level : state.level;
    const stimulus = activeVerification
      ? currentVerificationStimulus(activeVerification)
      : THRESHOLD_STIMULUS;

    presentingRef.current = true;
    setPresenting(true);
    try {
      await playTone({
        frequency,
        levelDbHl: level,
        ear: currentEarRef.current as ToneEar,
        stimulus,
        calibrationGain: calibrationRef.current,
      });
    } catch (error) {
      message.error(error instanceof Error ? error.message : '测试音播放失败');
    } finally {
      presentingRef.current = false;
      setPresenting(false);
    }
  }, []);

  // 每个「音型 × 强度 × 呈现次数」组合自动播放一次
  useEffect(() => {
    if (phase !== 'testing') return;
    if (verification?.done) return;
    if (!verification && staircase.done) return;
    void playCurrent();
  }, [
    phase,
    staircase.frequency,
    staircase.level,
    staircase.presentations,
    staircase.done,
    verification,
    playCurrent,
  ]);

  useEffect(
    () => () => {
      stopTone();
    },
    [],
  );

  const finishEar = useCallback(async () => {
    const ear = currentEarRef.current;
    const sessionId = sessionIdsRef.current[ear];
    if (!sessionId) return;

    try {
      const results = resultsRef.current;
      await localStore.saveResults(sessionId, results);
      await localStore.completeSession(sessionId);

      const compensation = buildEarCompensation({ ear, testId: sessionId, results });
      // 写进本次测听新建的档案，而不是覆盖当前生效档案
      const profileId = testProfileIdRef.current;
      const base = profileId
        ? await localStore.getProfile(profileId)
        : await localStore.getActiveProfile();
      const updated = applyEar(base, ear, compensation);
      await localStore.saveProfile(updated);

      // 登录状态下自动把新档案同步到云端（游客模式内部会直接跳过）
      void autoSync(updated);

      setConfig(configFromProfile(updated));
      // 根据当前耳在队列中的位置决定下一步
      const isLast = currentEarRef.current === queue[queue.length - 1];
      setPhase(isLast ? 'done' : 'between');
    } catch (error) {
      message.error(error instanceof Error ? error.message : '保存测听结果失败');
      setPhase('testing');
    }
  }, [queue]);

  /**
   * 一个频点结束时收尾：
   * 用复验后的阈值覆盖该频点的作答轨迹，再进入下一个频点。
   * 这样 computeThresholds 取到的是复验确认值，而不是阶梯法中途的最低值。
   */
  const finishFrequency = useCallback(
    (frequency: number, threshold: number | null) => {
      const finalized = resultsRef.current
        .filter((item) => item.frequency !== frequency)
        .concat([
          { frequency, level: threshold ?? MAX_LEVEL_DB, heard: threshold !== null },
        ]);
      resultsRef.current = finalized;

      const sessionId = sessionIdsRef.current[currentEarRef.current];
      if (sessionId) void localStore.saveResults(sessionId, finalized);
      setLiveThresholds((prev) => ({ ...prev, [frequency]: threshold }));

      const nextIndex = frequencyIndexRef.current + 1;
      if (nextIndex < frequenciesRef.current.length) {
        setFrequencyIndex(nextIndex);
        setStaircase(createStaircase(frequenciesRef.current[nextIndex]));
        setVerification(null);
      } else {
        void finishEar();
      }
    },
    [finishEar],
  );

  const answer = useCallback(
    (heard: boolean) => {
      if (phase !== 'testing' || presentingRef.current) return;

      // —— 复验阶段：连续纯音 / 啭音确认阈值
      const activeVerification = verificationRef.current;
      if (activeVerification) {
        if (activeVerification.done) return;

        const nextVerification = answerVerification(activeVerification, heard);
        setVerification(nextVerification);

        if (nextVerification.done) {
          window.setTimeout(
            () => finishFrequency(nextVerification.frequency, nextVerification.threshold),
            400,
          );
        }
        return;
      }

      // —— 判阈阶段：脉冲纯音阶梯法
      const current = staircaseRef.current;
      if (current.done) return;

      resultsRef.current = [
        ...resultsRef.current,
        { frequency: current.frequency, level: current.level, heard },
      ];

      const next = answerStaircase(current, heard);
      setStaircase(next);

      // 增量保存：中途关闭页面也不丢已测数据
      const sessionId = sessionIdsRef.current[currentEarRef.current];
      if (sessionId) void localStore.saveResults(sessionId, resultsRef.current);

      if (!next.done) return;

      setLiveThresholds((prev) => ({ ...prev, [current.frequency]: next.threshold }));

      // 判出阈值后进入复验；没测出则直接收尾
      const verificationState = createVerification(current.frequency, next.threshold);
      if (verificationState.done) {
        window.setTimeout(() => finishFrequency(current.frequency, null), 400);
      } else {
        setVerification(verificationState);
      }
    },
    [phase, finishFrequency],
  );

  // 键盘操作：空格/1 = 听到了，2 = 没听到，R = 重听
  useEffect(() => {
    if (phase !== 'testing') return;

    const handler = (event: KeyboardEvent) => {
      if (event.repeat) return;
      if (event.code === 'Space' || event.key === '1') {
        event.preventDefault();
        answer(true);
      } else if (event.key === '2') {
        event.preventDefault();
        answer(false);
      } else if (event.key.toLowerCase() === 'r') {
        event.preventDefault();
        void playCurrent();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [phase, answer, playCurrent]);

  const beginEar = async (ear: Ear) => {
    const record = await localStore.createSession(ear, deviceNote.trim() || null);
    sessionIdsRef.current[ear] = record.id;
    resultsRef.current = [];
    setLiveThresholds({});
    setFrequencyIndex(0);
    setStaircase(createStaircase(frequenciesRef.current[0]));
    setVerification(null);
    setPhase('testing');
  };

  const start = async () => {
    setStarting(true);
    try {
      await ensureAudioReady();
      await localStore.setSetting(CALIBRATION_SETTING_KEY, String(calibration));

      const ears: Ear[] = scope === 'BOTH' ? ['LEFT', 'RIGHT'] : [scope];
      setQueue(ears);
      setEarIndex(0);
      currentEarRef.current = ears[0];
      setConfig(null);
      sessionIdsRef.current = {};
      resultsRef.current = [];
      setLiveThresholds({});
      setFrequencyIndex(0);
      setStaircase(createStaircase(frequenciesRef.current[0]));
      setVerification(null);

      // 每次自测新建一份空档案，本次结果都写进它，已有档案不受影响
      previousActiveIdRef.current = (await localStore.getActiveProfile())?.id ?? null;
      const profile = emptyProfile(testProfileName());
      await localStore.saveProfile(profile);
      await localStore.setActiveProfile(profile.id);
      testProfileIdRef.current = profile.id;
      setCreatedProfileName(profile.name);

      const record = await localStore.createSession(ears[0], deviceNote.trim() || null);
      sessionIdsRef.current[ears[0]] = record.id;
      setPhase('testing');
    } catch (error) {
      // 初始化失败时把刚建的空档案清掉，别留下垃圾数据
      const profileId = testProfileIdRef.current;
      testProfileIdRef.current = null;
      if (profileId) {
        await localStore.deleteProfile(profileId);
        await localStore.setActiveProfile(previousActiveIdRef.current);
      }
      message.error(error instanceof Error ? error.message : '初始化失败');
    } finally {
      setStarting(false);
    }
  };

  const continueNextEar = async () => {
    const nextIndex = earIndex + 1;
    if (nextIndex >= queue.length) {
      setPhase('done');
      return;
    }
    setEarIndex(nextIndex);
    currentEarRef.current = queue[nextIndex];
    try {
      await ensureAudioReady();
      await beginEar(queue[nextIndex]);
    } catch (error) {
      message.error(error instanceof Error ? error.message : '创建下一只耳的自测失败');
    }
  };

  const abort = () => {
    stopTone();

    // 一个耳别都没测出来的空档案直接删掉，避免留下无用档案
    const profileId = testProfileIdRef.current;
    testProfileIdRef.current = null;
    void (async () => {
      if (!profileId) return;
      const profile = await localStore.getProfile(profileId);
      if (profile && !profile.left && !profile.right) {
        await localStore.deleteProfile(profileId);
        await localStore.setActiveProfile(previousActiveIdRef.current);
      }
    })();

    setPhase('setup');
    setQueue([]);
    setEarIndex(0);
    sessionIdsRef.current = {};
    resultsRef.current = [];
    setLiveThresholds({});
    setFrequencyIndex(0);
    setStaircase(createStaircase(frequenciesRef.current[0]));
    setVerification(null);
  };

  // —— 准备阶段
  if (phase === 'setup') {
    const checkedCount = Number(channelCheck.LEFT) + Number(channelCheck.RIGHT);
    const needsEarCheck =
      scope === 'BOTH' ? checkedCount < 2 : !channelCheck[scope as Ear];

    return (
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Card bordered={false} title="准备">
          <Alert
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
            message="开始前请确认"
            description={
              <ul className="plain-list">
                <li>佩戴耳机（不建议用外放），并在安静环境中进行。</li>
                <li>把系统音量调到「平时听音乐的舒适音量」，全程保持不变。</li>
                <li>测听时会单耳播放：测左耳时只有左声道出声，测右耳时只有右声道出声。</li>
                <li>
                  顺序从 1000 Hz 开始，再测高频、最后测低频；每个频点先用脉冲纯音判阈，
                  再用连续纯音和啭音各确认一次。
                </li>
                <li>建议先做右耳再做左耳，单耳约 4～7 分钟。</li>
              </ul>
            }
          />

          <Divider orientation="left" plain>
            ① 音量校准
          </Divider>
          <Space wrap align="center">
            <Button onClick={() => void playCalibration()}>播放校准音（1 kHz / 40 dB）</Button>
            <Typography.Text type="secondary">
              当前校准：{calibration === 1 ? '默认' : `${calibration > 1 ? '+' : ''}${(20 * Math.log10(calibration)).toFixed(0)} dB`}
            </Typography.Text>
            <Button size="small" onClick={() => setCalibration((value) => Math.max(0.25, value / 2))}>
              更轻
            </Button>
            <Button size="small" onClick={() => setCalibration((value) => Math.min(4, value * 2))}>
              更响
            </Button>
          </Space>
          <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
            听到即可，不需要很响。听不到就先调大系统音量；太刺耳就调小，然后点「更轻 / 更响」微调。
          </Typography.Paragraph>

          <Divider orientation="left" plain>
            ② 声道检查
          </Divider>
          <Space wrap align="center">
            <Button onClick={() => void checkChannel('LEFT')}>
              播放左耳
              {channelCheck.LEFT ? ' ✓' : ''}
            </Button>
            <Button onClick={() => void checkChannel('RIGHT')}>
              播放右耳
              {channelCheck.RIGHT ? ' ✓' : ''}
            </Button>
            <Checkbox checked={channelCheck.LEFT} disabled>
              左耳听到
            </Checkbox>
            <Checkbox checked={channelCheck.RIGHT} disabled>
              右耳听到
            </Checkbox>
          </Space>
          <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
            用于确认耳机左右没有戴反。若单侧完全听不到，也可以继续测另一侧。
          </Typography.Paragraph>

          <Divider orientation="left" plain>
            ③ 测听设置
          </Divider>
          <Space direction="vertical" size={12} style={{ width: '100%', maxWidth: 560 }}>
            <div>
              <Typography.Text strong>测听模式</Typography.Text>
              <div style={{ marginTop: 6 }}>
                <Radio.Group
                  value={frequencySet}
                  onChange={(event) =>
                    void selectFrequencySet(event.target.value as TestFrequencySet)
                  }
                >
                  <Space direction="vertical" size={8}>
                    {TEST_FREQUENCY_SETS.map((option) => (
                      <Radio key={option.key} value={option.key}>
                        <Space direction="vertical" size={0}>
                          <Typography.Text>{option.label}</Typography.Text>
                          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                            {option.description}
                          </Typography.Text>
                        </Space>
                      </Radio>
                    ))}
                  </Space>
                </Radio.Group>
              </div>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                本次将测：{frequencies.map((frequency) => formatFrequency(frequency)).join(' · ')}
              </Typography.Text>
            </div>
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
                placeholder="例如：iPhone 有线耳机 / 索尼 WH-1000XM4"
                maxLength={200}
              />
            </div>

            {needsEarCheck ? (
              <Alert
                type="warning"
                showIcon
                message="声道检查未完成"
                description="建议先分别播放左右耳确认佩戴正确，否则可能把左右耳测反。仍可直接开始。"
              />
            ) : null}

            <Button type="primary" size="large" loading={starting} onClick={start}>
              开始测听
            </Button>
          </Space>
        </Card>
      </Space>
    );
  }

  // —— 测听阶段
  if (phase === 'testing') {
    const frequency = verification?.frequency ?? staircase.frequency;
    const level = verification?.level ?? staircase.level;
    const stimulus = verification
      ? currentVerificationStimulus(verification)
      : THRESHOLD_STIMULUS;
    const doneCount = frequencyIndex;
    const percent = Math.round((doneCount / frequencies.length) * 100);
    const measured = Object.entries(liveThresholds).map(([key, value]) => ({
      frequency: Number(key),
      threshold: value,
    }));

    const thresholdColumns: ColumnsType<{ frequency: number; threshold: number | null }> = [
      {
        title: '频点',
        dataIndex: 'frequency',
        render: (value: number) => formatFrequency(value),
      },
      {
        title: '听阈',
        dataIndex: 'threshold',
        render: (value: number | null) =>
          value === null ? <Tag color="orange">未测出</Tag> : `${value} dB HL`,
      },
    ];

    return (
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Card bordered={false}>
          <Row gutter={[16, 16]} align="middle">
            <Col flex="auto">
              <Typography.Title level={4} style={{ margin: 0 }}>
                <Tag color={currentEar === 'LEFT' ? 'blue' : 'red'}>{EAR_LABELS[currentEar]}</Tag>
                第 {frequencyIndex + 1} / {frequencies.length} 个频点：{formatFrequency(frequency)}
              </Typography.Title>
              <Typography.Text type="secondary">
                当前强度 <Tag color="blue">{level} dB HL</Tag>
                <Tag color={verification ? 'purple' : 'cyan'}>{STIMULUS_LABELS[stimulus]}</Tag>
                {presenting ? <Tag color="processing">正在播放…</Tag> : <Tag>等待作答</Tag>}
                {!verification && isAscending(staircase) ? <Tag color="gold">上升阶段</Tag> : null}
                {verification ? (
                  <Tag color="magenta">
                    阈值确认 {verification.index + 1}/{VERIFICATION_STIMULI.length}
                  </Tag>
                ) : null}
              </Typography.Text>
              <div style={{ marginTop: 6 }}>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {verification
                    ? `已判出阈值，正在用「${STIMULUS_LABELS[stimulus]}」再确认：${STIMULUS_HINTS[stimulus]}。若这次没听到，会自动提高 5 dB 重新确认。`
                    : `判阈阶段使用「${STIMULUS_LABELS[stimulus]}」：${STIMULUS_HINTS[stimulus]}。`}
                </Typography.Text>
              </div>
            </Col>
            <Col>
              <Progress
                type="circle"
                percent={percent}
                size={72}
                format={() => `${doneCount}/${frequencies.length}`}
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
              听到了（空格）
            </Button>
            <Button
              size="large"
              disabled={presenting}
              onClick={() => answer(false)}
              style={{ minWidth: 140 }}
            >
              没听到（2）
            </Button>
            <Button onClick={() => void playCurrent()} disabled={presenting}>
              重听（R）
            </Button>
            <Button danger type="text" onClick={abort}>
              中止
            </Button>
          </Space>

          <Typography.Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0 }}>
            提示：测试音持续约 1.2 秒，只在一侧耳播放。请在提示音结束后作答；不确定时以「没听到」为准更稳妥。
          </Typography.Paragraph>
        </Card>

        {measured.length > 0 ? (
          <Card bordered={false} title={`${EAR_LABELS[currentEar]}已完成频点`}>
            <Table
              size="small"
              rowKey="frequency"
              pagination={false}
              columns={thresholdColumns}
              dataSource={measured}
            />
          </Card>
        ) : null}
      </Space>
    );
  }

  // —— 换耳提示
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
            接下来测{nextEar ? EAR_LABELS[nextEar] : '下一只耳'}。请把耳机换到另一侧，保持音量不变。
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

  // —— 完成
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card bordered={false}>
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Typography.Title level={4} style={{ margin: 0 }}>
            自测完成
          </Typography.Title>
          <Typography.Text type="secondary">
            已生成双耳补偿配置
            {createdProfileName ? `，保存为档案「${createdProfileName}」` : ''}
            ，可直接用于声音增强，也可导出给后续桌面端使用。
          </Typography.Text>
          <Space>
            <Button type="primary" onClick={() => navigate('/profile')}>
              查看听力档案
            </Button>
            <Button onClick={() => navigate('/enhance')}>去声音增强</Button>
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
            <Col xs={24} sm={12} lg={6}>
              <Card bordered={false}>
                <Statistic
                  title="最大补偿增益"
                  value={Math.max(
                    ...[config.ears.LEFT, config.ears.RIGHT].flatMap((item) =>
                      item ? item.eqBands.map((band) => band.gainDb) : [0],
                    ),
                    0,
                  )}
                  suffix="dB"
                />
              </Card>
            </Col>
          </Row>

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
              <Card bordered={false} title="推荐补偿增益">
                <GainCurveChart left={config.ears.LEFT} right={config.ears.RIGHT} />
              </Card>
            </Col>
          </Row>

          <HearingInsights config={config} />

          <Card bordered={false} title="明细">
            <Descriptions size="small" column={2}>
              {(['LEFT', 'RIGHT'] as Ear[]).map((ear) => {
                const earConfig = config.ears[ear];
                return (
                  <Descriptions.Item key={ear} label={EAR_LABELS[ear]}>
                    {earConfig
                      ? earConfig.audiogram
                          .map(
                            (item) =>
                              `${formatFrequency(item.frequency)} ${
                                item.thresholdDbHl === null ? '未测出' : item.thresholdDbHl
                              }`,
                          )
                          .join('　')
                      : '未测听'}
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
